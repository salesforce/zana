import type { LlmProviderId } from '../../shared/types.js';

/**
 * Per-provider model-alias resolution.
 *
 * The built-in prompt registry speaks in Claude's tier aliases (`haiku` /
 * `sonnet` / `opus`) because `claude-cli` was the only transport. A prompt entry
 * carries that alias verbatim, so an OpenAI or Gemini provider that received the
 * literal string `"haiku"` would send a nonexistent model id and fail. Each HTTP
 * provider therefore maps the Claude tier alias onto its own concrete id BEFORE
 * the request leaves the process.
 *
 * The mapping is intentionally tier-based, not name-based: `haiku` → the
 * provider's fast/cheap model, `sonnet` → its balanced model, `opus` → its most
 * capable. A caller that already passes a provider-native id (e.g.
 * `gpt-4o-mini`, `gemini-2.0-flash`) is left untouched — only the three Claude
 * aliases are rewritten, everything else falls through as-is.
 *
 * Config-write-time validation (see {@link isKnownModel}) rejects a prompt entry
 * whose `model` neither a known alias nor a plausible provider id, so a typo
 * surfaces at save time rather than as a silent `ok:false` at dispatch.
 */

/** The three Claude tier aliases the built-in registry uses. */
const CLAUDE_TIER_ALIASES = ['haiku', 'sonnet', 'opus'] as const;
type ClaudeTierAlias = (typeof CLAUDE_TIER_ALIASES)[number];

function isClaudeTierAlias(model: string): model is ClaudeTierAlias {
  return (CLAUDE_TIER_ALIASES as readonly string[]).includes(model);
}

/** OpenAI: fast → balanced → most-capable, keyed by Claude tier. */
const OPENAI_TIER_MAP: Record<ClaudeTierAlias, string> = {
  haiku: 'gpt-4o-mini',
  sonnet: 'gpt-4o',
  opus: 'gpt-4o'
};

/** Gemini: fast → balanced → most-capable, keyed by Claude tier. */
const GEMINI_TIER_MAP: Record<ClaudeTierAlias, string> = {
  haiku: 'gemini-2.0-flash',
  sonnet: 'gemini-2.0-flash',
  opus: 'gemini-1.5-pro'
};

const TIER_MAPS: Partial<Record<LlmProviderId, Record<ClaudeTierAlias, string>>> = {
  openai: OPENAI_TIER_MAP,
  gemini: GEMINI_TIER_MAP
};

/**
 * Resolve a prompt's `model` string to a concrete id for `provider`. A Claude
 * tier alias (`haiku`/`sonnet`/`opus`) maps to the provider's equivalent; any
 * other value (including undefined) is returned unchanged so a provider-native
 * id passes straight through and the provider's own default applies when absent.
 */
export function resolveModelAlias(
  provider: LlmProviderId,
  model: string | undefined
): string | undefined {
  if (!model) return model;
  const trimmed = model.trim();
  if (!trimmed) return undefined;
  const map = TIER_MAPS[provider];
  if (map && isClaudeTierAlias(trimmed)) return map[trimmed];
  return trimmed;
}

/**
 * Shape a plausible provider-native model id must have: a single token (no
 * internal whitespace) of reasonable length (2..100 chars) drawn from a
 * conservative model-id charset — upper/lower alphanumerics plus the punctuation
 * vendors actually use (`-`, `.`, `_`, `:`, `/`) — and carrying at least one
 * DIGIT. Real ids (`gpt-4o`, `gpt-4o-mini`, `gemini-2.0-flash`, `gemini-1.5-pro`)
 * satisfy this; a typo'd Claude alias (`haiky`, `sonet`) or free-text garbage
 * (`gpt 4o` — space, `!!!`, `garbage`) does not, so it's rejected at save time.
 *
 * The digit requirement is deliberate: the value being validated for a tier-map
 * provider usually started life as a Claude tier alias, so the most likely
 * mistake is a mistyped, digit-less alias — requiring a digit rejects exactly
 * that class of typo while every current OpenAI/Gemini id carries a version
 * number. This does NOT enumerate valid ids — the provider API is the final
 * authority; we only reject implausible SHAPES to catch typos/garbage at save
 * time rather than as a silent `ok:false` at dispatch.
 */
const PLAUSIBLE_MODEL_ID = /^(?=.*[0-9])[A-Za-z0-9._:\/-]{2,100}$/;

function looksLikeProviderId(model: string): boolean {
  return PLAUSIBLE_MODEL_ID.test(model);
}

/**
 * Config-write-time check: is `model` usable with `provider`?
 *
 * Policy:
 * - `undefined` → true (the provider's own default applies).
 * - empty/whitespace → false (an explicit blank is a mistake, never a default).
 * - a Claude tier alias (`haiku`/`sonnet`/`opus`) → true for ANY provider (it
 *   always resolves via {@link resolveModelAlias}).
 * - a provider WITH a tier map (`openai`, `gemini`) → true only if the value is
 *   a plausible provider-native id shape ({@link looksLikeProviderId}); a typo'd
 *   alias (`haiky`, `sonet`) or free-text garbage (`gpt 4o`, `!!!`) is rejected
 *   so the mistake surfaces at save time rather than as a silent dispatch fail.
 * - a provider WITHOUT a tier map (`claude-cli`, `anthropic-sdk`) → true for any
 *   non-empty string. This asymmetry is intentional: `claude-cli` speaks tier
 *   aliases plus arbitrary claude ids, so over-constraining its shape would
 *   reject legitimate values the CLI understands.
 *
 * Pure and cheap: no I/O, no side effects.
 */
export function isKnownModel(provider: LlmProviderId, model: string | undefined): boolean {
  if (model === undefined) return true;
  const trimmed = model.trim();
  if (!trimmed) return false;
  if (isClaudeTierAlias(trimmed)) return true;
  if (TIER_MAPS[provider]) return looksLikeProviderId(trimmed);
  return true;
}
