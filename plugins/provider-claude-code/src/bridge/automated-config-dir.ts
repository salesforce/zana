import {
  existsSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  experimental_confinedConfigParent as confinedConfigParent,
  experimental_createConfinedConfigLeaf as createConfinedConfigLeaf,
  experimental_linkProjects as linkProjects,
  experimental_removeConfinedConfigLeaf as removeConfinedConfigLeaf,
  experimental_sweepConfinedConfigLeaves as sweepConfinedConfigLeaves,
  experimental_writeAtomic0600 as writeAtomic0600,
} from "@zana-ai/zcc-plugin-sdk/provider-bridge";

export const AUTOMATED_CONFIG_PARENT = "claude-automated-config";

export type AutomatedConfigAdmissionReason =
  | "authentication-unavailable"
  | "config-unavailable";

export class AutomatedConfigAdmissionError extends Error {
  constructor(readonly reason: AutomatedConfigAdmissionReason, cause?: unknown) {
    super(`Automated Claude admission blocked: ${reason}`, { cause });
  }
}

export function automatedConfigParent(dataDir: string): string {
  return confinedConfigParent(dataDir, AUTOMATED_CONFIG_PARENT);
}

/**
 * Create (or reuse) the `0700` per-owner `CLAUDE_CONFIG_DIR` leaf under the Zana
 * data dir. The same owner id always maps to the same leaf, so resume reuses it.
 * Throws a stable admission error when the isolated dir cannot authenticate or
 * cannot be prepared. Callers must not take the interactive path.
 */
export function createAutomatedConfigDir(
  dataDir: string,
  ownerId: string,
  seed: AutomatedSeedOptions = {},
): string {
  let leaf: string | undefined;
  try {
    leaf = createConfinedConfigLeaf({ dataDir, ownerId, parentName: AUTOMATED_CONFIG_PARENT });
    seedAutomatedConfigDir(leaf, seed);
    if (!automatedConfigCanAuthenticate(leaf, seed.env)) {
      removeAutomatedConfigDir(dataDir, leaf);
      throw new AutomatedConfigAdmissionError("authentication-unavailable");
    }
    return leaf;
  } catch (error) {
    if (error instanceof AutomatedConfigAdmissionError) throw error;
    if (leaf) {
      try {
        removeAutomatedConfigDir(dataDir, leaf);
      } catch {
        // Confined cleanup is best effort; never traverse an untrusted path.
      }
    }
    throw new AutomatedConfigAdmissionError("config-unavailable", error);
  }
}

export interface AutomatedSeedOptions {
  /** Directory holding the user's real `settings.json`. Defaults to `$CLAUDE_CONFIG_DIR` or `~/.claude`. */
  sourceConfigDir?: string;
  env?: NodeJS.ProcessEnv;
}

/** Top-level `settings.json` keys that carry credentials acquisition, never behavior. */
const SEED_SETTINGS_KEYS = [
  "apiKeyHelper",
  "awsAuthRefresh",
  "awsCredentialExport",
  "forceLoginMethod",
] as const;

/** `env` entries copied into the seed: auth, gateway, proxy and CA trust only. */
const SEED_ENV_EXACT = new Set([
  "AWS_REGION",
  "AWS_PROFILE",
  "NODE_EXTRA_CA_CERTS",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "API_TIMEOUT_MS",
]);
const SEED_ENV_PREFIX = /^(ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDE_CODE_SKIP_)/;

function isSeedEnvKey(key: string): boolean {
  return SEED_ENV_EXACT.has(key) || SEED_ENV_PREFIX.test(key);
}

/**
 * Seed the per-run config dir with the minimum an unattended session needs to
 * authenticate: a generated `settings.json` holding only the credential-helper
 * keys and an allowlisted `env` subset, plus an onboarding-complete
 * `.claude.json`. Hooks, plugins, marketplaces, permissions and telemetry env
 * are never copied. Returns "none" (and writes nothing) when the real settings
 * cannot be read, in which case the session relies on its process env.
 */
