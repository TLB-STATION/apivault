import { API_BASE_URL, readToken } from "./config";

/** Error wrapper carrying the HTTP status and parsed body. */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface RequestOpts {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** JSON body (sets application/json). */
  json?: unknown;
  /** Override the stored Bearer token (used during the connect handshake). */
  token?: string;
  /** Send the request without a Bearer token (for /api/cli/request & /status). */
  noAuth?: boolean;
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
    const headers: Record<string, string> = { Accept: "application/json" };

    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
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
      throw new ApiError(this.extractMessage(parsed, res.status), res.status, parsed);
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

  private extractMessage(parsed: unknown, status: number): string {
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { error?: unknown }).error === "string"
    ) {
      return (parsed as { error: string }).error;
    }
    if (status === 401) return "You are not signed in. Run `apivault login`.";
    if (status === 404) return "Not found.";
    return `Request failed (HTTP ${status}).`;
  }
}

/** Default singleton client. */
export const client = new ApiClient();
