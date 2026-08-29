/**
 * Squad launch grouping — the pure core behind the Flow view's SECOND picker.
 *
 * The first picker selects a project; this one slices that project's live mesh
 * into the individual squads that compose it. A "squad" is one team launch:
 * agents sharing an {@link AgentRecord.teamLaunchId} (types.ts — "agents within
 * the same launch form an isolated squad"). Agents with no launch id (solo /
 * non-team) and unregistered live sessions fall into a single SOLO bucket,
 * mirroring how {@link buildSquadFlow} assigns nodes.
 *
 * Pure + side-effect-free (no persistence, no IPC) so it's unit-testable and can
 * be re-derived on every render behind a memo, like the rest of the Flow view.
 */
import type { AgentRecord, TerminalSession } from '@zana-ai/zcc-domain/product';
import { SOLO_LAUNCH_ID } from './squadFlow.js';

/** Sentinel selection for the "All squads" chip — the merged, unfiltered graph. */
export const ALL_SQUADS = '__all__';

/** One squad (team launch) present in a project's live mesh. */
export interface SquadLaunchGroup {
  /** {@link AgentRecord.teamLaunchId}, or {@link SOLO_LAUNCH_ID} for the solo bucket. */
  launchId: string;
  /** True for the synthetic solo / ungrouped bucket. */
  isSolo: boolean;
  /** Earliest member start (epoch ms) — drives recency ordering. */
  launchedAt: number;
  /** Number of mesh nodes in this squad (registry agents + unregistered sessions). */
  nodeCount: number;
}

/**
 * Enumerate the squads (team launches) present in one project's mesh, in display
 * order: real launches most-recent-first, then the solo bucket last (when any).
 * Node membership mirrors {@link buildSquadFlow}: every registry agent counts in
 * its launch bucket; every non-shell session NOT already covered by the registry
 * counts in the solo bucket. Deterministic — ties broken by launchId.
 */
export function squadLaunchGroups(
  agents: AgentRecord[],
  sessions: TerminalSession[]
): SquadLaunchGroup[] {
  const acc = new Map<string, { launchedAt: number; nodeCount: number }>();
  const agentSessionIds = new Set<string>();

  const add = (launchId: string, at: number) => {
    const cur = acc.get(launchId);
    if (cur) {
      cur.nodeCount += 1;
      if (at < cur.launchedAt) cur.launchedAt = at;
    } else {
      acc.set(launchId, { launchedAt: at, nodeCount: 1 });
    }
  };

  for (const a of agents) {
    agentSessionIds.add(a.sessionId);
    add(a.teamLaunchId ?? SOLO_LAUNCH_ID, a.registeredAt);
  }
  // Unregistered, non-shell live sessions are mesh nodes too — solo bucket only.
  for (const s of sessions) {
    if (s.profile === 'shell') continue;
    if (agentSessionIds.has(s.id)) continue;
    add(SOLO_LAUNCH_ID, s.createdAt);
  }

  const groups: SquadLaunchGroup[] = [...acc.entries()].map(([launchId, v]) => ({
    launchId,
    isSolo: launchId === SOLO_LAUNCH_ID,
    launchedAt: v.launchedAt,
    nodeCount: v.nodeCount
  }));

  // Real launches most-recent-first; the solo bucket is always pinned last so a
  // long-lived ad-hoc agent can't shove the real squads down the list.
  groups.sort((a, b) => {
    if (a.isSolo !== b.isSolo) return a.isSolo ? 1 : -1;
    if (a.launchedAt !== b.launchedAt) return b.launchedAt - a.launchedAt;
    return a.launchId < b.launchId ? -1 : 1;
  });

  return groups;
}

/**
 * Sticky launch-selection reducer for the second picker, mirroring
 * `reconcileSquadSelection` but defaulting to the *most-recent squad* rather than
 * "All". Given the previously-selected launch id and the project's current group
 * ids (in display order, most-recent-first), returns the id to select now:
 *   - keep `prev` if it's still a valid choice ({@link ALL_SQUADS} or a live group)
 *   - else fall back to the first (most-recent) group
 *   - else {@link ALL_SQUADS} when there are no groups at all
 * {@link ALL_SQUADS} is always a valid selection; pure (in-memory, no persistence).
 */
export function reconcileSquadLaunchSelection(
  prev: string | undefined,
  groupIds: string[]
): string {
  if (prev !== undefined && (prev === ALL_SQUADS || groupIds.includes(prev))) return prev;
  return groupIds[0] ?? ALL_SQUADS;
}
