import { Command } from "commander";
import { ApiError, client } from "../http";
import { type GlobalOptions, getActiveProjectId } from "../config";
import {
  type LogEntryDTO,
  renderLogsTable,
  renderLogDetail,
  renderLogStreamLine,
  printJson,
  dim,
  cyan,
  yellow,
  reportError,
} from "../ui/format";

export interface LogsResponse {
  logs: LogEntryDTO[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  isIncremental?: boolean;
}

export interface LogOpts extends GlobalOptions {
  limit?: number;
  page?: number;
  follow?: boolean;
  status?: string;
  source?: string;
  method?: string;
  user?: string;
  endpoint?: string;
  eventType?: string;
  apiKey?: string;
  key?: string;
  search?: string;
  date?: string;
  endDate?: string;
}

async function resolveProjectId(projectFlag?: string): Promise<string> {
  const active = getActiveProjectId(projectFlag);
  if (active) return active;

  // Auto-resolve first project if none is active
  const projects = await client.request<Array<{ id: string; name: string }>>("/api/projects");
  if (!projects || projects.length === 0) {
    throw new ApiError(
      "No projects found. Create a project on https://apivault.tech or link one using `apivault projects use <id>`.",
      404,
      undefined,
    );
  }
  return projects[0].id;
}

function buildLogsQuery(opts: LogOpts, since?: string): string {
  const params = new URLSearchParams();

  if (since) {
    params.set("since", since);
  } else {
    if (opts.page) params.set("page", String(opts.page));
    if (opts.limit) params.set("limit", String(opts.limit));
  }

  if (opts.status) params.set("status", opts.status);
  if (opts.source) params.set("source", opts.source);
  if (opts.method) params.set("method", opts.method.toUpperCase());
  if (opts.user) params.set("user", opts.user);
  if (opts.endpoint) params.set("endpoint", opts.endpoint);
  if (opts.eventType) params.set("eventType", opts.eventType);
  if (opts.apiKey || opts.key) params.set("apiKey", (opts.apiKey || opts.key)!);
  if (opts.search) params.set("search", opts.search);
  if (opts.date) params.set("date", opts.date);
  if (opts.endDate) {
    params.set("endDate", opts.endDate);
    params.set("isRange", "true");
  }

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** apivault logs [list] */
async function listLogs(opts: LogOpts): Promise<void> {
  const projectId = await resolveProjectId(opts.project);

  if (opts.follow) {
    await followLogs(projectId, opts);
    return;
  }

  const query = buildLogsQuery(opts);
  const path = `/api/projects/${encodeURIComponent(projectId)}/logs${query}`;
  const res = await client.request<LogsResponse>(path, { projectId });

  if (opts.json) {
    printJson(res);
    return;
  }

  const logs = res?.logs || [];
  if (logs.length === 0) {
    process.stdout.write(dim("No logs found matching criteria.\n"));
    return;
  }

  process.stdout.write(renderLogsTable(logs) + "\n");

  if (res.pagination) {
    const { page, totalPages, total } = res.pagination;
    process.stdout.write(
      dim(`Showing page ${page} of ${totalPages} (${logs.length} of ${total} logs)\n`),
    );
  }
}

/** Real-time log streaming loop */
async function followLogs(projectId: string, opts: LogOpts): Promise<void> {
  if (!opts.json) {
    process.stdout.write(
      dim(`Streaming live logs for project ${cyan(projectId)} (Ctrl+C to exit)...\n\n`),
    );
  }

  // Initial fetch to get latest entries
  const initialLimit = opts.limit || 20;
  const initialQuery = buildLogsQuery({ ...opts, limit: initialLimit, page: 1 });
  const initialRes = await client.request<LogsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/logs${initialQuery}`,
    { projectId },
  );

  let latestTimestamp: string | null = null;
  const initialLogs = (initialRes?.logs || []).slice().reverse();

  for (const log of initialLogs) {
    if (opts.json) {
      printJson(log);
    } else {
      process.stdout.write(renderLogStreamLine(log) + "\n");
    }
    latestTimestamp = log.createdAt;
  }

  // If no logs existed yet, use current time as checkpoint
  if (!latestTimestamp) {
    latestTimestamp = new Date().toISOString();
  }

  // Poll loop
  let running = true;
  const cleanup = () => {
    running = false;
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  /**
   * A dropped connection or a blip on the server is worth riding out — the
   * next tick re-polls from the same checkpoint, so nothing is missed.
   * Anything that will keep failing is not: an expired or revoked token, a
   * lost role, a rejected filter. Silently retrying those turns a broken
   * stream into one that merely looks quiet.
   */
  const isFatalPollError = (err: unknown): boolean =>
    err instanceof ApiError && [400, 401, 403, 404].includes(err.status);

  try {
    while (running) {
      await new Promise((r) => setTimeout(r, 2000));
      if (!running) break;

      try {
        const pollQuery = buildLogsQuery(opts, latestTimestamp);
        const pollRes = await client.request<LogsResponse>(
          `/api/projects/${encodeURIComponent(projectId)}/logs${pollQuery}`,
          { projectId },
        );

        const incoming = (pollRes?.logs || []).slice().reverse();
        for (const log of incoming) {
          if (opts.json) {
            printJson(log);
          } else {
            process.stdout.write(renderLogStreamLine(log) + "\n");
          }
          latestTimestamp = log.createdAt;
        }
      } catch (err) {
        if (isFatalPollError(err)) throw err;
      }
    }
  } finally {
    process.removeListener("SIGINT", cleanup);
    process.removeListener("SIGTERM", cleanup);
  }
}

/** apivault logs get <id> */
async function getLog(id: string, opts: LogOpts): Promise<void> {
  const projectId = await resolveProjectId(opts.project);

  // Search by exact ID or query logs
  const res = await client.request<LogsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/logs?search=${encodeURIComponent(id)}&limit=10`,
    { projectId },
  );

  const found = (res?.logs || []).find((l) => l.id === id) || (res?.logs || [])[0];

  if (!found || (found.id !== id && !found.id.startsWith(id))) {
    throw new ApiError(`No log found with ID "${id}".`, 404, undefined);
  }

  if (opts.json) {
    printJson(found);
    return;
  }

  process.stdout.write(renderLogDetail(found) + "\n");
}

/** Register the `logs` command group on the parent program. */
export function registerLogsCommand(program: Command): void {
  const globals = () => program.opts() as LogOpts;
  const json = () => Boolean(program.opts().json);
  const handle = (err: unknown) => {
    reportError(err, json());
    process.exitCode = 1;
  };

  const logs = program
    .command("logs")
    .description("View, filter, and stream audit and request logs for a project")
    .option("-n, --limit <number>", "Number of log entries to fetch (default: 50, max: 1000)", (v) =>
      parseInt(v, 10),
    )
    .option("--page <number>", "Page number for pagination (default: 1)", (v) =>
      parseInt(v, 10),
    )
    .option("-f, --follow", "Stream new logs in real-time as they arrive")
    .option("--status <status>", "Filter by status ('success', 'error', or HTTP status code like 200, 404)")
    .option("--source <source>", "Filter by source ('cli', 'mcp', 'web', 'api')")
    .option("--method <method>", "Filter by HTTP method ('GET', 'POST', 'PUT', 'DELETE')")
    .option("--search <query>", "Search query matching endpoint, method, IP, user, or details")
    .option("--event-type <type>", "Filter by event type (e.g., 'KEY_REVEALED', 'KEY_ROTATED')")
    .option("--user <userId>", "Filter by user ID")
    .option("--key <key>", "Filter by API key ID or name")
    .option("--date <YYYY-MM-DD>", "Filter logs on or after this date")
    .option("--end-date <YYYY-MM-DD>", "Filter logs up to this date")
    .action(async (localOpts: LogOpts) => {
      await listLogs({ ...globals(), ...localOpts }).catch(handle);
    });

  logs
    .command("list")
    .description("List logs (default command)")
    .option("-n, --limit <number>", "Number of log entries to fetch (default: 50, max: 1000)", (v) =>
      parseInt(v, 10),
    )
    .option("--page <number>", "Page number for pagination (default: 1)", (v) =>
      parseInt(v, 10),
    )
    .option("-f, --follow", "Stream new logs in real-time as they arrive")
    .option("--status <status>", "Filter by status ('success', 'error', or HTTP status code)")
    .option("--source <source>", "Filter by source ('cli', 'mcp', 'web', 'api')")
    .option("--method <method>", "Filter by HTTP method ('GET', 'POST', 'PUT', 'DELETE')")
    .option("--search <query>", "Search query matching endpoint, method, IP, user, or details")
    .option("--event-type <type>", "Filter by event type")
    .option("--user <userId>", "Filter by user ID")
    .option("--key <key>", "Filter by API key ID or name")
    .option("--date <YYYY-MM-DD>", "Filter logs on or after this date")
    .option("--end-date <YYYY-MM-DD>", "Filter logs up to this date")
    .action(async (localOpts: LogOpts) => {
      await listLogs({ ...globals(), ...localOpts }).catch(handle);
    });

  logs
    .command("tail")
    .description("Stream live logs in real-time (alias for `apivault logs --follow`)")
    .option("-n, --limit <number>", "Initial number of log entries to display (default: 20)", (v) =>
      parseInt(v, 10),
    )
    .option("--status <status>", "Filter by status ('success', 'error', or HTTP status code)")
    .option("--source <source>", "Filter by source ('cli', 'mcp', 'web', 'api')")
    .option("--method <method>", "Filter by HTTP method ('GET', 'POST', 'PUT', 'DELETE')")
    .option("--search <query>", "Search query")
    .option("--event-type <type>", "Filter by event type")
    .action(async (localOpts: LogOpts) => {
      await listLogs({ ...globals(), ...localOpts, follow: true }).catch(handle);
    });

  logs
    .command("get <id>")
    .alias("inspect")
    .description("Inspect full details of a specific log entry by ID")
    .action(async (id: string) => {
      await getLog(id, globals()).catch(handle);
    });
}
