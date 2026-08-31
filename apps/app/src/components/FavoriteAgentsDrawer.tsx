import { useMemo, type CSSProperties } from 'react';
import { Star, X } from 'lucide-react';
import type { AgentState } from '@zana-ai/zcc-domain/product';
import { useData, useUi, useFavoriteAgents, favoriteKey, threadFavoriteKey } from '../store.js';
import { useAllAgentCards } from '../hooks/useAgentCards.js';
import { useThreads, type ThreadListItem } from '../thread-store.js';
import type { AgentCard } from './AgentBoard.js';
import { FavoriteStar } from './FavoriteStar.js';
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
 * separates background work. Rows reuse the sidebar tray's row style; clicking
 * a CLI agent opens the agent-inspector modal; a thread opens the thread
 * inspector.
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
  unknown: 'Idle'
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
      return 'working';
    default:
      return 'idle';
  }
}

export function sectionOfEntry(entry: FollowedEntry): FavSectionId {
  return entry.kind === 'agent' ? sectionOf(entry.card) : sectionOfThread(entry.state);
}

export function FavoriteAgentsDrawer() {
  const open = useUi((s) => s.favoritesDrawerOpen);
  const setOpen = useUi((s) => s.setFavoritesDrawerOpen);
  const favoriteIds = useFavoriteAgents((s) => s.favoriteIds);
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
        state: threadStatusToAgentState(thread.status, thread.hasPendingInteraction)
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
    if (entry.kind === 'thread') {
      useUi.getState().openThreadModal(entry.thread.id);
      return;
    }
    useUi.getState().openAgentModal(entry.card.session.id, entry.card.projectId);
  };

  const total = sections.starred.length;

  return (
    <aside className="favorites-drawer" aria-label="Followed agents">
      <header className="favorites-drawer-header">
        <Star size={14} className="favorites-drawer-icon" aria-hidden="true" />
        <span className="favorites-drawer-title">Following</span>
        <span className="favorites-drawer-count">{total}</span>
        <span className="grow" />
        <button
          className="icon-button"
          onClick={() => setOpen(false)}
          aria-label="Close followed agents"
          title="Close"
        >
          <X size={16} />
        </button>
      </header>

      {total === 0 ? (
        <div className="favorites-drawer-empty">
          <Star size={26} aria-hidden="true" />
          <h4>No followed agents</h4>
          <p>
            Click the&nbsp;<Star size={12} aria-hidden="true" />&nbsp;on a CLI agent or thread card, in
            its inspector, or in the sidebar tray to follow it. It&rsquo;ll appear here so you can keep
            an eye on it across every project.
          </p>
        </div>
      ) : (
        <div className="favorites-drawer-list">
          {sections.list.map((section) => (
            <section key={section.id} className={`favorites-drawer-section section-${section.id}`}>
              <header className="favorites-drawer-section-head">
                <span className="favorites-drawer-section-label">{section.label}</span>
                <span className="favorites-drawer-section-count">{section.entries.length}</span>
              </header>
              {section.entries.map((entry) =>
                entry.kind === 'thread' ? (
                  <button
                    key={entry.thread.id}
                    type="button"
                    className={`agent-tray-row favorites-row ${entry.projectColor ? 'project-tinted' : ''}`}
                    data-kind="thread"
                    onClick={() => inspect(entry)}
                    title={`${threadTitle(entry.thread)} — ${entry.projectName} · ${STATE_LABEL[entry.state]}`}
                    style={
                      entry.projectColor
                        ? ({ '--project-color': entry.projectColor } as CSSProperties)
                        : undefined
                    }
                  >
                    <span className={`tab-agent-dot agent-${entry.state}`} aria-hidden="true" />
                    <span className="agent-tray-row-text">
                      <span className="agent-tray-row-title">{threadTitle(entry.thread)}</span>
                      <span className="agent-tray-row-meta">{entry.projectName}</span>
                    </span>
                    <FavoriteStar session={{ id: entry.thread.id, kind: 'thread' }} className="agent-tray-fav" />
                  </button>
                ) : (
                  <button
                    key={entry.card.session.id}
                    className={`agent-tray-row favorites-row ${entry.card.projectColor ? 'project-tinted' : ''}`}
                    onClick={() => inspect(entry)}
                    title={`${entry.card.session.title} — ${entry.card.projectName} · ${STATE_LABEL[entry.card.state]}`}
                    style={
                      entry.card.projectColor
                        ? ({ '--project-color': entry.card.projectColor } as CSSProperties)
                        : undefined
                    }
                  >
                    <span
                      className={`tab-agent-dot agent-${entry.card.session.status === 'exited' ? 'done' : entry.card.state}`}
                      aria-hidden="true"
                    />
                    <span className="agent-tray-row-text">
                      <span className="agent-tray-row-title">{entry.card.session.title}</span>
                      <span className="agent-tray-row-meta">{entry.card.projectName}</span>
                    </span>
                    <FavoriteStar session={entry.card.session} className="agent-tray-fav" />
                  </button>
                )
              )}
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}
