import open from "open";
import { ApiClient, ApiError } from "./http";
import { API_BASE_URL, clearToken, readToken, writeToken, type GlobalOptions } from "./config";
import { green, dim, yellow, bold } from "./ui/format";

const POLL_INTERVAL_MS = 1500;
const DEFAULT_TIMEOUT_SEC = 300;

interface ConnectRequestResponse {
  requestId: string;
  requestToken: string;
  expiresAt: string;
}

interface ConnectStatusResponse {
  status: "pending" | "approved" | "denied" | "consumed" | "expired";
  apiToken?: string;
  user?: { email?: string | null; name?: string | null };
}

/**
 * `apivault login` — browser-based connect flow.
 *
 * Creates a one-time connect request, opens the browser to the Approve/Refuse
 * page, and polls until the user acts (or the request expires / times out). On
 * approval, the returned API token is persisted for all later commands.
 */
export async function runLogin(opts: GlobalOptions): Promise<void> {
  const client = new ApiClient(API_BASE_URL);

  // 1. Start a connect request.
  const req = await client.request<ConnectRequestResponse>("/api/cli/request", {
    method: "POST",
    noAuth: true,
  });

  const connectUrl = `${API_BASE_URL}/cli/connect?rid=${encodeURIComponent(req.requestId)}`;
  process.stdout.write(bold("Opening your browser to approve the CLI connection…\n"));
  process.stdout.write(dim(`If it doesn't open, visit:\n  ${connectUrl}\n\n`));

  try {
    await open(connectUrl);
  } catch {
    // Browser launch failure is non-fatal — we already printed the URL.
  }

  // 2. Poll for the user's decision.
  const deadline =
    Date.now() + (opts.timeout ?? DEFAULT_TIMEOUT_SEC) * 1000;
  const serverDeadline = new Date(req.expiresAt).getTime();
  const effectiveDeadline = Math.min(deadline, serverDeadline);

  process.stdout.write(dim("Waiting for approval… (press Ctrl+C to cancel)\n"));

  let lastDot = 0;
  while (Date.now() < effectiveDeadline) {
    const res = await client.request<ConnectStatusResponse>("/api/cli/status", {
      method: "POST",
      noAuth: true,
      json: { requestToken: req.requestToken },
    });

    if (res.status === "approved" && res.apiToken) {
      writeToken({ apiToken: res.apiToken, email: res.user?.email, name: res.user?.name });
      process.stdout.write("\n");
      process.stdout.write(
        green("✔") +
          ` Connected as ${bold(res.user?.email ?? "your account")}` +
          (res.user?.name ? ` ${dim(`(${res.user.name})`)}` : "") +
          "\n",
      );
      return;
    }

    if (res.status === "denied") {
      process.stdout.write("\n");
      throw new ApiError("Connection refused. No token was issued.", 403, res);
    }

    if (res.status === "expired" || res.status === "consumed") {
      process.stdout.write("\n");
      throw new ApiError(
        "This connection request expired or was already used. Run `apivault login` again.",
        410,
        res,
      );
    }

    // pending — show a lightweight progress indicator.
    process.stdout.write(".");
    lastDot++;
    if (lastDot % 40 === 0) process.stdout.write("\n");
    await sleep(POLL_INTERVAL_MS);
  }

  process.stdout.write("\n");
  throw new ApiError(
    "Timed out waiting for approval. Run `apivault login` again.",
    408,
    undefined,
  );
}

/** `apivault logout` — revoke the token server-side and clear it locally. */
export async function runLogout(): Promise<void> {
  const token = readToken();
  if (!token) {
    process.stdout.write(dim("Not signed in.\n"));
    return;
  }
  const client = new ApiClient(API_BASE_URL);
  try {
    await client.request("/api/cli/token", { method: "DELETE" });
  } catch {
    // Even if revoke fails (server down, already revoked), clear locally.
  }
  clearToken();
  process.stdout.write(green("✔") + " Signed out.\n");
}

/** `apivault whoami` — show the connected user. */
export async function runWhoami(opts: GlobalOptions): Promise<void> {
  const client = new ApiClient(API_BASE_URL);

  if (!readToken()) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ authenticated: false }) + "\n");
    } else {
      process.stdout.write(yellow("Not signed in. Run `apivault login`.\n"));
    }
    return;
  }

  const me = await client.request<{ email?: string | null; name?: string | null }>(
    "/api/cli/me",
  );

  if (opts.json) {
    process.stdout.write(JSON.stringify({ authenticated: true, user: me }) + "\n");
    return;
  }
  process.stdout.write(
    green("✔") +
      ` Signed in as ${bold(me.email ?? "?")}` +
      (me.name ? ` ${dim(`(${me.name})`)}` : "") +
      "\n",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
