import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Base URL of the ApiVault instance the CLI talks to.
 *
 * Hardcoded by design: end users never configure this. For local development it
 * points at the dev server; change this constant when you deploy and rebuild.
 */
export const API_BASE_URL = "https://api-vault-opal.vercel.app";

export interface GlobalOptions {
  /** Emit machine-readable JSON instead of formatted tables. */
  json?: boolean;
  /** Maximum seconds to wait for browser approval during login. */
  timeout?: number;
}

const DATA_DIR = join(homedir(), ".apivault");
const TOKEN_PATH = join(DATA_DIR, "token.json");
const CONFIG_PATH = join(DATA_DIR, "config.json");

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

// --- Local config (defaults for `run`, stored vault key, etc.) -------------

/** Shape of ~/.apivault/config.json. Unknown keys are preserved as-is. */
export interface StoredConfig {
  run?: {
    command?: string;
    env?: string;
  };
  vaultKey?: string;
  [key: string]: unknown;
}

/** Read the persisted config, or an empty object if none exists. */
export function readConfig(): StoredConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as StoredConfig) : {};
  } catch {
    return {};
  }
}

/** Persist the config. File mode is restricted to 0600 on Unix (owner-only). */
export function writeConfig(config: StoredConfig): void {
  ensureDataDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  if (process.platform !== "win32") {
    try {
      chmodSync(CONFIG_PATH, 0o600);
    } catch {
      // best-effort
    }
  }
}

/**
 * Get a nested config value by dot path (e.g. "run.command", "vaultKey").
 * Returns undefined if the path or any ancestor is missing.
 */
export function getConfigValue(path: string): string | undefined {
  const config = readConfig();
  const segments = path.split(".");
  let node: unknown = config;
  for (const seg of segments) {
    if (node && typeof node === "object" && seg in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Set a nested config value by dot path, creating intermediate objects as
 * needed, and persist the result.
 */
export function setConfigValue(path: string, value: string): void {
  const config = readConfig();
  const segments = path.split(".");
  let node: Record<string, unknown> = config;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (typeof node[seg] !== "object" || node[seg] === null) {
      node[seg] = {};
    }
    node = node[seg] as Record<string, unknown>;
  }
  node[segments[segments.length - 1]] = value;
  writeConfig(config);
}

/**
 * Delete a nested config value by dot path. Returns true if it existed.
 * Does not write if the path was absent.
 */
export function deleteConfigValue(path: string): boolean {
  const config = readConfig();
  const segments = path.split(".");
  let node: unknown = config;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (node && typeof node === "object" && seg in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[seg];
    } else {
      return false;
    }
  }
  const last = segments[segments.length - 1];
  const leaf = node as Record<string, unknown>;
  if (node && typeof node === "object" && last in leaf) {
    delete leaf[last];
    writeConfig(config);
    return true;
  }
  return false;
}
