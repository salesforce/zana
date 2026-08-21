/**
 * Provider authorizers — translate a provider-agnostic {@link AuthorizationTier}
 * into each agent CLI's own on-disk config. This is the backend of the Settings
 * "Auto-configure" button.
 *
 * The seam is {@link ProviderAuthorizer}: one per agent CLI. `claude` is fully
 * implemented (writes user-global `~/.claude/settings.json`); `codex` and `pi`
 * are declared stubs that report "not yet supported" but carry a doc comment for
 * the eventual mapping, so wiring them later is a localized change here.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { getSettingsFile, getClaudeDir } from '../extensions/plugin-fs.js';
import type {
  ApplyAuthorizationInput,
  AuthorizationApplyResult,
  AuthorizationTier,
  AuthProviderId
} from '@zana-ai/zcc-domain/authorizations';

/**
 * Claude allow-rule sets per tier. Rules use Claude Code's permission syntax
 * (`Tool` or `Tool(specifier)`). Higher tiers are supersets of lower ones.
 *
 * We deliberately keep the "standard" command allowlist to non-destructive,
 * non-networked verbs — the tier's promise is "common local dev without
 * prompts", NOT "anything goes" (that's what `trusted` / bypass is for).
 */
const CLAUDE_READ_ONLY_ALLOW: readonly string[] = [
  'Read',
  'Glob',
  'Grep',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(pwd)',
  'Bash(git status:*)',
  'Bash(git log:*)',
  'Bash(git diff:*)',
  'Bash(git show:*)'
];

const CLAUDE_STANDARD_ALLOW: readonly string[] = [
  ...CLAUDE_READ_ONLY_ALLOW,
  'Edit',
  'Write',
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(git checkout:*)',
  'Bash(git branch:*)',
  'Bash(npm run:*)',
  'Bash(npm test:*)',
  'Bash(npm ci)',
  'Bash(npm install)',
  'Bash(pnpm:*)',
  'Bash(yarn:*)',
  'Bash(pytest:*)',
  'Bash(cargo:*)',
  'Bash(go test:*)',
  'Bash(make:*)'
];

/** The curated `permissions.allow` list for a tier (empty for the bypass tier). */
function claudeAllowForTier(tier: AuthorizationTier): string[] {
  switch (tier) {
    case 'read-only':
      return [...CLAUDE_READ_ONLY_ALLOW];
    case 'standard':
      return [...CLAUDE_STANDARD_ALLOW];
    case 'trusted':
      // Bypass is expressed via defaultMode, not an allow list.
      return [];
  }
}

/** Claude's `permissions.defaultMode` for a tier. */
function claudeDefaultModeForTier(tier: AuthorizationTier): string {
  return tier === 'trusted' ? 'bypassPermissions' : 'default';
}

/** A provider knows how to apply a tier to its own config. */
interface ProviderAuthorizer {
  id: AuthProviderId;
  apply(tier: AuthorizationTier): Promise<AuthorizationApplyResult>;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf-8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Atomic tmp+rename write of a pretty-printed JSON object. */
async function writeJsonAtomic(path: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const json = JSON.stringify(data, null, 2) + '\n';
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, json, 'utf-8');
  await rename(tmp, path);
}

/**
 * Merge a tier's allow list into an existing string[] without dropping the
 * user's own rules or duplicating ours. Union, order-preserving (existing
 * first, then any of ours not already present).
 */
function mergeAllow(existing: unknown, additions: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(existing)) {
    for (const item of existing) {
      if (typeof item === 'string' && !seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    }
  }
  for (const add of additions) {
    if (!seen.has(add)) {
      seen.add(add);
      out.push(add);
    }
  }
  return out;
}

const claudeAuthorizer: ProviderAuthorizer = {
  id: 'claude',
  async apply(tier: AuthorizationTier): Promise<AuthorizationApplyResult> {
    const path = getSettingsFile(); // ~/.claude/settings.json (honors ZCC_CLAUDE_HOME)
    const current = await readJson(path);

    // Preserve every unrelated key; only touch `permissions`.
    const currentPerms =
      current.permissions && typeof current.permissions === 'object' && !Array.isArray(current.permissions)
        ? (current.permissions as Record<string, unknown>)
        : {};

    const additions = claudeAllowForTier(tier);
    const nextPerms: Record<string, unknown> = { ...currentPerms };

    if (additions.length > 0) {
      nextPerms.allow = mergeAllow(currentPerms.allow, additions);
    }
    nextPerms.defaultMode = claudeDefaultModeForTier(tier);

    const next: Record<string, unknown> = { ...current, permissions: nextPerms };
    await writeJsonAtomic(path, next);

    const summary =
      tier === 'trusted'
        ? 'Set defaultMode to bypassPermissions (prompts skipped).'
        : `Added ${additions.length} allow rule(s); defaultMode set to default.`;
    return { provider: 'claude', ok: true, message: summary, path };
  }
};

