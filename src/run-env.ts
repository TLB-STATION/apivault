import { existsSync, readdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

/** Suffix applied when `apivault run` moves local dotenv files out of the way. */
export const HIDDEN_DOTENV_SUFFIX = ".apivault-run-hidden";

const HIDDEN_SUFFIX = HIDDEN_DOTENV_SUFFIX;

/** Dotenv filenames commonly loaded by Next.js, Vite, Prisma, and dotenv. */
const KNOWN_DOTENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.production",
  ".env.production.local",
  ".env.test",
  ".env.test.local",
];

/** Non-secret parent env keys worth preserving for the child process. */
const PRESERVED_ENV_KEYS = new Set([
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "TEMP",
  "TMP",
  "APPDATA",
  "LOCALAPPDATA",
  "USER",
  "USERNAME",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NODE_ENV",
  "PORT",
  "HOST",
  "HOSTNAME",
  "CI",
  "FORCE_COLOR",
  "NO_COLOR",
  "TERM_PROGRAM",
  "COLORTERM",
  "WSL_DISTRO_NAME",
  "WT_SESSION",
]);

function shouldPreserveEnvKey(key: string): boolean {
  if (PRESERVED_ENV_KEYS.has(key)) return true;
  if (key.startsWith("npm_") || key.startsWith("NPM_")) return true;
  return false;
}

/**
 * Build an isolated environment for `apivault run`: preserve essential
 * system/shell vars, inject vault secrets, and tell Next.js not to merge
 * local dotenv files into process.env.
 */
export function buildRunEnv(secrets: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    __NEXT_PROCESSED_ENV: "true",
  };

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && shouldPreserveEnvKey(key)) {
      env[key] = value;
    }
  }

  Object.assign(env, secrets);
  return env;
}

function isHiddenDotenvBackup(name: string): boolean {
  return name.endsWith(HIDDEN_SUFFIX);
}

/** Collect dotenv filenames present in `dir` (known names plus `.env.*` variants). */
function listDotenvFiles(dir: string): string[] {
  const found = new Set<string>();

  for (const name of KNOWN_DOTENV_FILES) {
    if (existsSync(join(dir, name))) {
      found.add(name);
    }
  }

  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(".env")) continue;
      if (isHiddenDotenvBackup(name)) continue;
      if (name === ".env.example" || name === ".env.sample" || name === ".env.template") {
        continue;
      }

      const fullPath = join(dir, name);
      try {
        if (statSync(fullPath).isFile()) {
          found.add(name);
        }
      } catch {
        // ignore unreadable entries
      }
    }
  } catch {
    // ignore unreadable directories
  }

  return [...found].sort();
}

/**
 * Rename local dotenv files so frameworks do not read them. Files are left
 * renamed (e.g. `.env` → `.env.apivault-run-hidden`) and are not restored.
 */
export function hideDotenvFiles(dir: string): string[] {
  const hidden: string[] = [];
  const renamed: Array<{ hiddenPath: string; originalPath: string }> = [];

  for (const name of listDotenvFiles(dir)) {
    const originalPath = join(dir, name);
    const hiddenPath = join(dir, `${name}${HIDDEN_SUFFIX}`);

    if (existsSync(hiddenPath)) {
      throw new Error(
        `Cannot hide ${name}: ${name}${HIDDEN_SUFFIX} already exists. Remove or rename it and retry.`,
      );
    }

    try {
      renameSync(originalPath, hiddenPath);
      renamed.push({ hiddenPath, originalPath });
      hidden.push(name);
    } catch (err) {
      for (const { hiddenPath: hiddenFile, originalPath: original } of [...renamed].reverse()) {
        try {
          if (existsSync(hiddenFile)) renameSync(hiddenFile, original);
        } catch {
          // best-effort rollback on failure before spawn
        }
      }
      throw err;
    }
  }

  return hidden;
}

/** List dotenv backup filenames (e.g. `.env.apivault-run-hidden`) in `dir`. */
export function listHiddenDotenvFiles(dir: string): string[] {
  const found: string[] = [];

  try {
    for (const name of readdirSync(dir)) {
      if (!isHiddenDotenvBackup(name)) continue;

      const fullPath = join(dir, name);
      try {
        if (statSync(fullPath).isFile()) {
          found.push(name);
        }
      } catch {
        // ignore unreadable entries
      }
    }
  } catch {
    // ignore unreadable directories
  }

  return found.sort();
}

/**
 * Restore dotenv files moved aside by `apivault run`
 * (`.env.apivault-run-hidden` → `.env`).
 */
export function restoreDotenvFiles(dir: string): string[] {
  const restored: string[] = [];

  for (const hiddenName of listHiddenDotenvFiles(dir)) {
    const originalName = hiddenName.slice(0, -HIDDEN_SUFFIX.length);
    if (!originalName.startsWith(".env")) {
      continue;
    }

    const hiddenPath = join(dir, hiddenName);
    const originalPath = join(dir, originalName);

    if (existsSync(originalPath)) {
      throw new Error(
        `Cannot restore ${originalName}: ${originalName} already exists. Remove or rename it and retry.`,
      );
    }

    renameSync(hiddenPath, originalPath);
    restored.push(originalName);
  }

  return restored;
}
