import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const AUTOMATED_CONFIG_PARENT = "claude-automated-config";

function assertInside(parent: string, child: string): void {
  const rel = relative(parent, child);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error("automated Claude config dir escapes the Zana data dir");
  }
}

function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "_");
  if (cleaned === "" || cleaned === "." || cleaned === "..") {
    throw new Error("invalid automated Claude config dir owner id");
  }
  return cleaned;
}

export function automatedConfigParent(dataDir: string): string {
  return join(resolve(dataDir), AUTOMATED_CONFIG_PARENT);
}

/**
 * Create (or reuse) the `0700` per-owner `CLAUDE_CONFIG_DIR` leaf under the Zana
 * data dir. The same owner id always maps to the same leaf, so resume reuses it.
 * Returns null (leaf removed) when the isolated dir could not authenticate —
 * e.g. an OAuth-only user — so the caller takes the interactive path.
 */
export function createAutomatedConfigDir(
  dataDir: string,
  ownerId: string,
  seed: AutomatedSeedOptions = {},
): string | null {
  const parent = automatedConfigParent(dataDir);
  const leaf = join(parent, safeSegment(ownerId));
  assertInside(parent, leaf);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);
  mkdirSync(leaf, { recursive: true, mode: 0o700 });
  chmodSync(leaf, 0o700);
  seedAutomatedConfigDir(leaf, seed);
  if (!automatedConfigCanAuthenticate(leaf, seed.env)) {
    removeAutomatedConfigDir(dataDir, leaf);
    return null;
  }
  return leaf;
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

function writeAtomic0600(path: string, body: string): void {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, path);
}

/** Point `linkPath` at the real projects dir; never throws, never conjures a missing Claude home. */
function linkProjects(realProjects: string, linkPath: string): void {
  try {
    mkdirSync(realProjects, { recursive: true });
    lstatSync(linkPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
    try {
      symlinkSync(realProjects, linkPath, "dir");
    } catch {
      // best-effort: claude recreates a local projects dir
    }
  }
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
  const parent = automatedConfigParent(dataDir);
  const resolved = resolve(leaf);
  assertInside(parent, resolved);
  rmSync(resolved, { recursive: true, force: true });
}

/** Delete leaves not owned by a live thread whose mtime is older than `ttlMs`. */
export function sweepAutomatedConfigDirs(args: {
  dataDir: string;
  liveOwnerIds: ReadonlySet<string>;
  ttlMs: number;
  now?: number;
}): string[] {
  const parent = automatedConfigParent(args.dataDir);
  const now = args.now ?? Date.now();
  const removed: string[] = [];
  let names: string[];
  try {
    names = readdirSync(parent);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (args.liveOwnerIds.has(name)) continue;
    const leaf = join(parent, name);
    try {
      if (now - statSync(leaf).mtimeMs <= args.ttlMs) continue;
      removeAutomatedConfigDir(args.dataDir, leaf);
      removed.push(name);
    } catch {
      // best effort: a leaf that vanished or cannot be removed is retried next sweep
    }
  }
  return removed;
}