/**
 * Codex stores approvals in `~/.codex/config.toml`. Tier → (approval_policy,
 * sandbox_mode), mirroring the codex CLI's `-a`/`-s` value sets:
 *   read-only → approval_policy = "untrusted"  + sandbox_mode = "read-only"
 *   standard  → approval_policy = "on-request"  + sandbox_mode = "workspace-write"
 *   trusted   → approval_policy = "never"       + sandbox_mode = "danger-full-access"
 *
 * NOTE (deviation from the plan's D2): the plan proposed delivering these as
 * per-launch `-a`/`-s` flags rather than a file write. But the "Auto-configure"
 * button is a one-shot GLOBAL-config action (its Claude twin writes
 * `~/.claude/settings.json`); an authorizer's `apply()` has no launch to attach
 * flags to. So the honest parity for THIS surface is a user-global config write,
 * exactly like Claude's. The Rule-4 hazard the plan flagged is handled the same
 * way as `writeJsonAtomic`: parse the existing TOML, merge only our two keys
 * (preserving every unrelated key + comment-free round-trip via smol-toml), and
 * write atomically (tmp + rename). Per-tab `-s`/`-a` from persona/project fields
 * (T1.3) is a separate, complementary scope layered at spawn.
 */
const CODEX_APPROVAL_BY_TIER: Record<AuthorizationTier, string> = {
  'read-only': 'untrusted',
  standard: 'on-request',
  trusted: 'never'
};
const CODEX_SANDBOX_BY_TIER: Record<AuthorizationTier, string> = {
  'read-only': 'read-only',
  standard: 'workspace-write',
  trusted: 'danger-full-access'
};

/** `~/.codex/config.toml` (honors CODEX_HOME, codex's own env override). */
function codexConfigFile(): string {
  const home = process.env.CODEX_HOME || join(homedir(), '.codex');
  return join(home, 'config.toml');
}

/** Read + parse an existing TOML config into a plain object ({} when absent/invalid). */
async function readToml(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed = parseToml(await readFile(path, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Atomic tmp+rename write of a TOML object. */
async function writeTomlAtomic(path: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const toml = stringifyToml(data);
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, toml, 'utf-8');
  await rename(tmp, path);
}

const codexAuthorizer: ProviderAuthorizer = {
  id: 'codex',
  async apply(tier: AuthorizationTier): Promise<AuthorizationApplyResult> {
    const path = codexConfigFile();
    const current = await readToml(path);
    const approval = CODEX_APPROVAL_BY_TIER[tier];
    const sandbox = CODEX_SANDBOX_BY_TIER[tier];
    // Preserve every unrelated key; only touch the two approval/sandbox keys.
    const next: Record<string, unknown> = {
      ...current,
      approval_policy: approval,
      sandbox_mode: sandbox
    };
    await writeTomlAtomic(path, next);
    return {
      provider: 'codex',
      ok: true,
      message: `Set approval_policy="${approval}", sandbox_mode="${sandbox}".`,
      path
    };
  }
};

/**
 * The `pi` code-harness profile (`@earendil-works/pi-coding-agent`, a PTY CLI)
 * has no on-disk config file to auto-configure. Auto-configure for it would need
 * its own mechanism; it is not wired yet.
 */
const piAuthorizer: ProviderAuthorizer = {
  id: 'pi',
  async apply(): Promise<AuthorizationApplyResult> {
    return {
      provider: 'pi',
      ok: false,
      message: 'pi auto-configure is not implemented yet (planned: persist the tier into the in-process permission gate).'
    };
  }
};

const AUTHORIZERS: Record<AuthProviderId, ProviderAuthorizer> = {
  claude: claudeAuthorizer,
  codex: codexAuthorizer,
  pi: piAuthorizer
};

/**
 * Apply a tier to each requested provider. Never throws — a provider failure is
 * captured as an `ok: false` result so the UI can report per-provider outcomes.
 */
export async function applyAuthorizations(
  input: ApplyAuthorizationInput
): Promise<AuthorizationApplyResult[]> {
  const results: AuthorizationApplyResult[] = [];
  for (const provider of input.providers) {
    const authorizer = AUTHORIZERS[provider];
    if (!authorizer) {
      results.push({ provider, ok: false, message: `Unknown provider "${provider}".` });
      continue;
    }
    try {
      results.push(await authorizer.apply(input.tier));
    } catch (err) {
      results.push({
        provider,
        ok: false,
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return results;
}

/** Exposed for a future "preview" affordance / tests: the Claude dir being written under. */
export function claudeConfigDir(): string {
  return getClaudeDir();
}
