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
export function magenta(s: string): string {
  return useColor() ? pc.magenta(s) : s;
}
export function blue(s: string): string {
  return useColor() ? pc.blue(s) : s;
}

/**
 * Mask a raw key by length, mirroring the web app's `maskKey`
 * (`src/lib/vault.ts` in the ApiVault repo) so a locally masked value and a
 * server-sent `masked_preview` never render differently. Keep the two in sync.
 */
export function maskKey(rawKey: string): string {
  if (!rawKey) return "••••••••••••••••";
  const len = rawKey.length;
  if (len <= 4) {
    return "•".repeat(len);
  }
  if (len <= 7) {
    return `${rawKey.slice(0, 1)}${"•".repeat(len - 2)}${rawKey.slice(-1)}`;
  }
  if (len <= 12) {
    return `${rawKey.slice(0, 3)}${"•".repeat(len - 5)}${rawKey.slice(-2)}`;
  }
  const prefix = rawKey.slice(0, 7);
  const suffix = rawKey.slice(-4);
  return `${prefix}${"•".repeat(len - 11)}${suffix}`;
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

export interface LogEntryDTO {
  id: string;
  projectId?: string;
  method: string;
  endpoint: string;
  status: number;
  durationMs?: number | null;
  source?: string | null;
  eventType?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown> | null;
  userId?: string | null;
  createdAt: string;
  user?: {
    id?: string;
    name?: string | null;
    email?: string | null;
  } | null;
}

export function formatLogDate(dateStr: string): string {
  if (!dateStr) return dim("never");
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dim("unknown");
  // YYYY-MM-DD HH:MM:SS
  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  const secs = pad(d.getSeconds());
  return `${year}-${month}-${day} ${hours}:${mins}:${secs}`;
}

export function formatStatus(status: number): string {
  const str = String(status);
  if (status >= 500) return bold(red(str));
  if (status >= 400) return red(str);
  if (status >= 300) return yellow(str);
  if (status >= 200) return green(str);
  return dim(str);
}

export function formatMethod(method: string): string {
  const m = (method || "").toUpperCase();
  switch (m) {
    case "GET":
      return cyan(m.padEnd(6));
    case "POST":
      return green(m.padEnd(6));
    case "PUT":
    case "PATCH":
      return yellow(m.padEnd(6));
    case "DELETE":
      return red(m.padEnd(6));
    default:
      return dim(m.padEnd(6));
  }
}

export function formatSource(source?: string | null): string {
  const s = source || "unknown";
  switch (s.toLowerCase()) {
    case "cli":
      return magenta(s);
    case "mcp":
      return blue(s);
    case "web":
      return cyan(s);
    case "api":
      return yellow(s);
    default:
      return dim(s);
  }
}

/** Render a table of project logs. */
export function renderLogsTable(logs: LogEntryDTO[]): string {
  const table = new Table({
    head: [
      cyan("Time"),
      cyan("Status"),
      cyan("Method"),
      cyan("Endpoint"),
      cyan("Source"),
      cyan("Actor"),
      cyan("Duration"),
      cyan("Event"),
    ],
    style: { head: [], border: useColor() ? ["gray"] : [] },
    wordWrap: true,
  });

  for (const log of logs) {
    const userLabel = log.user?.email || log.user?.name || (log.userId ? dim(log.userId.slice(0, 8)) : dim("—"));
    const duration = log.durationMs !== null && log.durationMs !== undefined ? `${log.durationMs}ms` : dim("—");
    const event = log.eventType ? yellow(log.eventType) : dim("—");

    table.push([
      formatLogDate(log.createdAt),
      formatStatus(log.status),
      formatMethod(log.method).trim(),
      log.endpoint,
      formatSource(log.source),
      userLabel,
      duration,
      event,
    ]);
  }

  return table.toString();
}

/** Pretty-print a single log entry. */
export function renderLogDetail(log: LogEntryDTO): string {
  const lines = [
    `${bold("Log ID:")}       ${log.id}`,
    `${bold("Timestamp:")}    ${formatLogDate(log.createdAt)} (${dim(log.createdAt)})`,
    `${bold("Status:")}       ${formatStatus(log.status)}`,
    `${bold("Method:")}       ${formatMethod(log.method).trim()}`,
    `${bold("Endpoint:")}     ${cyan(log.endpoint)}`,
    `${bold("Source:")}       ${formatSource(log.source)}`,
    `${bold("Event Type:")}   ${log.eventType ? yellow(log.eventType) : dim("none")}`,
    `${bold("Duration:")}     ${log.durationMs !== null && log.durationMs !== undefined ? `${log.durationMs}ms` : dim("none")}`,
    `${bold("IP Address:")}   ${log.ipAddress || dim("none")}`,
    `${bold("User Agent:")}   ${log.userAgent ? dim(log.userAgent) : dim("none")}`,
    `${bold("Actor:")}        ${log.user?.email ? `${log.user.name ? `${log.user.name} <${log.user.email}>` : log.user.email} (id: ${log.user.id || log.userId || "unknown"})` : log.userId ? log.userId : dim("none")}`,
  ];

  if (log.details && Object.keys(log.details).length > 0) {
    lines.push(`${bold("Details:")}`);
    lines.push(
      JSON.stringify(log.details, null, 2)
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n"),
    );
  }

  return lines.join("\n");
}

/** Render a single real-time stream log line. */
export function renderLogStreamLine(log: LogEntryDTO): string {
  const d = new Date(log.createdAt);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const user = log.user?.email || log.user?.name || log.userId || "";
  const userStr = user ? dim(`(${user})`) : "";
  const dur = log.durationMs !== null && log.durationMs !== undefined ? dim(`${log.durationMs}ms`) : "";
  const event = log.eventType ? yellow(`[${log.eventType}]`) : "";

  return `${dim(`[${time}]`)} ${formatStatus(log.status)} ${formatMethod(log.method).trim()} ${cyan(log.endpoint)} ${formatSource(log.source)} ${dur} ${event} ${userStr}`.replace(/\s+/g, " ").trim();
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
