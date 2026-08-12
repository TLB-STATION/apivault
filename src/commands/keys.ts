import { Command } from "commander";
import { input, password, confirm } from "@inquirer/prompts";
import { ApiError, client } from "../http";
import { type GlobalOptions, getConfigValue } from "../config";
import {
  renderKeysTable,
  renderKeyDetail,
  printJson,
  printSuccess,
  dim,
  yellow,
  reportError,
} from "../ui/format";

export interface ApiKeyDTO {
  id: string;
  name: string;
  service?: string;
  environment?: string;
  notes?: string | null;
  masked?: string;
  createdAt?: string;
  updatedAt?: string;
  last_used?: string | null;
}

interface KeyOpts extends GlobalOptions {
  json?: boolean;
  reveal?: boolean;
  force?: boolean;
  /** Custom vault passphrase (for reveal on custom-mode accounts). */
  key?: string;
}

/** Fields `keys add` accepts as flags (enables non-interactive use). */
interface AddKeyFields {
  name?: string;
  service?: string;
  environment?: string;
  key?: string;
  notes?: string;
}

/** apivault keys list */
async function listKeys(opts: KeyOpts): Promise<void> {
  const c = client;
  const keys = await c.request<ApiKeyDTO[]>("/api/keys");
  if (opts.json) {
    printJson(keys);
    return;
  }
  if (!keys || keys.length === 0) {
    process.stdout.write(dim("No API keys yet. Add one with `apivault keys add`.\n"));
    return;
  }
  process.stdout.write(renderKeysTable(keys) + "\n");
}

/** apivault keys get <id> [--reveal] */
async function getKey(id: string, opts: KeyOpts): Promise<void> {
  const c = client;

  // The list endpoint gives us the masked view; find the matching key.
  const keys = await c.request<ApiKeyDTO[]>("/api/keys");
  const key = keys.find((k) => k.id === id);
  if (!key) {
    throw new ApiError(`No key with id "${id}".`, 404, undefined);
  }

  let rawKey: string | undefined;
  if (opts.reveal) {
    rawKey = await revealKey(c, id, opts.key);
  }

  if (opts.json) {
    printJson({ ...key, ...(rawKey ? { rawKey } : {}) });
    return;
  }

  process.stdout.write(renderKeyDetail(key, { showRaw: opts.reveal, rawKey }) + "\n");
  if (opts.reveal) {
    process.stdout.write(
      yellow("⚠ ") + "This is a secret. Avoid sharing or pasting it anywhere untrusted.\n",
    );
  }
}

/**
 * Resolve the custom vault passphrase from (in order): an explicit flag,
 * APIVAULT_KEY, or config vaultKey.
 */
export function resolveVaultKey(vaultKeyFlag?: string): string | undefined {
  return (vaultKeyFlag ?? process.env.APIVAULT_KEY ?? getConfigValue("vaultKey"))?.trim() || undefined;
}

async function promptVaultKey(): Promise<string> {
  return (
    await password({
      message: "Vault key (custom encryption passphrase):",
      mask: "*",
    })
  ).trim();
}

/**
 * Run a vault-key-protected request. Sends X-Vault-Key when a passphrase is
 * available; prompts on VAULT_KEY_REQUIRED if none was provided yet.
 */
async function withVaultKey<T>(
  vaultKeyFlag: string | undefined,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  const vaultKey = resolveVaultKey(vaultKeyFlag);
  const headersFor = (passphrase?: string): Record<string, string> => {
    const h: Record<string, string> = {};
    const value = passphrase ?? vaultKey;
    if (value) h["X-Vault-Key"] = value;
    return h;
  };

  try {
    return await fn(headersFor());
  } catch (err) {
    if (err instanceof ApiError && err.code === "VAULT_KEY_REQUIRED") {
      if (vaultKey) throw new ApiError("That vault key is incorrect.", 403, undefined);
      const passphrase = await promptVaultKey();
      return fn(headersFor(passphrase));
    }
    throw err;
  }
}

/**
 * Decrypt a key. Default-mode accounts work with just the Bearer token.
 * Custom-mode accounts need the vault passphrase via resolveVaultKey or prompt.
 */
export async function revealKey(
  c: typeof client,
  id: string,
  keyFlag?: string,
): Promise<string> {
  const decrypted = await withVaultKey(keyFlag, (headers) =>
    c.request<{ rawKey?: string; error?: string }>(
      `/api/keys/${encodeURIComponent(id)}/decrypt`,
      { method: "POST", headers },
    ),
  );
  if (!decrypted?.rawKey) throw new ApiError("Could not decrypt that key.", 500, decrypted);
  return decrypted.rawKey;
}