export function seedAutomatedConfigDir(
  leaf: string,
  options: AutomatedSeedOptions = {},
): "seeded" | "none" {
  const env = options.env ?? process.env;
  const sourceDir =
    options.sourceConfigDir ??
    (env.CLAUDE_CONFIG_DIR ? resolve(env.CLAUDE_CONFIG_DIR) : join(homedir(), ".claude"));
  // Transcripts keep landing in the real projects dir, so transcript-derived
  // features and resume are unaffected by the relocated config dir.
  const realProjects = join(sourceDir, "projects");
  const linkPath = join(leaf, "projects");
  if (existsSync(sourceDir)) linkProjects(realProjects, linkPath);
  let source: unknown;
  try {
    source = JSON.parse(readFileSync(join(sourceDir, "settings.json"), "utf8"));
  } catch {
    return "none";
  }
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return "none";
  }
  const record = source as Record<string, unknown>;
  const generated: Record<string, unknown> = {};
  for (const key of SEED_SETTINGS_KEYS) {
    if (typeof record[key] === "string") generated[key] = record[key];
  }
  const rawEnv = record.env;
  if (typeof rawEnv === "object" && rawEnv !== null && !Array.isArray(rawEnv)) {
    const picked: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawEnv)) {
      if (isSeedEnvKey(key) && typeof value === "string") picked[key] = value;
    }
    if (Object.keys(picked).length > 0) generated.env = picked;
  }
  if (Object.keys(generated).length === 0) return "none";
  writeAtomic0600(join(leaf, "settings.json"), JSON.stringify(generated));
  writeAtomic0600(
    join(leaf, ".claude.json"),
    JSON.stringify({ hasCompletedOnboarding: true }),
  );
  return "seeded";
}

const AUTH_ENV_KEY = /^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_USE_[A-Z_]+)$/;

function envCarriesAuth(env: Record<string, unknown> | undefined): boolean {
  if (!env) return false;
  return Object.entries(env).some(
    ([key, value]) => AUTH_ENV_KEY.test(key) && typeof value === "string" && value !== "",
  );
}

/**
 * Whether an isolated config dir can authenticate without the user's real one.
 * OAuth/subscription login state (keychain entry, `.credentials.json`,
 * `oauthAccount`) is keyed to the config dir and is deliberately not copied, so
 * an OAuth-only user would start every automated session logged out. Only a
 * credential helper, cloud-provider auth, or an API key (seeded or inherited
 * from the process env) survives the relocation.
 */
export function automatedConfigCanAuthenticate(
  leaf: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (envCarriesAuth(env)) return true;
  try {
    const seeded = JSON.parse(readFileSync(join(leaf, "settings.json"), "utf8")) as Record<
      string,
      unknown
    >;
    if (
      ["apiKeyHelper", "awsAuthRefresh", "awsCredentialExport"].some(
        (key) => typeof seeded[key] === "string",
      )
    ) {
      return true;
    }
    const seededEnv = seeded.env;
    return typeof seededEnv === "object" && seededEnv !== null && envCarriesAuth(seededEnv as Record<string, unknown>);
  } catch {
    return false;
  }
}

export function removeAutomatedConfigDir(dataDir: string, leaf: string): void {
  removeConfinedConfigLeaf(dataDir, AUTOMATED_CONFIG_PARENT, leaf);
}

/** Delete leaves not owned by a live thread whose mtime is older than `ttlMs`. */
export function sweepAutomatedConfigDirs(args: {
  dataDir: string;
  liveOwnerIds: ReadonlySet<string>;
  ttlMs: number;
  now?: number;
}): string[] {
  return sweepConfinedConfigLeaves({
    dataDir: args.dataDir,
    parentName: AUTOMATED_CONFIG_PARENT,
    liveOwnerIds: args.liveOwnerIds,
    ttlMs: args.ttlMs,
    now: args.now,
  });
}
