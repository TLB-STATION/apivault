import { getConfigValue, isServiceTokenMode } from "./config";
import { client } from "./http";

/** The machine identity behind an `APIVAULT_TOKEN`, as reported by the server. */
export interface ServiceIdentity {
  kind: "service";
  name: string;
  projectId: string;
  scopes: string[];
  /** The environment this token is pinned to, or null when unpinned. */
  environment: string | null;
}

/**
 * Cached because several commands ask for the identity during one run, and it
 * cannot change mid-process. `undefined` = not looked up yet, `null` = looked
 * up and this is not a service token.
 */
let cachedIdentity: ServiceIdentity | null | undefined;

/** Reset the cache. Tests only. */
export function clearServiceIdentityCache(): void {
  cachedIdentity = undefined;
}

/**
 * The service token's identity, or null when the caller is a signed-in user.
 *
 * Only issues a request in service-token mode, so an ordinary `apivault run`
 * on a developer's machine costs nothing.
 */
export async function getServiceIdentity(): Promise<ServiceIdentity | null> {
  if (!isServiceTokenMode()) return null;
  if (cachedIdentity !== undefined) return cachedIdentity;

  const me = await client.request<Partial<ServiceIdentity> & { kind?: string }>(
    "/api/cli/me",
  );
  cachedIdentity =
    me && me.kind === "service" ? (me as ServiceIdentity) : null;
  return cachedIdentity;
}

/**
 * Decide which environment to load secrets from.
 *
 * Order: explicit `--env` → the token's environment pin → local config → error.
 *
 * The pin outranks local config deliberately. A pinned token can only ever read
 * its own environment, so honouring a stale `run.env` from the developer's
 * machine would send a request the server is bound to refuse — and in a fresh
 * CI container there is no config to read at all. Putting the pin first is what
 * makes `apivault run -- npm start` work with no configuration.
 *
 * An explicit `--env` still wins, so a contradiction surfaces as the server's
 * ENVIRONMENT_MISMATCH rather than being silently rewritten.
 */
export async function resolveEnvironment(
  explicit: string | undefined,
): Promise<string> {
  const flag = explicit?.trim();
  if (flag) return flag;

  const identity = await getServiceIdentity();
  if (identity?.environment) return identity.environment;

  const configured = getConfigValue("run.env")?.trim();
  if (configured) return configured;

  if (identity) {
    throw new Error(
      `Service token "${identity.name}" is not pinned to an environment, so there is no default. ` +
        "Pass --env <environment>, or create a token pinned to one environment.",
    );
  }

  throw new Error(
    "No environment specified. Pass --env <env>, or set a default with `apivault config set run.env <env>`.",
  );
}
