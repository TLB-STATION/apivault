import { API_BASE_URL, getTokenExpiry, readToken } from "./config";
import pkg from "../package.json";

/** Error wrapper carrying the HTTP status, parsed body, and machine code. */
export class ApiError extends Error {
  status: number;
  body: unknown;
  /** Stable machine code from the server body (e.g. "VAULT_KEY_REQUIRED"). */
  code?: string;
  /** Seconds to wait, from the `Retry-After` header on a throttled response. */
  retryAfterSeconds?: number;
  constructor(
    message: string,
    status: number,
    body: unknown,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.retryAfterSeconds = retryAfterSeconds;
    if (
      body &&
      typeof body === "object" &&
      typeof (body as { code?: unknown }).code === "string"
    ) {
      this.code = (body as { code: string }).code;
    }
  }
}

/** Render a `Retry-After` delay as "in 2m 30s" / "in 45s". */
function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `in ${minutes}m ${rest}s` : `in ${minutes}m`;
}

export interface RequestOpts {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** JSON body (sets application/json). */
  json?: unknown;
  /** Override the stored Bearer token (used during the connect handshake). */
  token?: string;
  /** Send the request without a Bearer token (for /api/cli/request & /status). */
  noAuth?: boolean;
  /** Extra headers (e.g. X-Vault-Key for custom-mode decrypts). */
  headers?: Record<string, string>;
  /** The target project ID, sent as X-Project-Id. */
  projectId?: string;
}

/**
 * HTTP client for the ApiVault instance. Sends `Authorization: Bearer <token>`
 * from the persisted token on every request (unless `noAuth` or an explicit
 * `token` override is given).
 */
export class ApiClient {
  readonly baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /** Issue a request. */
  async request<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
    const url = this.absolute(path);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": `apivault-cli/${pkg.version}`,
      ...opts.headers,
    };

    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (opts.projectId) {
      headers["X-Project-Id"] = opts.projectId;
    }

    const token = opts.noAuth ? undefined : opts.token ?? readToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? "GET",
        headers,
        body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
      });
    } catch {
      throw new ApiError(
        `Could not reach ApiVault at ${this.baseUrl}. Is the server running?`,
        0,
        undefined,
      );
    }

    if (!res.ok) {
      const parsed = await this.safeJson(res);
      const retryAfter = this.readRetryAfter(res);
      throw new ApiError(
        this.extractMessage(parsed, res.status, retryAfter),
        res.status,
        parsed,
        retryAfter,
      );
    }

    if (res.status === 204) return undefined as unknown as T;
    const text = await res.text();
    if (!text) return undefined as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  absolute(path: string): string {
    return path.startsWith("http") ? path : `${this.baseUrl}${path}`;
  }

  private async safeJson(res: Response): Promise<unknown> {
    try {
      const text = await res.text();
      return text ? JSON.parse(text) : undefined;
    } catch {
      return undefined;
    }
  }

  /** `Retry-After` in seconds, when the server sent a numeric one. */
  private readRetryAfter(res: Response): number | undefined {
    const raw = res.headers.get("retry-after");
    if (!raw) return undefined;
    const seconds = Number.parseInt(raw, 10);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
  }

  private extractMessage(
    parsed: unknown,
    status: number,
    retryAfterSeconds?: number,
  ): string {
    const serverError =
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { error?: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : undefined;

    // The server answers every unusable token with a bare "Unauthorized", so
    // say what actually needs doing. CLI tokens expire 90 days after approval.
    if (status === 401 && (!serverError || serverError === "Unauthorized")) {
      const expiry = getTokenExpiry();
      if (expiry && expiry.getTime() <= Date.now()) {
        return `This device's token expired on ${expiry.toLocaleDateString()}. Run \`apivault login\` to reconnect.`;
      }
      return "Not signed in — this device's token is missing, expired, or was revoked. Run `apivault login`.";
    }

    if (status === 429 && retryAfterSeconds) {
      const wait = formatRetryAfter(retryAfterSeconds);
      return serverError
        ? `${serverError} Try again ${wait}.`
        : `Too many requests. Try again ${wait}.`;
    }

    if (serverError) return serverError;
    if (status === 404) return "Not found.";
    return `Request failed (HTTP ${status}).`;
  }
}

/** Default singleton client. */
export const client = new ApiClient();
