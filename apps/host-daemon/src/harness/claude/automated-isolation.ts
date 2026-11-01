import {
  existsSync,
  readFileSync,
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
 * a generated auth/gateway `settings.json`, and is told to load only the `user`
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

export type AutomatedClaudeAdmissionReason = 'authentication-unavailable' | 'config-unavailable';

export class AutomatedClaudeAdmissionError extends Error {
  constructor(readonly reason: AutomatedClaudeAdmissionReason, cause?: unknown) {
    super(`Automated Claude admission blocked: ${reason}`, { cause });
  }
}

export interface AutomatedClaudeLaunchInput {
  ownerId: string;
  env?: NodeJS.ProcessEnv;
  dataDir?: string;
  /** Directory holding the user's real settings.json. Defaults to `$CLAUDE_CONFIG_DIR` or `~/.claude`. */
  sourceConfigDir?: string;
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
  return Object.keys(generated).length > 0 ? generated : null;
}

/**
 * Claude keys workspace trust to the config dir, so a fresh isolated dir would
 * stop an unattended TUI on "Do you trust this folder?". Carry over only a
 * decision the user already made (the cwd or an ancestor accepted in their real
 * `.claude.json`); never grant trust that was not there.
 */
function trustedProjects(sourceDir: string, env: NodeJS.ProcessEnv, cwd: string | undefined): Record<string, unknown> | null {
  if (!cwd) return null;
  const file = env.CLAUDE_CONFIG_DIR ? join(sourceDir, '.claude.json') : join(homedir(), '.claude.json');
  let projects: unknown;
  try {
    projects = (JSON.parse(readFileSync(file, 'utf8')) as { projects?: unknown }).projects;
  } catch {
    return null;
  }
  if (typeof projects !== 'object' || projects === null) return null;
  const record = projects as Record<string, { hasTrustDialogAccepted?: unknown } | undefined>;
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (record[dir]?.hasTrustDialogAccepted === true) return { [resolve(cwd)]: { hasTrustDialogAccepted: true } };
    if (dirname(dir) === dir) return null;
  }
}

function seedLeaf(leaf: string, sourceDir: string, env: NodeJS.ProcessEnv, cwd?: string): 'seeded' | 'none' {
  // Transcripts keep landing in the real projects dir, so transcript-derived
  // features and `--resume` are unaffected by the relocated config dir.
  const realProjects = join(sourceDir, 'projects');
  const linkPath = join(leaf, 'projects');
  if (existsSync(sourceDir)) linkProjects(realProjects, linkPath);
  let source: unknown;
  try {
    source = JSON.parse(readFileSync(join(sourceDir, 'settings.json'), 'utf8'));
  } catch {
    return 'none';
  }
  const generated = buildSeedSettings(source);
  if (!generated) return 'none';
  writeAtomic0600(join(leaf, 'settings.json'), JSON.stringify(generated));
  const projects = trustedProjects(sourceDir, env, cwd);
  writeAtomic0600(
    join(leaf, '.claude.json'),
    JSON.stringify({ hasCompletedOnboarding: true, ...(projects ? { projects } : {}) })
  );
  return 'seeded';
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
    seedLeaf(leaf, sourceDir, env, input.cwd);
    if (!automatedConfigCanAuthenticate(leaf, env)) {
      removeAutomatedConfigDir(dataDir, leaf);
      throw new AutomatedClaudeAdmissionError('authentication-unavailable');
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
