import {
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  experimental_createConfinedConfigLeaf as createConfinedConfigLeaf,
  experimental_linkProjects as linkProjects,
  experimental_removeConfinedConfigLeaf as removeConfinedConfigLeaf,
  experimental_sweepConfinedConfigLeaves as sweepConfinedConfigLeaves,
  experimental_writeAtomic0600 as writeAtomic0600,
} from '@zana-ai/zcc-plugin-sdk/provider-bridge';
import { resolveZccDataDir } from '../../host-config.js';

/**
 * Context isolation for unattended (headless / scheduled / autonomous) Claude
 * CLI sessions. The session gets a per-run `0700` CLAUDE_CONFIG_DIR holding only
 * a generated auth/gateway `settings.json` (plus the narrow exceptions in
 * `seedLeaf`: the bypass-consent flag and non-secret user MCP launch config),
 * and is told to load only the `user`
 * setting source — so the user's hooks, plugins, marketplaces and project/local
 * settings never reach an unattended worker. HOME is untouched.
 *
 * The provider bridge applies the same policy to SDK threads
 * (`plugins/provider-claude-code/src/bridge/automated-config-dir.ts`); the two
 * seeds are held byte-identical by the parity case in `__tests__/automated-isolation.test.ts`.
 */
export const AUTOMATED_CONFIG_PARENT = 'claude-automated-config';
/** Leaves untouched this long and not owned by a live session are swept. */
export const AUTOMATED_CONFIG_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const SEED_SETTINGS_KEYS = ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'forceLoginMethod'] as const;
const SEED_ENV_EXACT = new Set([
  'AWS_REGION',
  'AWS_PROFILE',
  'NODE_EXTRA_CA_CERTS',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'API_TIMEOUT_MS',
]);
const SEED_ENV_PREFIX = /^(ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDE_CODE_SKIP_)/;

export interface AutomatedClaudeLaunchPlan {
  configDir: string;
  /** argv to append (before per-tab extraArgs). */
  args: string[];
  /** env to overlay after every other source so nothing can redirect it. */
  env: Record<string, string>;
}

export type AutomatedClaudeAdmissionReason =
  | 'authentication-unavailable'
  | 'config-unavailable'
  | 'required-mcp-unavailable';

/** Operator-facing explanation for a schedule whose required MCP servers did not reach the isolated config. */
export function requiredMcpUnavailableMessage(missing: readonly string[]): string {
  return (
    `Required MCP server${missing.length === 1 ? '' : 's'} not available in the isolated config: ${missing.join(', ')}. ` +
    'Unattended runs carry over only MCP servers whose launch config holds no secrets; servers that need ' +
    'credentials or a sign-in are not available. Enable "Use my Claude config" for this schedule to use your own MCP servers.'
  );
}

export class AutomatedClaudeAdmissionError extends Error {
  /** True when the failure happened before any process could start, so the launch is safe to record as failed. */
  readonly preSpawn: boolean;
  constructor(
    readonly reason: AutomatedClaudeAdmissionReason,
    cause?: unknown,
    /** Required MCP server names absent from the isolated config (`required-mcp-unavailable` only). */
    readonly missing: readonly string[] = []
  ) {
    super(
      reason === 'required-mcp-unavailable'
        ? requiredMcpUnavailableMessage(missing)
        : `Automated Claude admission blocked: ${reason}`,
      { cause }
    );
    this.preSpawn = reason === 'required-mcp-unavailable';
  }
}

export interface AutomatedClaudeLaunchInput {
  ownerId: string;
  env?: NodeJS.ProcessEnv;
  dataDir?: string;
  /** Directory holding the user's real settings.json. Defaults to `$CLAUDE_CONFIG_DIR` or `~/.claude`. */
  sourceConfigDir?: string;
  /** MCP server names the run needs; admission fails when any is not carried into the isolated config. */
  requiredMcps?: readonly string[];
  /** Launch cwd. Its workspace-trust acceptance is carried over so the TUI does not stop on the trust dialog. */
  cwd?: string;
  now?: number;
}

