/**
 * The PURE sync-health reducer (R-REPO-013/015/016). Given the previous persisted
 * {@link SyncHealthState}, this pass's per-repo probe outcomes, and the hosts whose
 * `gh` auth is currently invalid, it computes BOTH the next durable state (the
 * remote-gone debounce counter + the kept-gone set) AND the derived {@link SyncHealth}
 * display shape that backs the single consolidated PR-list clue.
 *
 * It does NO I/O — the poller performs the `gh` probes and the auth read, then hands
 * the results here — so every rule is unit-testable against plain inputs.
 *
 * Load-bearing rules encoded here:
 *   - **Disconnect precedence (AC-REPO-15.5):** a host with invalid auth is a
 *     disconnect, never an outage — the two are mutually exclusive per host, and
 *     auth wins. A probe that itself classified `disconnect` also disconnects its host.
 *   - **Outage is per host, all-or-nothing among connected repos (AC-REPO-15.1/13.6):**
 *     a host is in outage only when it is NOT disconnected and EVERY probed repo under
 *     it failed transiently (`outage`); one healthy repo keeps the host out of outage.
 *   - **Remote-gone debounce (AC-REPO-16.5):** a repo must probe 404 on TWO consecutive
 *     passes before it is surfaced for a Remove/Keep decision; any non-404 outcome
 *     resets its counter, so a one-off 404 during propagation never prompts.
 *   - **Kept-gone auto-clear (AC-REPO-16.3 / 15.4):** a kept repo that becomes reachable
 *     again (`ok`) is dropped from the kept set silently.
 */
import type { SyncHealth, SyncHealthState } from './types.js';
import { EMPTY_SYNC_HEALTH_STATE } from './types.js';
import type { GhFault } from './gh-client.js';

/** One repo's probe outcome for a sync pass. `name` is lowercase `owner/repo`. */
export interface RepoProbe {
  name: string;
  host: string;
  fault: GhFault;
}

/** How many consecutive 404 passes confirm a remote-gone repo (AC-REPO-16.5). */
export const REMOTE_GONE_CONFIRM_PASSES = 2;

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort();
}

export function reduceSyncHealth(
  prev: SyncHealthState | undefined,
  probes: RepoProbe[],
  authDisconnectedHosts: string[]
): { state: SyncHealthState; health: SyncHealth } {
  const base = prev ?? EMPTY_SYNC_HEALTH_STATE;
  const prevGone = base.gone404 ?? {};
  const keptSet = new Set((base.kept ?? []).map((n) => n.toLowerCase()));

  // Hosts disconnected: from gh-auth AND from any probe that classified `disconnect`.
  const disconnectedHosts = new Set(authDisconnectedHosts);
  for (const p of probes) {
    if (p.fault === 'disconnect') disconnectedHosts.add(p.host);
  }

  // Next remote-gone counters. Start from prev, update ONLY the repos probed this
  // pass; a repo not probed keeps its prior count (it was skipped, not cleared).
  const nextGone: Record<string, number> = { ...prevGone };
  const remoteGone: string[] = [];
  // Track connected-repo outage aggregation per host.
  const hostHasProbe = new Map<string, boolean>();
  const hostAllOutage = new Map<string, boolean>();

  for (const p of probes) {
    const name = p.name.toLowerCase();

    // Remote-gone debounce (skip counting for a disconnected host — its 404 can't be
    // trusted as a real deletion when we can't even authenticate).
    if (p.fault === 'remote-gone' && !disconnectedHosts.has(p.host)) {
      nextGone[name] = (nextGone[name] ?? 0) + 1;
    } else {
      nextGone[name] = 0;
    }

    // Kept-gone clears when the repo is reachable again.
    if (p.fault === 'ok') keptSet.delete(name);

    // Per-host outage aggregation over CONNECTED repos only.
    if (!disconnectedHosts.has(p.host)) {
      hostHasProbe.set(p.host, true);
      const prevAll = hostAllOutage.get(p.host);
      const isOutage = p.fault === 'outage';
      hostAllOutage.set(p.host, prevAll === undefined ? isOutage : prevAll && isOutage);
    }
  }

  // Confirmed remote-gone (≥2 consecutive) that the user hasn't already kept.
  for (const [name, count] of Object.entries(nextGone)) {
    if (count >= REMOTE_GONE_CONFIRM_PASSES && !keptSet.has(name)) remoteGone.push(name);
  }

  const outageHosts: string[] = [];
  for (const [host, hasProbe] of hostHasProbe) {
    if (hasProbe && hostAllOutage.get(host) === true && !disconnectedHosts.has(host)) {
      outageHosts.push(host);
    }
  }

  const state: SyncHealthState = {
    gone404: nextGone,
    kept: uniqueSorted(keptSet),
  };
  const health: SyncHealth = {
    disconnectedHosts: uniqueSorted(disconnectedHosts),
    outageHosts: uniqueSorted(outageHosts),
    remoteGone: uniqueSorted(remoteGone),
    keptGone: uniqueSorted(keptSet),
  };
  return { state, health };
}

/** Is this repo excluded from the sync pass because the user kept it after remote-gone? */
export function isKeptGone(state: SyncHealthState | undefined, repoFullName: string): boolean {
  const kept = new Set((state?.kept ?? []).map((n) => n.toLowerCase()));
  return kept.has((repoFullName ?? '').toLowerCase());
}
