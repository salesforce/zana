import {
  existsSync,
  readFileSync,
  statSync,
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
  return createAutomatedConfigDirWithWarnings(dataDir, ownerId, seed).configDir;
}

/** Like {@link createAutomatedConfigDir}, also returning the persona MCP allowlist launch warnings. */
export function createAutomatedConfigDirWithWarnings(
  dataDir: string,
  ownerId: string,
  seed: AutomatedSeedOptions = {},
): { configDir: string; warnings: McpLaunchWarning[] } {
  let leaf: string | undefined;
  try {
    leaf = createConfinedConfigLeaf({ dataDir, ownerId, parentName: AUTOMATED_CONFIG_PARENT });
    const { warnings } = seedAutomatedConfigDirWithWarnings(leaf, seed);
    if (!automatedConfigCanAuthenticate(leaf, seed.env)) {
      removeAutomatedConfigDir(dataDir, leaf);
      throw new AutomatedConfigAdmissionError("authentication-unavailable");
    }
    return { configDir: leaf, warnings };
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

/**
 * Non-fatal launch warning about a persona MCP allowlist entry (AC-15); same shape
 * as the host copy (parity test). `not-found`: not in the user config;
 * `unsafe-config`: sanitizer rejected the launch config; `credentials-stripped`:
 * carried without env/headers/oauth/auth.
 */
export interface McpLaunchWarning {
  code: "allowlisted-mcp-not-carried" | "allowlisted-mcp-credentials-stripped";
  server: string;
  reason: "not-found" | "unsafe-config" | "credentials-stripped";
  message: string;
}

export interface AutomatedSeedOptions {
  /**
   * Effective persona MCP allowlist. Absent = unrestricted (byte-identical seed).
   * Present = only covered user servers plus `zcc-inbox` are carried.
   */
  mcpAllowlist?: readonly string[];
  /** Allowlist entries delivered by another path (plugin servers); never warned as missing here. */
  externallyProvidedMcps?: readonly string[];
  /** Directory holding the user's real `settings.json`. Defaults to `$CLAUDE_CONFIG_DIR` or `~/.claude`. */
  sourceConfigDir?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Top-level `settings.json` keys that carry credentials acquisition, never behavior.
 * The only behavioral carry-overs are the narrow, explicit exceptions below:
 * `skipDangerousModePermissionPrompt` (only when literally `true`, so an
 * unattended bypass run does not stop on the consent dialog the user already
 * accepted) and non-secret user-scope MCP launch config (see `sanitizeMcpServers`).
 */
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The real global config (`.claude.json`) is read only up to this size. */
const MAX_GLOBAL_CONFIG_BYTES = 16 * 1024 * 1024;
const MAX_MCP_SERVERS = 64;
const MAX_MCP_NAME_LENGTH = 128;
const MAX_MCP_STRING_LENGTH = 4096;
const MAX_MCP_ARGS = 128;

/**
 * Credential heuristic for MCP launch strings. A server whose `args` or `url`
 * obviously embed a credential is dropped whole rather than copied:
 * - an arg naming a credential flag (`--token`, `--api-key=…`, `-password`,
 *   `--secret`, `--auth…`, `--access-key`, `--client-secret`), with or without
 *   an inline `=value` (a bare flag means the next arg is the secret);
 * - an arg carrying an `Authorization:`/`X-Api-Key:` header or `Bearer <value>`;
 * - a URL (the `url` field, or any arg containing `://`) with userinfo
 *   (`user:pass@host`) or a credential-named query parameter (`?api_key=…`).
 * This is deliberately conservative and obviously incomplete; it only catches
 * the plain-text shapes. Secrets belong in `env`/`headers`, which are never copied.
 */
const CREDENTIAL_ARG =
  /^-{1,2}[\w.-]*(token|api[-_]?key|apikey|secret|passw(or)?d|auth|access[-_]?key|credential)[\w.-]*(=|$)/i;
const CREDENTIAL_ASSIGN =
  /^[\w.-]*(token|api[-_]?key|apikey|secret|passw(or)?d|auth|access[-_]?key|credential)[\w.-]*=/i;
const CREDENTIAL_JSON =
  /"[^"]*(token|api[-_]?key|apikey|secret|passw(or)?d|auth|access[-_]?key|credential)[^"]*"\s*:/i;
const CREDENTIAL_TEXT = /(\bbearer\s+\S|^\s*(authorization|x-api-key|proxy-authorization)\s*:)/i;
const CREDENTIAL_QUERY_KEY =
  /(token|api[-_]?key|apikey|secret|passw(or)?d|auth|signature|sig|credential|key)$/i;

function urlCarriesCredential(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // An unparseable URL cannot be checked, so it cannot be trusted.
    return true;
  }
  if (url.username !== "" || url.password !== "") return true;
  for (const key of url.searchParams.keys()) {
    if (CREDENTIAL_QUERY_KEY.test(key)) return true;
  }
  return false;
}

function argCarriesCredential(arg: string): boolean {
  if (CREDENTIAL_ARG.test(arg) || CREDENTIAL_ASSIGN.test(arg) || CREDENTIAL_JSON.test(arg) || CREDENTIAL_TEXT.test(arg)) return true;
  const scheme = arg.indexOf("://");
  if (scheme < 0) return false;
  const start = arg.slice(0, scheme).search(/[a-z][a-z0-9+.-]*$/i);
  return start >= 0 && urlCarriesCredential(arg.slice(start).split(/\s/)[0]!);
}

function boundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_MCP_STRING_LENGTH;
}

function sanitizeMcpServer(raw: unknown): Record<string, unknown> | null {
  if (!isPlainObject(raw)) return null;
  // Allowlist: `type`, `command`, `args`, `url`. `env`, `headers`,
  // `headersHelper`, oauth/auth and every unknown field are dropped, so a
  // server that needs a secret fails to authenticate loudly instead.
  const server: Record<string, unknown> = {};
  if (raw.type !== undefined) {
    if (!boundedString(raw.type)) return null;
    server.type = raw.type;
  }
  if (raw.command !== undefined) {
    if (!boundedString(raw.command)) return null;
    server.command = raw.command;
  }
  if (raw.args !== undefined) {
    if (!Array.isArray(raw.args) || raw.args.length > MAX_MCP_ARGS) return null;
    if (!raw.args.every((arg) => typeof arg === "string" && arg.length <= MAX_MCP_STRING_LENGTH)) {
      return null;
    }
    if (raw.args.some((arg: string) => argCarriesCredential(arg))) return null;
    server.args = [...raw.args];
  }
  if (raw.url !== undefined) {
    if (!boundedString(raw.url) || urlCarriesCredential(raw.url)) return null;
    server.url = raw.url;
  }
  if (server.command === undefined && server.url === undefined) return null;
  return server;
}

/**
 * Names beginning `plugin:` / `ext:` are the registry's own key namespace
 * (`plugin:<id>:<name>`, `ext:<id>:<name>`). A user-scope server with such a
 * name is dropped so it can never collide with or spoof a contributed key.
 * Kept identical to the host copy (parity test).
 */
const RESERVED_MCP_NAME_PREFIX = /^(plugin|ext):/;

export function isReservedMcpName(name: string): boolean {
  return RESERVED_MCP_NAME_PREFIX.test(name);
}

/**
 * Non-secret launch config for the user's user-scope MCP servers. Malformed,
 * credential-looking or reserved-prefix entries are skipped; this never throws.
 */
export function sanitizeMcpServers(raw: unknown): Record<string, Record<string, unknown>> | null {
  if (!isPlainObject(raw)) return null;
  const picked: Array<[string, Record<string, unknown>]> = [];
  for (const [name, entry] of Object.entries(raw)) {
    if (picked.length >= MAX_MCP_SERVERS) break;
    if (name.length === 0 || name.length > MAX_MCP_NAME_LENGTH) continue;
    if (isReservedMcpName(name)) continue;
    const server = sanitizeMcpServer(entry);
    if (server) picked.push([name, server]);
  }
  // `fromEntries` defines own properties, so a `__proto__` name cannot
  // reach the prototype.
  return picked.length > 0 ? Object.fromEntries(picked) : null;
}

/** Always-allowed server key; mirrors `ALWAYS_ALLOWED_MCP_SERVERS` (this bundle stays self-contained). */
const ALWAYS_ALLOWED_MCP_NAME = "zcc-inbox";

/**
 * Allowlist match for a user-scope server; mirrors `mcpAllowlistCovers` in
 * `@zana-ai/zcc-domain/product` for source "user" (parity test).
 */
export function userMcpAllowlistCovers(entry: string, name: string): boolean {
  if (isReservedMcpName(entry)) return false;
  return entry === name;
}

/** Keeps the sanitized servers an allowlist covers, plus `zcc-inbox`. */
export function filterMcpServersByAllowlist(
  servers: Record<string, Record<string, unknown>> | null,
  allowlist: readonly string[],
): Record<string, Record<string, unknown>> | null {
  if (!servers) return null;
  const kept = Object.entries(servers).filter(
    ([name]) =>
      name === ALWAYS_ALLOWED_MCP_NAME ||
      allowlist.some((entry) => userMcpAllowlistCovers(entry, name)),
  );
  return kept.length > 0 ? Object.fromEntries(kept) : null;
}

const CREDENTIAL_FIELDS = ["env", "headers", "headersHelper", "oauth", "auth", "authorization"] as const;

/** Whether the raw entry held credential-bearing fields that the sanitizer strips. */
export function hasStrippedCredentialFields(entry: unknown): boolean {
  if (!isPlainObject(entry)) return false;
  return CREDENTIAL_FIELDS.some((key) => {
    const value = entry[key];
    if (value === undefined || value === null) return false;
    if (isPlainObject(value)) return Object.keys(value).length > 0;
    return value !== "" && value !== false;
  });
}

/** Warnings for allowlisted names that were not carried or lost credential fields. Never includes a credential value. */
export function mcpAllowlistWarnings(
  allowlist: readonly string[],
  rawServers: Record<string, unknown>,
  sanitized: Record<string, Record<string, unknown>> | null,
  externallyProvided: readonly string[] = [],
): McpLaunchWarning[] {
  const warnings: McpLaunchWarning[] = [];
  for (const entry of new Set(allowlist)) {
    // Registry-keyed entries and zcc-inbox are delivered elsewhere, not from user config.
    if (
      entry === ALWAYS_ALLOWED_MCP_NAME ||
      isReservedMcpName(entry) ||
      externallyProvided.includes(entry)
    ) {
      continue;
    }
    if (!Object.hasOwn(rawServers, entry)) {
      warnings.push({
        code: "allowlisted-mcp-not-carried",
        server: entry,
        reason: "not-found",
        message: `Allowlisted MCP server "${entry}" was not found in the Claude user config and is not available in this run.`,
      });
    } else if (!sanitized || !Object.hasOwn(sanitized, entry)) {
      warnings.push({
        code: "allowlisted-mcp-not-carried",
        server: entry,
        reason: "unsafe-config",
        message: `Allowlisted MCP server "${entry}" was not carried: its launch config is malformed or embeds a credential.`,
      });
    } else if (hasStrippedCredentialFields(rawServers[entry])) {
      warnings.push({
        code: "allowlisted-mcp-credentials-stripped",
        server: entry,
        reason: "credentials-stripped",
        message: `Allowlisted MCP server "${entry}" launches without its env, headers or auth (stripped for the isolated run); it may fail to authenticate.`,
      });
    }
  }
  return warnings;
}

function readJsonObject(file: string, maxBytes?: number): Record<string, unknown> | null {
  try {
    if (maxBytes !== undefined && statSync(file).size > maxBytes) return null;
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Builds the generated settings from the user's real ones; null when there is nothing to carry. */
export function buildSeedSettings(source: unknown): Record<string, unknown> | null {
  if (!isPlainObject(source)) return null;
  const generated: Record<string, unknown> = {};
  for (const key of SEED_SETTINGS_KEYS) {
    if (typeof source[key] === "string") generated[key] = source[key];
  }
  const rawEnv = source.env;
  if (isPlainObject(rawEnv)) {
    const picked: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawEnv)) {
      if (isSeedEnvKey(key) && typeof value === "string") picked[key] = value;
    }
    if (Object.keys(picked).length > 0) generated.env = picked;
  }
  if (source.skipDangerousModePermissionPrompt === true) {
    generated.skipDangerousModePermissionPrompt = true;
  }
  return Object.keys(generated).length > 0 ? generated : null;
}

/**
 * Seed the per-run config dir with the minimum an unattended session needs to
 * authenticate: a generated `settings.json` holding only the credential-helper
 * keys and an allowlisted `env` subset, plus an onboarding-complete
 * `.claude.json`. The narrow, explicit behavioral exceptions are
 * `skipDangerousModePermissionPrompt: true` and the user's user-scope MCP
 * servers (read from the real global `.claude.json`, where `claude mcp add
 * --scope user` stores them) reduced to non-secret launch config
 * (`type`/`command`/`args`/`url`). Hooks, plugins, marketplaces, permissions,
 * telemetry env and MCP `env`/`headers` are never copied. Returns "none" (and
 * writes nothing) when there is nothing to carry, in which case the session
 * relies on its process env.
 *
 * Keychain: Claude derives its secure-storage (keychain) service name from
 * `CLAUDE_CONFIG_DIR`, overridable by `CLAUDE_SECURESTORAGE_CONFIG_DIR`. That
 * store holds model OAuth credentials alongside MCP OAuth tokens, so pointing a
 * leaf at the real one would share login state; it is deliberately not set,
 * and OAuth-authenticated MCP servers need re-authentication in automated runs.
 */
export function seedAutomatedConfigDir(
  leaf: string,
  options: AutomatedSeedOptions = {},
): "seeded" | "none" {
  return seedAutomatedConfigDirWithWarnings(leaf, options).result;
}

/** Like {@link seedAutomatedConfigDir}, also returning the persona MCP allowlist launch warnings. */
export function seedAutomatedConfigDirWithWarnings(
  leaf: string,
  options: AutomatedSeedOptions = {},
): { result: "seeded" | "none"; warnings: McpLaunchWarning[] } {
  const env = options.env ?? process.env;
  const sourceDir =
    options.sourceConfigDir ??
    (env.CLAUDE_CONFIG_DIR ? resolve(env.CLAUDE_CONFIG_DIR) : join(homedir(), ".claude"));
  // Transcripts keep landing in the real projects dir, so transcript-derived
  // features and resume are unaffected by the relocated config dir.
  const realProjects = join(sourceDir, "projects");
  const linkPath = join(leaf, "projects");
  if (existsSync(sourceDir)) linkProjects(realProjects, linkPath);
  const generated = buildSeedSettings(readJsonObject(join(sourceDir, "settings.json")));
  const globalConfig = readJsonObject(
    automatedSourceGlobalConfig(sourceDir, env, options.sourceConfigDir !== undefined),
    MAX_GLOBAL_CONFIG_BYTES,
  );
  const sanitizedServers = sanitizeMcpServers(globalConfig?.mcpServers);
  const mcpServers = options.mcpAllowlist
    ? filterMcpServersByAllowlist(sanitizedServers, options.mcpAllowlist)
    : sanitizedServers;
  const warnings = options.mcpAllowlist
    ? mcpAllowlistWarnings(
        options.mcpAllowlist,
        isPlainObject(globalConfig?.mcpServers) ? globalConfig.mcpServers : {},
        sanitizedServers,
        options.externallyProvidedMcps,
      )
    : [];
  if (!generated && !mcpServers) return { result: "none", warnings };
  writeAtomic0600(join(leaf, "settings.json"), JSON.stringify(generated ?? {}));
  writeAtomic0600(
    join(leaf, ".claude.json"),
    JSON.stringify({ hasCompletedOnboarding: true, ...(mcpServers ? { mcpServers } : {}) }),
  );
  return { result: "seeded", warnings };
}

/**
 * The real global config: inside the config dir when one is set (env or an
 * explicit source dir), otherwise `~/.claude.json` next to `~/.claude`.
 */
export function automatedSourceGlobalConfig(
  sourceDir: string,
  env: NodeJS.ProcessEnv,
  explicitSourceDir: boolean,
): string {
  return explicitSourceDir || env.CLAUDE_CONFIG_DIR
    ? join(sourceDir, ".claude.json")
    : join(homedir(), ".claude.json");
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

/**
 * Persona MCP allowlist launch warnings (an allowlisted server missing or stripped of credentials)
 * as visible `provider.warning` deltas. Server names and reasons only; never definitions or
 * credential values.
 */
export function mcpLaunchWarningDeltas(
  warnings: readonly McpLaunchWarning[],
): Array<{ kind: "provider.warning"; summary: string; details: string }> {
  return warnings.map((warning) => ({
    kind: "provider.warning" as const,
    summary: `Persona MCP allowlist: ${warning.server}`,
    details: warning.message,
  }));
}
