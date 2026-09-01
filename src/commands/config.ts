import { Command } from "commander";
import { password } from "@inquirer/prompts";
import {
  readGlobalConfig,
  readLocalConfig,
  getConfigValue,
  setConfigValue,
  deleteConfigValue,
  type StoredConfig,
  type ConfigScope,
} from "../config";
import { printJson, printSuccess, dim, green, cyan, yellow, reportError } from "../ui/format";

/** Keys whose values are secrets and should be masked in overview output. */
const SECRET_KEYS = new Set(["vaultKey"]);

/**
 * Config keys `set` will accept. Prevents typos (e.g. `vaultkeys`) from
 * silently creating entries that the rest of the CLI never reads.
 */
const KNOWN_CONFIG_KEYS = ["run.command", "run.env", "vaultKey", "project"] as const;

interface ConfigScopeOptions {
  local?: boolean;
  global?: boolean;
}

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

function resolveScopeOption(opts: ConfigScopeOptions): "local" | "global" | undefined {
  if (opts.local && opts.global) {
    throw new Error("Cannot specify both --local and --global at the same time.");
  }
  if (opts.local) return "local";
  if (opts.global) return "global";
  return undefined;
}

/** apivault config list */
function listConfig(opts: ConfigScopeOptions, json: boolean): void {
  const scope = resolveScopeOption(opts);
  const { config: localConfig, filePath: localPath } = readLocalConfig();
  const globalConfig = readGlobalConfig();

  if (json) {
    if (scope === "local") {
      printJson({ scope: "local", file: localPath, config: localConfig });
    } else if (scope === "global") {
      printJson({ scope: "global", config: globalConfig });
    } else {
      printJson({
        local: { file: localPath, config: localConfig },
        global: { config: globalConfig },
      });
    }
    return;
  }

  if (scope === "local") {
    const entries = flattenConfig(localConfig);
    if (!localPath || entries.length === 0) {
      process.stdout.write(dim("No local config set in this directory. Use `apivault config set --local <key> <value>`.\n"));
      return;
    }
    process.stdout.write(dim(`Local configuration (${localPath}):\n`));
    const width = Math.max(...entries.map((e) => e.key.length));
    for (const { key, value } of entries) {
      const display = SECRET_KEYS.has(key) ? dim(maskValue(value)) : value;
      process.stdout.write(`  ${green(pad(key, width))}  ${display}\n`);
    }
    return;
  }

  if (scope === "global") {
    const entries = flattenConfig(globalConfig);
    if (entries.length === 0) {
      process.stdout.write(dim("No global config set. Use `apivault config set --global <key> <value>`.\n"));
      return;
    }
    process.stdout.write(dim("Global configuration (~/.apivault/config.json):\n"));
    const width = Math.max(...entries.map((e) => e.key.length));
    for (const { key, value } of entries) {
      const display = SECRET_KEYS.has(key) ? dim(maskValue(value)) : value;
      process.stdout.write(`  ${green(pad(key, width))}  ${display}\n`);
    }
    return;
  }

  // Combined hierarchical list:
  const localEntries = flattenConfig(localConfig);
  const globalEntries = flattenConfig(globalConfig);
  const allKeys = Array.from(
    new Set([...localEntries.map((e) => e.key), ...globalEntries.map((e) => e.key)]),
  ).sort();

  if (allKeys.length === 0) {
    process.stdout.write(dim("No config set. Use `apivault config set <key> <value>`.\n"));
    return;
  }

  const width = Math.max(...allKeys.map((k) => k.length));
  process.stdout.write(dim("Active configuration (local overrides global):\n"));
  for (const key of allKeys) {
    const localVal = localEntries.find((e) => e.key === key)?.value;
    const globalVal = globalEntries.find((e) => e.key === key)?.value;
    const isLocal = localVal !== undefined;
    const activeVal = isLocal ? localVal : globalVal!;
    const display = SECRET_KEYS.has(key) ? dim(maskValue(activeVal)) : activeVal;
    const sourceTag = isLocal
      ? cyan(" (local)")
      : dim(" (global)");
    process.stdout.write(`  ${green(pad(key, width))}  ${display}${sourceTag}\n`);
  }
}