/** Builds the generated settings from the user's real ones; null when there is nothing to carry. */
export function buildSeedSettings(source: unknown): Record<string, unknown> | null {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null;
  const record = source as Record<string, unknown>;
  const generated: Record<string, unknown> = {};
  for (const key of SEED_SETTINGS_KEYS) {
    if (typeof record[key] === 'string') generated[key] = record[key];
  }
  const rawEnv = record.env;
  if (typeof rawEnv === 'object' && rawEnv !== null && !Array.isArray(rawEnv)) {
    const picked: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawEnv)) {
      if ((SEED_ENV_EXACT.has(key) || SEED_ENV_PREFIX.test(key)) && typeof value === 'string') {
        picked[key] = value;
      }
    }
    if (Object.keys(picked).length > 0) generated.env = picked;
  }
  // Narrow behavioral exception: consent the user already gave, only when literally true.
  if (record.skipDangerousModePermissionPrompt === true) generated.skipDangerousModePermissionPrompt = true;
  return Object.keys(generated).length > 0 ? generated : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The real global config (`.claude.json`) is read only up to this size. */
const MAX_GLOBAL_CONFIG_BYTES = 16 * 1024 * 1024;
const MAX_MCP_SERVERS = 64;
const MAX_MCP_NAME_LENGTH = 128;
const MAX_MCP_STRING_LENGTH = 4096;
const MAX_MCP_ARGS = 128;

/**
 * Credential heuristic for MCP launch strings — kept identical to the provider
 * bridge's `sanitizeMcpServers` (parity test). A server whose `args` or `url`
 * obviously embed a credential is dropped whole: a credential-named flag
 * (`--token`, `--api-key=…`, `--secret`, `--password`, `--auth…`, with or without
 * `=value`), an `Authorization:`/`X-Api-Key:` header or `Bearer <value>` arg, or a
 * URL with userinfo (`user:pass@`) or a credential-named query parameter.
 * Conservative and obviously incomplete; secrets belong in `env`/`headers`, which
 * are never copied.
 */
const CREDENTIAL_ARG =
  /^-{1,2}[\w.-]*(token|api[-_]?key|apikey|secret|passw(or)?d|auth|access[-_]?key|credential)[\w.-]*(=|$)/i;
const CREDENTIAL_TEXT = /(\bbearer\s+\S|^\s*(authorization|x-api-key|proxy-authorization)\s*:)/i;
const CREDENTIAL_QUERY_KEY = /(token|api[-_]?key|apikey|secret|passw(or)?d|auth|signature|sig|credential|key)$/i;

function urlCarriesCredential(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // An unparseable URL cannot be checked, so it cannot be trusted.
    return true;
  }
  if (url.username !== '' || url.password !== '') return true;
  for (const key of url.searchParams.keys()) {
    if (CREDENTIAL_QUERY_KEY.test(key)) return true;
  }
  return false;
}

function argCarriesCredential(arg: string): boolean {
  if (CREDENTIAL_ARG.test(arg) || CREDENTIAL_TEXT.test(arg)) return true;
  const scheme = arg.indexOf('://');
  if (scheme < 0) return false;
  const start = arg.slice(0, scheme).search(/[a-z][a-z0-9+.-]*$/i);
  return start >= 0 && urlCarriesCredential(arg.slice(start).split(/\s/)[0]!);
}

function boundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_MCP_STRING_LENGTH;
}

