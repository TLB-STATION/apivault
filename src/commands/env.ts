import { Command } from "commander";
import { client } from "../http";
import { getConfigValue } from "../config";
import { revealKey, type ApiKeyDTO } from "./keys";
import {
  buildEnvContent,
  mergeEnvContent,
  readEnvFile,
  writeEnvFile,
} from "../env-file";
import { printJson, printSuccess, dim, yellow, reportError } from "../ui/format";

interface ExportOpts {
  env?: string;
  output?: string;
  key?: string;
  force?: boolean;
}

/**
 * apivault env export — decrypt keys for an environment and write them to a
 * local .env file (merge by default; --force replaces the file).
 */
async function exportEnv(opts: ExportOpts, json: boolean): Promise<void> {
  const env = (opts.env ?? getConfigValue("run.env"))?.trim();
  if (!env) {
    throw new Error(
      "No environment specified. Pass --env <env>, or set a default with `apivault config set run.env <env>`.",
    );
  }

  const output = (opts.output ?? ".env").trim() || ".env";

  const params = new URLSearchParams();
  params.set("environment", env);
  const keys = await client.request<ApiKeyDTO[]>(`/api/keys?${params.toString()}`);

  if (!keys || keys.length === 0) {
    throw new Error(`No keys found for environment "${env}".`);
  }

  const secrets: Record<string, string> = {};
  for (const k of keys) {
    secrets[k.name] = await revealKey(client, k.id, opts.key);
  }

  const existing = opts.force ? "" : readEnvFile(output);
  const content = opts.force ? buildEnvContent(secrets) : mergeEnvContent(existing, secrets);
  writeEnvFile(output, content);

  if (json) {
    printJson({
      environment: env,
      output,
      keys: Object.keys(secrets).sort(),
      merged: !opts.force,
    });
    return;
  }

  printSuccess(
    `Wrote ${keys.length} secret${keys.length === 1 ? "" : "s"} to ${output}` +
      (opts.force ? " (replaced)." : " (merged)."),
    json,
  );
  process.stdout.write(
    yellow("⚠ ") +
      dim("This file contains secrets. Keep it out of version control (add to .gitignore).\n"),
  );
}

/** Register the `env` command group on the parent program. */
export function registerEnvCommand(program: Command): void {
  const json = () => Boolean(program.opts().json);
  const handle = (err: unknown) => {
    reportError(err, json());
    process.exitCode = 1;
  };

  const env = program
    .command("env")
    .description("Export vault secrets to a local .env file");

  env
    .command("export")
    .description("Decrypt keys for an environment and save them to a .env file")
    .option("--env <environment>", "Environment to export (or set config run.env)")
    .option("-o, --output <file>", "Output path (default: .env)", ".env")
    .option("--key <passphrase>", "Vault key for custom-mode accounts (or set APIVAULT_KEY)")
    .option("-f, --force", "Replace the file instead of merging with existing variables")
    .action(async (opts: ExportOpts) => exportEnv(opts, json()).catch(handle));
}
