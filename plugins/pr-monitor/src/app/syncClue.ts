/**
 * Pure derivation of the SINGLE consolidated sync-health clue (AC-REPO-13.5).
 *
 * The main-side probe pass produces a {@link SyncHealth} display shape (disconnected
 * hosts / transient outage hosts / confirmed remote-gone repos / kept-gone repos).
 * The PR-list surfaces AT MOST ONE clue banner from it, chosen by a fixed precedence
 * so the user is never shown two competing affordances (AC-REPO-13.5):
 *
 *   disconnect  >  remote-gone  >  outage
 *
 * Rationale for the order:
 *   - disconnect (invalid `gh` auth) is the only fault the user must ACT on to fix
 *     everything downstream, so it wins (AC-REPO-15.5 — same precedence the reducer
 *     applies per-host).
 *   - remote-gone is a per-repo decision (Remove/Keep) — actionable but scoped.
 *   - outage is transient and auto-clears; it's the lowest-urgency, informational.
 *
 * kept-gone repos are NOT a clue of their own — they're folded into whichever clue
 * shows (or none). The Remove/Keep PROMPT is a separate surface driven directly by
 * `health.remoteGone` (see PrMonitorPanel); this helper only picks the banner.
 *
 * Returns `null` when there's nothing to surface (healthy, or only kept-gone repos
 * the user already decided on).
 */
import type { SyncHealth } from '../../lib/types.js';

export type SyncClueKind = 'disconnect' | 'remote-gone' | 'outage';

export interface SyncClue {
  kind: SyncClueKind;
  /** Human-readable one-line summary for the banner. */
  message: string;
  /** Hosts (disconnect/outage) or repos (remote-gone) the clue concerns. */
  subjects: string[];
  /**
   * The single affordance the banner offers:
   *   - `settings` — re-auth link (disconnect)
   *   - `resolve`  — the Remove/Keep prompt is shown below (remote-gone)
   *   - `none`     — informational, no action (outage: wait/retry auto-clears)
   */
  action: 'settings' | 'resolve' | 'none';
}

function list(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Pick the single clue to surface, or `null` if none. Pure — no I/O, no host, safe
 * to unit-test and to call every render.
 */
export function deriveSyncClue(health: SyncHealth | null | undefined): SyncClue | null {
  if (!health) return null;
  const disconnected = health.disconnectedHosts ?? [];
  const remoteGone = health.remoteGone ?? [];
  const outage = health.outageHosts ?? [];

  if (disconnected.length > 0) {
    return {
      kind: 'disconnect',
      subjects: disconnected,
      action: 'settings',
      message: `GitHub sign-in expired for ${list(disconnected)} — re-authenticate to resume syncing.`,
    };
  }

  if (remoteGone.length > 0) {
    return {
      kind: 'remote-gone',
      subjects: remoteGone,
      action: 'resolve',
      message: `${remoteGone.length} ${plural(remoteGone.length, 'repository is', 'repositories are')} no longer reachable on GitHub.`,
    };
  }

  if (outage.length > 0) {
    return {
      kind: 'outage',
      subjects: outage,
      action: 'none',
      message: `GitHub ${plural(outage.length, 'is', 'is')} temporarily unreachable for ${list(outage)} — retrying automatically.`,
    };
  }

  return null;
}