function sanitizeMcpServer(raw: unknown): Record<string, unknown> | null {
  if (!isPlainObject(raw)) return null;
  // Allowlist: `type`, `command`, `args`, `url`. `env`, `headers`, `headersHelper`,
  // oauth/auth and every unknown field are dropped.
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
    if (!raw.args.every((arg) => typeof arg === 'string' && arg.length <= MAX_MCP_STRING_LENGTH)) return null;
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

/** Non-secret launch config for user-scope MCP servers; malformed or credential-looking entries are skipped. */
export function sanitizeMcpServers(raw: unknown): Record<string, Record<string, unknown>> | null {
  if (!isPlainObject(raw)) return null;
  const picked: Array<[string, Record<string, unknown>]> = [];
  for (const [name, entry] of Object.entries(raw)) {
    if (picked.length >= MAX_MCP_SERVERS) break;
    if (name.length === 0 || name.length > MAX_MCP_NAME_LENGTH) continue;
    const server = sanitizeMcpServer(entry);
    if (server) picked.push([name, server]);
  }
  // `fromEntries` defines own properties, so a `__proto__` name cannot reach the prototype.
  return picked.length > 0 ? Object.fromEntries(picked) : null;
}

function readJsonObject(file: string, maxBytes?: number): Record<string, unknown> | null {
  try {
    if (maxBytes !== undefined && statSync(file).size > maxBytes) return null;
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Claude keys workspace trust to the config dir, so a fresh isolated dir would
 * stop an unattended TUI on "Do you trust this folder?". Carry over only a
 * decision the user already made (the cwd or an ancestor accepted in their real
 * `.claude.json`); never grant trust that was not there.
 */
function trustedProjects(globalConfig: Record<string, unknown> | null, cwd: string | undefined): Record<string, unknown> | null {
  if (!cwd) return null;
  const projects = globalConfig?.projects;
  if (typeof projects !== 'object' || projects === null) return null;
  const record = projects as Record<string, { hasTrustDialogAccepted?: unknown } | undefined>;
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (record[dir]?.hasTrustDialogAccepted === true) return { [resolve(cwd)]: { hasTrustDialogAccepted: true } };
    if (dirname(dir) === dir) return null;
  }
}

/**
 * The real global config: inside the config dir when one is set (env or an
 * explicit source dir), otherwise `~/.claude.json` next to `~/.claude`.
 */
function sourceGlobalConfig(sourceDir: string, env: NodeJS.ProcessEnv, explicitSourceDir: boolean): string {
  return explicitSourceDir || env.CLAUDE_CONFIG_DIR ? join(sourceDir, '.claude.json') : join(homedir(), '.claude.json');
}

/**
 * Narrow, explicit behavioral exceptions to "auth only": `skipDangerousModePermissionPrompt: true`
 * (via `buildSeedSettings`) and user-scope MCP servers from the real global `.claude.json`,
 * reduced to non-secret launch config. The keychain is never shared: Claude's secure-storage
 * service name follows `CLAUDE_CONFIG_DIR` (overridable by `CLAUDE_SECURESTORAGE_CONFIG_DIR`),
 * and that store holds model OAuth credentials alongside MCP OAuth tokens.
 */
function seedLeaf(
  leaf: string,
  sourceDir: string,
  env: NodeJS.ProcessEnv,
  explicitSourceDir: boolean,
  cwd?: string
): { carriedMcps: ReadonlySet<string> } {
  // Transcripts keep landing in the real projects dir, so transcript-derived
  // features and `--resume` are unaffected by the relocated config dir.
  const realProjects = join(sourceDir, 'projects');
  const linkPath = join(leaf, 'projects');
  if (existsSync(sourceDir)) linkProjects(realProjects, linkPath);
  const generated = buildSeedSettings(readJsonObject(join(sourceDir, 'settings.json')));
  const globalConfig = readJsonObject(sourceGlobalConfig(sourceDir, env, explicitSourceDir), MAX_GLOBAL_CONFIG_BYTES);
  const mcpServers = sanitizeMcpServers(globalConfig?.mcpServers);
  const carriedMcps = new Set(mcpServers ? Object.keys(mcpServers) : []);
  if (!generated && !mcpServers) return { carriedMcps };
  writeAtomic0600(join(leaf, 'settings.json'), JSON.stringify(generated ?? {}));
  const projects = trustedProjects(globalConfig, cwd);
  writeAtomic0600(
    join(leaf, '.claude.json'),
    JSON.stringify({
      hasCompletedOnboarding: true,
      ...(mcpServers ? { mcpServers } : {}),
      ...(projects ? { projects } : {})
    })
  );
  return { carriedMcps };
}

const AUTH_ENV_KEY = /^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_USE_[A-Z_]+)$/;

function envCarriesAuth(env: Record<string, unknown> | undefined): boolean {
  if (!env) return false;
  return Object.entries(env).some(([key, value]) => AUTH_ENV_KEY.test(key) && typeof value === 'string' && value !== '');
}

/**
 * Whether an isolated config dir can authenticate without the user's real one.
 * OAuth/subscription login state (keychain entry, `.credentials.json`,
 * `oauthAccount`) is keyed to the config dir and is deliberately not copied, so
 * only a credential helper, cloud-provider auth, or an API key (seeded or
 * inherited from the process env) survives the relocation.
 */
export function automatedConfigCanAuthenticate(leaf: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (envCarriesAuth(env)) return true;
  try {
    const seeded = JSON.parse(readFileSync(join(leaf, 'settings.json'), 'utf8')) as Record<string, unknown>;
    if (['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport'].some((key) => typeof seeded[key] === 'string')) return true;
    const seededEnv = seeded.env;
    return typeof seededEnv === 'object' && seededEnv !== null && envCarriesAuth(seededEnv as Record<string, unknown>);
  } catch {
    return false;
  }
}

export function removeAutomatedConfigDir(dataDir: string, leaf: string): void {
  removeConfinedConfigLeaf(dataDir, AUTOMATED_CONFIG_PARENT, leaf);
}

/** Deletes leaves older than `ttlMs` that no live session owns. Best effort. */
export function sweepStaleAutomatedConfigDirs(args: {
  dataDir: string;
  liveOwnerIds: ReadonlySet<string>;
  ttlMs?: number;
  now?: number;
}): string[] {
  const ttl = args.ttlMs ?? AUTOMATED_CONFIG_TTL_MS;
  return sweepConfinedConfigLeaves({
    dataDir: args.dataDir,
    parentName: AUTOMATED_CONFIG_PARENT,
    liveOwnerIds: args.liveOwnerIds,
    ttlMs: ttl,
    now: args.now,
  });
}

/**
 * Plan the isolation for one unattended Claude launch. Automated requests must
 * never fall back to the user's interactive configuration.
 */
export function planAutomatedClaudeLaunch(input: AutomatedClaudeLaunchInput): AutomatedClaudeLaunchPlan {
  const env = input.env ?? process.env;
  const dataDir = input.dataDir ?? resolveZccDataDir(env);
  let leaf: string | undefined;
  try {
    leaf = createConfinedConfigLeaf({ dataDir, ownerId: input.ownerId, parentName: AUTOMATED_CONFIG_PARENT });
    const sourceDir =
      input.sourceConfigDir ??
      (env.CLAUDE_CONFIG_DIR ? resolve(env.CLAUDE_CONFIG_DIR) : join(homedir(), '.claude'));
    const { carriedMcps } = seedLeaf(leaf, sourceDir, env, input.sourceConfigDir !== undefined, input.cwd);
    if (!automatedConfigCanAuthenticate(leaf, env)) {
      removeAutomatedConfigDir(dataDir, leaf);
      throw new AutomatedClaudeAdmissionError('authentication-unavailable');
    }
    // The carried set is exactly what `seedLeaf` wrote to the leaf's `.claude.json`.
    const missing = (input.requiredMcps ?? []).filter((name) => !carriedMcps.has(name));
    if (missing.length > 0) {
      removeAutomatedConfigDir(dataDir, leaf);
      throw new AutomatedClaudeAdmissionError('required-mcp-unavailable', undefined, missing);
    }
    return {
      configDir: leaf,
      args: ['--setting-sources', 'user'],
      env: { CLAUDE_CONFIG_DIR: leaf },
    };
  } catch (error) {
    if (error instanceof AutomatedClaudeAdmissionError) throw error;
    if (leaf) {
      try {
        removeAutomatedConfigDir(dataDir, leaf);
      } catch {
        // Confined cleanup is best effort; never traverse an untrusted path.
      }
    }
    throw new AutomatedClaudeAdmissionError('config-unavailable', error);
  }
}
