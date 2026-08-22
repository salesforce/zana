import { useMemo } from 'react';
import {
  useData,
  useAgentStatus,
  useIdleTriage,
  useOverseerActivity,
  useSubagents,
  listedTerminals,
  useFavoriteAgents,
  favoriteKey
} from '../store.js';
import type { AgentCard } from '../components/AgentBoard.js';
import { hostThreadAgentState } from '../lib/host-thread-session.js';

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
      for (const s of listedTerminals(list)) {
        if (s.profile === 'shell') continue;
        out.push({
          session: s,
          state: s.workspaceEnvironmentId
            ? hostThreadAgentState(s.status === 'exited' ? 'completed' : s.status)
            : (byId[s.id] ?? 'unknown'),
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
  }, [terminals, projects, byId, sinceById, triageById, overseerById, subagentsById]);
}

/**
 * How many followed agents are CURRENTLY LIVE — the titlebar star badge count.
 *
 * Deliberately the SAME live intersection the Favorites drawer renders (starred
 * keys ∩ live agent cards), NOT the raw persisted set size: a star whose agent
 * isn't running right now isn't shown in the drawer, so counting it on the
 * badge made the badge ("3") disagree with the drawer ("0") after a relaunch.
 * Keying both off this hook keeps them in lockstep.
 */
export function useFavoriteCount(): number {
  const cards = useAllAgentCards();
  const favoriteIds = useFavoriteAgents((s) => s.favoriteIds);
  return useMemo(
    () => cards.reduce((n, c) => (favoriteIds[favoriteKey(c.session)] ? n + 1 : n), 0),
    [cards, favoriteIds]
  );
}
