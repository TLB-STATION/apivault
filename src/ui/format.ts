import pc from "picocolors";
import Table from "cli-table3";
import type { Command } from "commander";
import { ApiError } from "../http";

/** True when stdout is a TTY and color hasn't been disabled. */
export function useColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  return process.stdout.isTTY === true;
}

export function green(s: string): string {
  return useColor() ? pc.green(s) : s;
}
export function red(s: string): string {
  return useColor() ? pc.red(s) : s;
}
export function yellow(s: string): string {
  return useColor() ? pc.yellow(s) : s;
}
export function dim(s: string): string {
  return useColor() ? pc.dim(s) : s;
}
export function bold(s: string): string {
  return useColor() ? pc.bold(s) : s;
}
export function cyan(s: string): string {
  return useColor() ? pc.cyan(s) : s;
}

/** Mask a raw key the same way the web app does (see keys/route.ts maskKey). */
export function maskKey(rawKey: string): string {
  if (!rawKey) return "••••••••••••••••";
  if (rawKey.length <= 10) {
    return rawKey.slice(0, 3) + "••••••••••••";
  }
  const prefix = rawKey.slice(0, 7);
  const suffix = rawKey.slice(-4);
  return `${prefix}••••••••••••${suffix}`;
}

/** Format an ISO date string as a short local stamp; blank if unset. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return dim("never");
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return dim("unknown");
  return d.toLocaleString();
}

/** Render an array of keys as a table. */
export function renderKeysTable(
  keys: Array<{
    id: string;
    name: string;
    service?: string;
    environment?: string;
    masked?: string;
    updatedAt?: string;
    last_used?: string | null;
  }>,
): string {
  const table = new Table({
    head: [
      cyan("ID"),
      cyan("Name"),
      cyan("Service"),
      cyan("Env"),
      cyan("Key"),
      cyan("Updated"),
    ],
    style: { head: [], border: useColor() ? ["gray"] : [] },
    wordWrap: true,
  });
  for (const k of keys) {
    table.push([
      k.id,
      k.name,
      k.service ?? "Custom",
      k.environment ?? "Production",
      k.masked ?? dim("—"),
      formatDate(k.updatedAt),
    ]);
  }
  return table.toString();
}

/** Pretty-print a single key object. */
export function renderKeyDetail(
  k: {
    id: string;
    name: string;
    service?: string;
    environment?: string;
    notes?: string | null;
    masked?: string;
    createdAt?: string;
    updatedAt?: string;
    last_used?: string | null;
  },
  opts: { showRaw?: boolean; rawKey?: string } = {},
): string {
  const lines = [
    `${bold("ID:")}          ${k.id}`,
    `${bold("Name:")}        ${k.name}`,
    `${bold("Service:")}     ${k.service ?? "Custom"}`,
    `${bold("Environment:")} ${k.environment ?? "Production"}`,
  ];
  if (k.notes) lines.push(`${bold("Notes:")}       ${k.notes}`);
  lines.push(`${bold("Key:")}         ${opts.showRaw && opts.rawKey ? green(opts.rawKey) : k.masked ?? dim("—")}`);
  lines.push(`${bold("Created:")}     ${formatDate(k.createdAt)}`);
  lines.push(`${bold("Updated:")}     ${formatDate(k.updatedAt)}`);
  lines.push(`${bold("Last used:")}   ${formatDate(k.last_used)}`);
  return lines.join("\n");
}

/** Print a JSON value (for --json mode). */
export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

/** Print a success line, unless in --json mode. */
export function printSuccess(message: string, json?: boolean): void {
  if (json) return;
  process.stdout.write(green("✔ ") + message + "\n");
}

/** Centralized error reporter for command handlers. */
export function reportError(err: unknown, json?: boolean): void {
  if (json) {
    const payload =
      err instanceof ApiError
        ? { error: err.message, status: err.status }
        : { error: err instanceof Error ? err.message : String(err) };
    printJson(payload);
  } else {
    const msg =
      err instanceof ApiError
        ? red(err.message)
        : err instanceof Error
          ? red(err.message)
          : red(String(err));
    process.stderr.write(msg + "\n");
  }
}

/** Wrap a commander action so errors never throw a stack trace. */
export function withErrors<T extends unknown[]>(
  fn: (...args: T) => Promise<void>,
  opts?: { jsonRef?: () => boolean },
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err) {
      reportError(err, opts?.jsonRef?.());
      process.exitCode = 1;
    }
  };
}

/** Helper to pull the global --json flag off the active command. */
export function isJson(cmd: Command | undefined): boolean {
  return Boolean(cmd?.opts()?.json);
}
