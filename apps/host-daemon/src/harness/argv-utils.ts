/**
 * Shared, pure argv helpers used by BOTH launch paths — the local spawn
 * assembly in `PtyManager.create` and every provider's `buildRemoteCommand`.
 *
 * These live here (not inline in `pty.ts`) precisely so the local and remote
 * paths CANNOT drift: a remote builder that hand-rolled `extraArgs.filter(...)`
 * or skipped the `--allowedTools` fold is the class of bug this module exists to
 * prevent. `pty.ts` re-exports both to preserve its historical import surface
 * (see the re-export note there).
 */

import { resolveModelAlias } from '@zana-ai/zcc-llm';

/**
 * Drop empty / whitespace-only per-tab args so a caller can't leak a dangling
 * positional (e.g. `claude ''`, a stray empty first-turn the CLI may
 * misinterpret), and resolve any bare `--model <alias>` to its concrete model
 * ID so Bedrock/Vertex/Foundry gateways get the user's intended model (a no-op
 * on the Anthropic API and for already-concrete ids — see model-resolve.ts).
 * Doing it HERE means every launch path (local + every provider's remote
 * builder) funnels per-tab model flags through the same resolver. Pure: returns
 * a new array; never mutates the caller's.
 */
export function cleanExtraArgs(extraArgs: string[] | undefined): string[] {
  const cleaned = (extraArgs ?? []).filter((a) => a.trim() !== '');
  for (let i = 0; i < cleaned.length; i += 1) {
    const a = cleaned[i];
    if (a.startsWith('--model=')) {
      const val = a.slice('--model='.length);
      const resolved = resolveModelAlias(val);
      if (resolved !== val) cleaned[i] = `--model=${resolved}`;
    } else if (a === '--model' && i + 1 < cleaned.length) {
      cleaned[i + 1] = resolveModelAlias(cleaned[i + 1]);
    }
  }
  return cleaned;
}

/**
 * Ensure a SINGLE occurrence of `flag` in the argv, with `extras` (plus any
 * values from existing occurrences of `flag`) merged and deduped, in
 * first-seen order. Pure: returns a new array. If neither side mentions the
 * flag, returns `argv` unchanged.
 *
 * This exists because the claude CLI takes LAST-occurrence-wins for both
 * `--allowedTools` and `--disallowedTools`: emitting either flag twice (e.g. a
 * persona list AND a project list, or a persona list AND per-tab extraArgs)
 * would silently drop the earlier list. {@link mergeAllowedTools} and
 * {@link mergeDisallowedTools} are the two call-site-specific wrappers; both the
 * local and remote assembly run their full argv through them so the union
 * always survives.
 */
function mergeToolsFlag(argv: string[], flag: string, extras: string[]): string[] {
  if (extras.length === 0 && !argv.includes(flag)) return argv;
  const collected: string[] = [];
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag && i + 1 < argv.length) {
      const next = argv[i + 1];
      next.split(',').map((s) => s.trim()).filter(Boolean).forEach((v) => collected.push(v));
      i += 1;
      continue;
    }
    out.push(argv[i]);
  }
  for (const v of extras) collected.push(v);
  if (collected.length === 0) return out;
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const v of collected) {
    if (!seen.has(v)) {
      seen.add(v);
      merged.push(v);
    }
  }
  out.push(flag, merged.join(','));
  return out;
}

export function mergeAllowedTools(argv: string[], extras: string[]): string[] {
  return mergeToolsFlag(argv, '--allowedTools', extras);
}

/**
 * Same fold as {@link mergeAllowedTools}, for `--disallowedTools`. Without
 * this, a persona/project deny-list and a per-tab Extra Args deny-list
 * (spliced in last, highest precedence) would collide: the CLI's
 * last-occurrence-wins would silently drop the earlier deny-list instead of
 * unioning with it.
 */
export function mergeDisallowedTools(argv: string[], extras: string[]): string[] {
  return mergeToolsFlag(argv, '--disallowedTools', extras);
}
