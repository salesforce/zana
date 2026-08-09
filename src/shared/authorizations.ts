/**
 * Provider-agnostic authorization presets — the single source of truth for the
 * "Auto-configure" button in Settings. Imported by BOTH main and renderer, so
 * this file must have NO electron/node-only imports (same rule as
 * launch-provider.ts).
 *
 * The model has two axes:
 *  - {@link AuthProviderId} — which agent CLI we're configuring (claude today;
 *    codex / pi are declared but not yet wired, so the UI can show them as
 *    "coming soon" instead of pretending they work).
 *  - {@link AuthorizationTier} — the provider-AGNOSTIC intent ("how much do I
 *    trust this agent"). Each provider's authorizer (main process) translates a
 *    tier into ITS OWN on-disk config format. The tier is the contract the UI
 *    speaks; the translation is the provider's private concern.
 */

/** The agent CLIs we can auto-configure. */
export type AuthProviderId = 'claude' | 'codex' | 'pi';

/**
 * How much standing permission to grant, independent of provider. The concrete
 * allow/deny rules (or approval policy) each tier maps to live in the per-provider
 * authorizer — see `src/main/authorizations.ts`.
 */
export type AuthorizationTier = 'read-only' | 'standard' | 'trusted';

export interface AuthProviderMeta {
  id: AuthProviderId;
  label: string;
  /** False ⇒ declared but not yet implemented; UI shows it disabled / "coming soon". */
  ready: boolean;
  /** Where this provider's config is written (shown in the UI so the write target is honest). */
  target: string;
}

export const AUTH_PROVIDERS: readonly AuthProviderMeta[] = [
  { id: 'claude', label: 'Claude Code', ready: true, target: '~/.claude/settings.json' },
  { id: 'codex', label: 'Codex', ready: true, target: '~/.codex/config.toml' },
  { id: 'pi', label: 'pi', ready: false, target: '(pi config)' }
] as const;

export interface AuthorizationPreset {
  tier: AuthorizationTier;
  label: string;
  /** One-line description shown under the picker. */
  description: string;
}

/**
 * The named presets a user picks from. Order is deliberate: least → most
 * privileged. These describe INTENT only; the rule materialization is per
 * provider.
 */
export const AUTHORIZATION_PRESETS: readonly AuthorizationPreset[] = [
  {
    tier: 'read-only',
    label: 'Read-only',
    description:
      'Pre-approve inspection only — reading files and safe read-only shell commands (ls, cat, git status/log/diff). Every edit or write still prompts.'
  },
  {
    tier: 'standard',
    label: 'Standard dev',
    description:
      'Read-only plus common local dev commands (git, package managers, tests, builds) and file edits. Destructive or networked commands still prompt.'
  },
  {
    tier: 'trusted',
    label: 'Trusted (bypass prompts)',
    description:
      'Skip permission prompts entirely for this agent. Only pick this for a fully trusted, sandboxed environment.'
  }
] as const;

/** Look up a preset by tier, or undefined if the string isn't a known tier. */
export function presetForTier(tier: string): AuthorizationPreset | undefined {
  return AUTHORIZATION_PRESETS.find((p) => p.tier === tier);
}

/** Look up provider metadata, or undefined for an unknown id. */
export function authProviderMeta(id: string): AuthProviderMeta | undefined {
  return AUTH_PROVIDERS.find((p) => p.id === id);
}

/** Input the renderer sends to apply a preset. */
export interface ApplyAuthorizationInput {
  providers: AuthProviderId[];
  tier: AuthorizationTier;
}

/** Per-provider outcome of an apply run. */
export interface AuthorizationApplyResult {
  provider: AuthProviderId;
  ok: boolean;
  /** Human-facing summary — what changed, or why it was skipped. */
  message: string;
  /** Absolute path written, when a file was touched. */
  path?: string;
}
