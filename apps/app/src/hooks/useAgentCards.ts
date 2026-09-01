import { useMemo } from 'react';
import {
  useData,
  useAgentStatus,
  useIdleTriage,
  useOverseerActivity,
  useSubagents,
  agentViewTerminals,
  useFavoriteAgents,
  favoriteKey,
  threadFavoriteKey
} from '../store.js';
import { useThreads } from '../thread-store.js';
import type { AgentCard } from '../components/AgentBoard.js';
import { isVisibleThread } from '../components/fleet-item.js';

/**
 * Flatten every project's listed (visible + hidden-but-alive) non-shell sessions
 * into one cross-project {@link AgentCard}[] — the same projection the global
 * Agents board renders from, lifted here so the Favorites drawer reuses it
 * verbatim (one source of truth for "what is an agent and what's its state").
 *
 * Reads only raw store slices and derives behind a memo so a 1s status tick
 * doesn't rebuild the world (the render-storm guard the board already relies on).
 * Tombstoned/unknown projects are skipped; plain `shell` sessions are excluded
 * (this is an agents list, not a terminals list).
 */
export function useAllAgentCards(): AgentCard[] {
  const terminals = useData((s) => s.terminals);
  const projects = useData((s) => s.projects);
  const includeScheduled = useData((s) => s.includeScheduledAgentsInAgentView);
  const byId = useAgentStatus((s) => s.byId);
  const sinceById = useAgentStatus((s) => s.since);
  const triageById = useIdleTriage((s) => s.byId);
  const overseerById = useOverseerActivity((s) => s.byId);
  const subagentsById = useSubagents((s) => s.byId);

  return useMemo<AgentCard[]>(() => {
    const byProjectId = new Map(projects.map((p) => [p.id, p]));
    const out: AgentCard[] = [];
    for (const [projectId, list] of Object.entries(terminals)) {
      const project = byProjectId.get(projectId);
      if (!project) continue; // tombstoned/unknown project — skip
      for (const s of agentViewTerminals(list, includeScheduled)) {
        if (s.profile === 'shell') continue;
        out.push({
          session: s,
          state: byId[s.id] ?? 'unknown',
          stateSince: sinceById[s.id],
          projectId,
          projectName: project.name,
          projectColor: project.color,
          triage: triageById[s.id],
          overseer: overseerById[s.id],
          liveSubagents: subagentsById[s.id] ?? 0
        });
      }
    }
    return out;
  }, [terminals, projects, includeScheduled, byId, sinceById, triageById, overseerById, subagentsById]);
}

/**
 * Live intersection the Favorites drawer and titlebar badge share: starred
 * keys ∩ (live CLI cards ∪ visible threads). A star whose agent/thread isn't
 * running is omitted so the badge never disagrees with the drawer.
 */
export function liveFavoriteCount(
  favoriteIds: Record<string, true>,
  cards: Array<{ session: { id: string; claudeSessionId?: string } }>,
  visibleThreadIds: string[]
): number {
  let n = 0;
  for (const c of cards) if (favoriteIds[favoriteKey(c.session)]) n += 1;
  for (const id of visibleThreadIds) if (favoriteIds[threadFavoriteKey(id)]) n += 1;
  return n;
}

/**
 * How many followed agents are CURRENTLY LIVE — the titlebar star badge count.
 *
 * Deliberately the SAME live intersection the Favorites drawer renders, NOT
 * the raw persisted set size.
 */
export function useFavoriteCount(): number {
  const cards = useAllAgentCards();
  const threads = useThreads((s) => s.threads);
  const favoriteIds = useFavoriteAgents((s) => s.favoriteIds);
  return useMemo(
    () =>
      liveFavoriteCount(
        favoriteIds,
        cards,
        threads.filter(isVisibleThread).map((t) => t.id)
      ),
    [cards, favoriteIds, threads]
  );
}