/** apivault config get <key> */
function getConfig(key: string, opts: ConfigScopeOptions, json: boolean): void {
  const scope = resolveScopeOption(opts);
  const value = getConfigValue(key, { scope });
  if (value === undefined) {
    if (json) {
      printJson({ key, set: false, scope: scope || "all" });
      return;
    }
    process.stdout.write(dim(`"${key}" is not set${scope ? ` in ${scope} config` : ""}.\n`));
    process.exitCode = 1;
    return;
  }
  if (json) {
    printJson({ key, value, scope: scope || "resolved" });
    return;
  }
  // `get` is an explicit retrieval — show the raw value even for secrets.
  process.stdout.write(value + "\n");
}

/** apivault config set <key> [value] */
async function setConfig(
  key: string,
  value: string | undefined,
  opts: ConfigScopeOptions,
  json: boolean,
): Promise<void> {
  assertKnownKey(key);

  const scopeOpt = resolveScopeOption(opts);

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

  // Default scope decision:
  // If explicitly requested, use it.
  // Otherwise, if local config file already exists or setting 'project', default to 'local'; else 'global'.
  const { filePath: localPath } = readLocalConfig();
  const effectiveScope: "local" | "global" = scopeOpt ?? (localPath ? "local" : "global");

  const result = setConfigValue(key, resolved, { scope: effectiveScope });
  if (json) {
    printJson({ key, set: true, scope: result.scope, file: result.targetPath });
    return;
  }
  const display = SECRET_KEYS.has(key) ? dim(maskValue(resolved)) : resolved;
  const scopeLabel = result.scope === "local" ? cyan(`[local: ${result.targetPath}]`) : dim("[global]");
  printSuccess(`Saved ${key} = ${display} ${scopeLabel}.`, json);
}

/** apivault config delete <key> */
function deleteConfig(key: string, opts: ConfigScopeOptions, json: boolean): void {
  const scopeOpt = resolveScopeOption(opts);
  const { deletedLocal, deletedGlobal } = deleteConfigValue(key, { scope: scopeOpt });
  const anyDeleted = deletedLocal || deletedGlobal;

  if (json) {
    printJson({ key, deleted: anyDeleted, deletedLocal, deletedGlobal });
    return;
  }
  if (anyDeleted) {
    const parts = [];
    if (deletedLocal) parts.push("local");
    if (deletedGlobal) parts.push("global");
    printSuccess(`Removed ${key} from ${parts.join(" and ")} config.`, json);
  } else {
    process.stdout.write(dim(`"${key}" was not set${scopeOpt ? ` in ${scopeOpt} config` : ""}.\n`));
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
    .description("Manage local and global CLI defaults (project, run command, environment, vault key)");

  config
    .command("list")
    .description("Show all config values (secrets are masked)")
    .option("-l, --local", "Show only local project config")
    .option("-g, --global", "Show only global user config")
    .action((opts: ConfigScopeOptions) => {
      try {
        listConfig(opts, json());
      } catch (err) {
        handle(err);
      }
    });

  config
    .command("get <key>")
    .description("Print a config value (dot path, e.g. run.command, project)")
    .option("-l, --local", "Get only from local project config")
    .option("-g, --global", "Get only from global user config")
    .action((key: string, opts: ConfigScopeOptions) => {
      try {
        getConfig(key, opts, json());
      } catch (err) {
        handle(err);
      }
    });

  config
    .command("set <key> [value]")
    .description(
      "Set a config value. Secret keys (vaultKey) prompt hidden when value is omitted.",
    )
    .option("-l, --local", "Save in local project config (.apivault.json)")
    .option("-g, --global", "Save in global user config (~/.apivault/config.json)")
    .action(async (key: string, value: string | undefined, opts: ConfigScopeOptions) =>
      setConfig(key, value, opts, json()).catch(handle),
    );

  config
    .command("delete <key>")
    .description("Remove a config value")
    .option("-l, --local", "Remove only from local project config")
    .option("-g, --global", "Remove only from global user config")
    .action((key: string, opts: ConfigScopeOptions) => {
      try {
        deleteConfig(key, opts, json());
      } catch (err) {
        handle(err);
      }
    });
}

