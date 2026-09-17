import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, X } from 'lucide-react';
import type { AgentState } from '@zana-ai/zcc-domain/product';
import { useData, useUi, useFavoriteAgents, favoriteKey, threadFavoriteKey } from '../store.js';
import { inspectAgentSession, inspectThread } from '../lib/inspect-session.js';
import { useAllAgentCards } from '../hooks/useAgentCards.js';
import { useThreads, type ThreadListItem } from '../thread-store.js';
import type { AgentCard } from './AgentBoard.js';
import { QuickAccessPanel } from './QuickAccessPanel.js';
import { isVisibleThread, threadTitle } from './fleet-item.js';
import { threadStatusToAgentState } from './thread/thread-timeline-model.js';

/**
 * Right-edge slide-over listing the agents the user has STARRED (followed),
 * across every project — a personal watch-list, distinct from the full fleet on
 * the Agents board. Opened from the titlebar star button
 * ({@link useUi.toggleFavoritesDrawer}).
 *
 * Sections, most-urgent first, empty ones omitted:
 *   Needs you (blocked) → Working → Idle → Background (headless) → Done (exited).
 * "Background" overrides state: any headless (scheduled / detached) session
 * sinks to its own group at the bottom, mirroring how the rest of the app
 * separates background work. Clicking a row closes the panel and peeks the
 * inspector overlay, or the full session/thread page when Classic
 * session view is on.
 *
 * Reads the favorites set + live CLI cards and visible threads; a starred id
 * whose session/thread is gone is simply absent, so it drops out with no cleanup.
 */

export type FavSectionId = 'blocked' | 'working' | 'idle' | 'background' | 'done';

const SECTION_ORDER: { id: FavSectionId; label: string }[] = [
  { id: 'blocked', label: 'Needs you' },
  { id: 'working', label: 'Working' },
  { id: 'idle', label: 'Idle' },
  { id: 'background', label: 'Background' },
  { id: 'done', label: 'Done' }
];

const STATE_LABEL: Record<AgentState, string> = {
  blocked: 'Needs you',
  working: 'Working',
  idle: 'Idle',
  done: 'Done',
  unknown: 'Idle',
  waiting: 'Waiting for model'
};

export type FollowedEntry =
  | { kind: 'agent'; card: AgentCard }
  | {
      kind: 'thread';
      thread: ThreadListItem;
      projectName: string;
      projectColor?: string;
      state: AgentState;
    };

/** Bucket a starred card. Background (headless) wins over live state so detached
 *  work always sinks to the bottom group; exited → done; else by agent state. */
export function sectionOf(c: AgentCard): FavSectionId {
  if (c.session.status === 'exited') return 'done';
  if (c.session.headless) return 'background';
  return sectionOfThread(c.state);
}

/** Conversation threads have no headless/exited PTY status — lane by state. */
export function sectionOfThread(state: AgentState): FavSectionId {
  switch (state) {
    case 'blocked':
      return 'blocked';
    case 'working':
    case 'waiting':
      return 'working';
    default:
      return 'idle';
  }
}

export function sectionOfEntry(entry: FollowedEntry): FavSectionId {
  return entry.kind === 'agent' ? sectionOf(entry.card) : sectionOfThread(entry.state);
}

export function FavoriteAgentsDrawer() {
  const navigate = useNavigate();
  const open = useUi((s) => s.favoritesDrawerOpen);
  const setOpen = useUi((s) => s.setFavoritesDrawerOpen);
  const favoriteIds = useFavoriteAgents((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteAgents((s) => s.toggleFavorite);
  const cards = useAllAgentCards();
  const threads = useThreads((s) => s.threads);
  const projects = useData((s) => s.projects);

  const sections = useMemo(() => {
    const starred: FollowedEntry[] = cards
      .filter((c) => favoriteIds[favoriteKey(c.session)])
      .map((card) => ({ kind: 'agent' as const, card }));
    const byProjectId = new Map(projects.map((p) => [p.id, p]));
    for (const thread of threads) {
      if (!isVisibleThread(thread)) continue;
      if (!favoriteIds[threadFavoriteKey(thread.id)]) continue;
      const project = byProjectId.get(thread.projectId);
      starred.push({
        kind: 'thread',
        thread,
        projectName: project?.name ?? 'Unknown',
        projectColor: project?.color,
        state: threadStatusToAgentState(thread.status, thread.hasPendingInteraction, thread.activity)
      });
    }
    const byId: Record<FavSectionId, FollowedEntry[]> = {
      blocked: [],
      working: [],
      idle: [],
      background: [],
      done: []
    };
    for (const entry of starred) byId[sectionOfEntry(entry)].push(entry);
    return {
      starred,
      list: SECTION_ORDER.filter((s) => byId[s.id].length > 0).map((s) => ({ ...s, entries: byId[s.id] }))
    };
  }, [cards, favoriteIds, threads, projects]);

  if (!open) return null;

  const inspect = (entry: FollowedEntry) => {
    setOpen(false);
    if (entry.kind === 'thread') {
      inspectThread(entry.thread.id, entry.thread.projectId, navigate);
      return;
    }
    inspectAgentSession(entry.card.session.id, entry.card.projectId, navigate);
  };

  const total = sections.starred.length;

  return (
    <QuickAccessPanel kind="favorites" summary={`${total} followed · All projects`} footer="View all agents"
      onViewAll={() => { setOpen(false); useUi.getState().setNav('agents'); }}>
      {total === 0 ? (
        <div className="quick-access-empty">
          <span className="quick-access-empty-icon"><Star size={22} aria-hidden="true" /></span>
          <h3>Keep important work close</h3>
          <p>Star a thread or agent to follow its progress here, across all your projects.</p>
        </div>
      ) : (
        <div className="quick-access-list">
          {sections.list.map((section) => (
            <section key={section.id} className="quick-access-section" aria-labelledby={`favorite-section-${section.id}`}>
              <h3 className="quick-access-section-heading" id={`favorite-section-${section.id}`}>
                {section.label}<span className="quick-access-section-count">{section.entries.length}</span>
              </h3>
              {section.entries.map((entry) => {
                const isThread = entry.kind === 'thread';
                const key = isThread ? threadFavoriteKey(entry.thread.id) : favoriteKey(entry.card.session);
                const title = isThread ? threadTitle(entry.thread) : entry.card.session.title;
                const projectName = isThread ? entry.projectName : entry.card.projectName;
                const state = isThread ? entry.state : entry.card.session.status === 'exited' ? 'done' : entry.card.state;
                return (
                  <div key={key} className="quick-access-favorite" data-kind={entry.kind}>
                    <button type="button" className="quick-access-row favorites-row" onClick={() => inspect(entry)}
                      title={`${title} — ${projectName} · ${STATE_LABEL[state]}`}>
                      <span className={`tab-agent-dot agent-${state}`} aria-hidden="true" />
                      <span className="quick-access-row-text">
                        <span className="quick-access-row-title">{title}</span>
                        <span className="quick-access-row-meta">
                          <span className="quick-access-row-project">{projectName}</span>
                          <span>{isThread ? 'Thread' : 'CLI agent'}</span>
                        </span>
                      </span>
                    </button>
                    <button type="button" className="quick-access-icon-button quick-access-remove"
                      onClick={(event) => {
                        // The row is removed immediately; keep keyboard focus in the panel.
                        event.currentTarget.closest('aside')?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
                        toggleFavorite(key);
                      }} aria-label={`Remove ${title} from favorites`} title="Remove from favorites">
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </QuickAccessPanel>
  );
}
