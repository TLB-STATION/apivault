import { Command } from "commander";
import { password } from "@inquirer/prompts";
import {
  readConfig,
  getConfigValue,
  setConfigValue,
  deleteConfigValue,
  type StoredConfig,
} from "../config";
import { printJson, printSuccess, dim, green, reportError } from "../ui/format";

/** Keys whose values are secrets and should be masked in overview output. */
const SECRET_KEYS = new Set(["vaultKey"]);

/**
 * Config keys `set` will accept. Prevents typos (e.g. `vaultkeys`) from
 * silently creating entries that the rest of the CLI never reads.
 */
const KNOWN_CONFIG_KEYS = ["run.command", "run.env", "vaultKey"] as const;

/** Suggest known keys close to a typoed one (case-insensitive containment). */
function suggestKeys(typed: string): string[] {
  const needle = typed.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!needle) return [];
  return KNOWN_CONFIG_KEYS.filter((k) => {
    const hay = k.toLowerCase().replace(/[^a-z0-9]/g, "");
    return hay.includes(needle) || needle.includes(hay);
  });
}

/** Reject unknown config keys with a helpful, typo-aware message. */
function assertKnownKey(key: string): void {
  if ((KNOWN_CONFIG_KEYS as readonly string[]).includes(key)) return;
  const suggestions = suggestKeys(key);
  throw new Error(
    `Unknown config key "${key}". Valid keys: ${KNOWN_CONFIG_KEYS.join(", ")}.` +
      (suggestions.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""),
  );
}


/** Mask all but the last 2 characters of a secret. */
function maskValue(value: string): string {
  if (!value) return "•••••••";
  if (value.length <= 4) return "••••";
  return "•".repeat(Math.max(4, value.length - 2)) + value.slice(-2);
}

/** Flatten a nested config into dot-path entries (sorted for stable display). */
function flattenConfig(
  config: StoredConfig,
  prefix = "",
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const [k, v] of Object.entries(config)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...flattenConfig(v as StoredConfig, path));
    } else if (typeof v === "string") {
      out.push({ key: path, value: v });
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Right-pad a string to a given width. */
function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - s.length));
}

/** apivault config list */
function listConfig(json: boolean): void {
  const config = readConfig();
  const entries = flattenConfig(config);
  if (json) {
    printJson(config);
    return;
  }
  if (entries.length === 0) {
    process.stdout.write(dim("No config set. Use `apivault config set <key> <value>`.\n"));
    return;
  }
  const width = Math.max(...entries.map((e) => e.key.length));
  for (const { key, value } of entries) {
    const display = SECRET_KEYS.has(key) ? dim(maskValue(value)) : value;
    process.stdout.write(`${green(pad(key, width))}  ${display}\n`);
  }
}

/** apivault config get <key> */
function getConfig(key: string, json: boolean): void {
  const value = getConfigValue(key);
  if (value === undefined) {
    if (json) {
      printJson({ key, set: false });
      return;
    }
    process.stdout.write(dim(`"${key}" is not set.\n`));
    process.exitCode = 1;
    return;
  }
  if (json) {
    printJson({ key, value });
    return;
  }
  // `get` is an explicit retrieval — show the raw value even for secrets.
  process.stdout.write(value + "\n");
}

/** apivault config set <key> [value] */
async function setConfig(key: string, value: string | undefined, json: boolean): Promise<void> {
  assertKnownKey(key);

  // For secret keys, prompt with hidden input when no value is given inline
  // (avoids leaving the vault key in shell history).
  let resolved = value;
  if (resolved === undefined && SECRET_KEYS.has(key)) {
    resolved = (
      await password({ message: `${key}:`, mask: "*" })
    ).trim();
  }
  if (resolved === undefined || resolved === "") {
    throw new Error(`A value is required. Usage: apivault config set <key> <value>`);
  }
  setConfigValue(key, resolved);
  if (json) {
    printJson({ key, set: true });
    return;
  }
  const display = SECRET_KEYS.has(key) ? dim(maskValue(resolved)) : resolved;
  printSuccess(`Saved ${key} = ${display}.`, json);
}

/** apivault config delete <key> */
function deleteConfig(key: string, json: boolean): void {
  const existed = deleteConfigValue(key);
  if (json) {
    printJson({ key, deleted: existed });
    return;
  }
  if (existed) {
    printSuccess(`Removed ${key}.`, json);
  } else {
    process.stdout.write(dim(`"${key}" was not set.\n`));
    process.exitCode = 1;
  }
}

/** Register the `config` command group on the parent program. */
export function registerConfigCommand(program: Command): void {
  const json = () => Boolean(program.opts().json);
  const handle = (err: unknown) => {
    reportError(err, json());
    process.exitCode = 1;
  };

  const config = program
    .command("config")
    .description("Manage local CLI defaults (run command, environment, vault key)");

  config
    .command("list")
    .description("Show all config values (secrets are masked)")
    .action(() => listConfig(json()));

  config
    .command("get <key>")
    .description("Print a config value (dot path, e.g. run.command)")
    .action((key: string) => getConfig(key, json()));

  config
    .command("set <key> [value]")
    .description(
      "Set a config value. Secret keys (vaultKey) prompt hidden when value is omitted.",
    )
    .action(async (key: string, value: string | undefined) =>
      setConfig(key, value, json()).catch(handle),
    );

  config
    .command("delete <key>")
    .description("Remove a config value")
    .action((key: string) => deleteConfig(key, json()));
}
