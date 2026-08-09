import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Base URL of the ApiVault instance the CLI talks to.
 *
 * Hardcoded by design: end users never configure this. For local development it
 * points at the dev server; change this constant when you deploy and rebuild.
 */
export const API_BASE_URL = "http://localhost:3000";

export interface GlobalOptions {
  /** Emit machine-readable JSON instead of formatted tables. */
  json?: boolean;
  /** Maximum seconds to wait for browser approval during login. */
  timeout?: number;
}

const DATA_DIR = join(homedir(), ".apivault");
const TOKEN_PATH = join(DATA_DIR, "token.json");

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/** Stored token payload. */
interface StoredToken {
  apiToken: string;
  email?: string | null;
  name?: string | null;
  createdAt?: string;
}

/** Read the persisted API token, or null if signed out. */
export function readToken(): string | null {
  try {
    if (!existsSync(TOKEN_PATH)) return null;
    const raw = readFileSync(TOKEN_PATH, "utf8");
    const parsed = JSON.parse(raw) as StoredToken;
    return typeof parsed.apiToken === "string" && parsed.apiToken
      ? parsed.apiToken
      : null;
  } catch {
    return null;
  }
}

/** Persist the API token (with optional user identity) after a successful login. */
export function writeToken(token: {
  apiToken: string;
  email?: string | null;
  name?: string | null;
}): void {
  ensureDataDir();
  const payload: StoredToken = { ...token, createdAt: new Date().toISOString() };
  writeFileSync(TOKEN_PATH, JSON.stringify(payload, null, 2), "utf8");
}

/** Remove the persisted token (logout). */
export function clearToken(): void {
  try {
    if (existsSync(TOKEN_PATH)) unlinkSync(TOKEN_PATH);
  } catch {
    // best-effort
  }
}