/** apivault keys add — interactive, or fully via flags for scripting. */
async function addKey(opts: KeyOpts & AddKeyFields): Promise<void> {
  const c = client;

  const name = (
    opts.name?.trim() ||
    (await input({
      message: "Key name:",
      validate: (v) => (v.trim() ? true : "Name is required."),
    }))
  ).trim();
  const service = (
    opts.service?.trim() ||
    (await input({ message: "Service:", default: "Custom" }))
  ).trim();
  const environment = (
    opts.environment?.trim() ||
    (await input({ message: "Environment:", default: "Production" }))
  ).trim();
  const keyValue = (
    opts.key?.trim() ||
    (await password({
      message: "API key value:",
      mask: "*",
      validate: (v) => (v.trim() ? true : "Key value is required."),
    }))
  ).trim();
  const notes =
    opts.notes !== undefined
      ? opts.notes.trim()
      : (await input({ message: "Notes (optional):", default: "" })).trim();

  const created = await withVaultKey(undefined, (headers) =>
    c.request<ApiKeyDTO>("/api/keys", {
      method: "POST",
      headers,
      json: {
        name,
        service,
        environment,
        notes: notes || undefined,
        key: keyValue,
      },
    }),
  );

  if (opts.json) {
    printJson(created);
    return;
  }
  printSuccess(`Saved "${created.name}" (id ${dim(created.id)}).`);
}

/** apivault keys update <id> (interactive) */
async function updateKey(id: string, opts: KeyOpts): Promise<void> {
  const c = client;

  const keys = await c.request<ApiKeyDTO[]>("/api/keys");
  const existing = keys.find((k) => k.id === id);
  if (!existing) {
    throw new ApiError(`No key with id "${id}".`, 404, undefined);
  }

  const name = await input({
    message: "Key name:",
    default: existing.name,
    validate: (v) => (v.trim() ? true : "Name is required."),
  });
  const service = await input({
    message: "Service:",
    default: existing.service ?? "Custom",
  });
  const environment = await input({
    message: "Environment:",
    default: existing.environment ?? "Production",
  });
  const changeKey = await confirm({
    message: "Change the API key value?",
    default: false,
  });
  let keyValue: string | undefined;
  if (changeKey) {
    keyValue = await password({
      message: "New API key value:",
      mask: "*",
      validate: (v) => (v.trim() ? true : "Key value is required."),
    });
  }
  const notes = await input({
    message: "Notes:",
    default: existing.notes ?? "",
  });

  const updated = await withVaultKey(undefined, (headers) =>
    c.request<ApiKeyDTO>(`/api/keys/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers,
      json: {
        name: name.trim(),
        service: service.trim(),
        environment: environment.trim(),
        notes: notes.trim(),
        ...(keyValue ? { key: keyValue.trim() } : {}),
      },
    }),
  );

  if (opts.json) {
    printJson(updated);
    return;
  }
  printSuccess(`Updated "${name.trim()}" (id ${dim(id)}).`);
}

/** apivault keys delete <id> */
async function deleteKey(id: string, opts: KeyOpts): Promise<void> {
  const c = client;

  const keys = await c.request<ApiKeyDTO[]>("/api/keys");
  const existing = keys.find((k) => k.id === id);
  if (!existing) {
    throw new ApiError(`No key with id "${id}".`, 404, undefined);
  }

  if (!opts.force && !opts.json) {
    const ok = await confirm({
      message: `Delete "${existing.name}" (${dim(id)})? This cannot be undone.`,
      default: false,
    });
    if (!ok) {
      process.stdout.write(dim("Cancelled.\n"));
      return;
    }
  }

  await c.request<{ success?: boolean }>(`/api/keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (opts.json) {
    printJson({ deleted: true, id });
    return;
  }
  printSuccess(`Deleted "${existing.name}" (${dim(id)}).`);
}

/** Register the `keys` command group on the parent program. */
export function registerKeysCommand(program: Command): void {
  // Global opts (url/json) live on the root program; read them per action.
  const globals = () => program.opts() as KeyOpts;
  const json = () => Boolean(program.opts().json);
  const handle = (err: unknown) => {
    reportError(err, json());
    process.exitCode = 1;
  };

  const keys = program
    .command("keys")
    .description("Manage your stored API keys");

  keys
    .command("list")
    .description("List all keys (masked)")
    .action(async () => listKeys(globals()).catch(handle));

  keys
    .command("get <id>")
    .description("Show a key. Use --reveal to decrypt and print the raw value.")
    .option("--reveal", "Decrypt and print the raw key value")
    .option("--key <passphrase>", "Vault key for custom-mode accounts (or set APIVAULT_KEY)")
    .action(async (id: string, local: { reveal?: boolean; key?: string }) =>
      getKey(id, { ...globals(), reveal: local.reveal, key: local.key }).catch(handle),
    );

  keys
    .command("add")
    .description("Add a new API key (interactive, or fully via flags)")
    .option("--name <name>", "Key name")
    .option("--service <service>", "Service (default: Custom)")
    .option("--environment <env>", "Environment (default: Production)")
    .option("--key <key>", "API key value")
    .option("--notes <notes>", "Notes")
    .action(async (local: AddKeyFields) =>
      addKey({ ...globals(), ...local }).catch(handle),
    );

  keys
    .command("update <id>")
    .description("Edit a key (interactive)")
    .action(async (id: string) =>
      updateKey(id, { ...globals() }).catch(handle),
    );

  keys
    .command("delete <id>")
    .description("Delete a key")
    .option("-f, --force", "Skip the confirmation prompt")
    .action(async (id: string, local: { force?: boolean }) =>
      deleteKey(id, { ...globals(), force: local.force }).catch(handle),
    );
}
