import { useMemo, type CSSProperties } from 'react';
import { Star, X } from 'lucide-react';
import type { AgentState } from '@shared/types';
import { useUi, useFavoriteAgents, favoriteKey } from '../store';
import { useAllAgentCards } from '../util/useAgentCards';
import type { AgentCard } from './AgentBoard';
import { FavoriteStar } from './FavoriteStar';

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
 * one opens the agent-inspector modal (same lightweight peek as the tray).
 *
 * Reads the favorites set + the shared cross-project card projection; a starred
 * id whose session is gone is simply absent from the cards list, so it drops out
 * with no cleanup.
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

/** Bucket a starred card. Background (headless) wins over live state so detached
 *  work always sinks to the bottom group; exited → done; else by agent state. */
export function sectionOf(c: AgentCard): FavSectionId {
  if (c.session.status === 'exited') return 'done';
  if (c.session.headless) return 'background';
  switch (c.state) {
    case 'blocked':
      return 'blocked';
    case 'working':
    case 'waiting':
      return 'working';
    default:
      return 'idle';
  }
}

export function FavoriteAgentsDrawer() {
  const open = useUi((s) => s.favoritesDrawerOpen);
  const setOpen = useUi((s) => s.setFavoritesDrawerOpen);
  const favoriteIds = useFavoriteAgents((s) => s.favoriteIds);
  const cards = useAllAgentCards();

  // Keep only starred cards, then bucket into the ordered sections. Cheap derive
  // over a tiny list, but memoized so the 1s status tick upstream doesn't
  // re-bucket needlessly.
  const sections = useMemo(() => {
    const starred = cards.filter((c) => favoriteIds[favoriteKey(c.session)]);
    const byId: Record<FavSectionId, AgentCard[]> = {
      blocked: [],
      working: [],
      idle: [],
      background: [],
      done: []
    };
    for (const c of starred) byId[sectionOf(c)].push(c);
    return { starred, list: SECTION_ORDER.filter((s) => byId[s.id].length > 0).map((s) => ({ ...s, cards: byId[s.id] })) };
  }, [cards, favoriteIds]);

  if (!open) return null;

  const inspect = (c: AgentCard) => {
    useUi.getState().openAgentModal(c.session.id, c.projectId);
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
            Click the&nbsp;<Star size={12} aria-hidden="true" />&nbsp;on an agent card, in its
            inspector, or in the sidebar tray to follow it. It&rsquo;ll appear here so you can keep an
            eye on it across every project.
          </p>
        </div>
      ) : (
        <div className="favorites-drawer-list">
          {sections.list.map((section) => (
            <section key={section.id} className={`favorites-drawer-section section-${section.id}`}>
              <header className="favorites-drawer-section-head">
                <span className="favorites-drawer-section-label">{section.label}</span>
                <span className="favorites-drawer-section-count">{section.cards.length}</span>
              </header>
              {section.cards.map((c) => (
                <button
                  key={c.session.id}
                  className={`agent-tray-row favorites-row ${c.projectColor ? 'project-tinted' : ''}`}
                  onClick={() => inspect(c)}
                  title={`${c.session.title} — ${c.projectName} · ${STATE_LABEL[c.state]}`}
                  style={c.projectColor ? ({ '--project-color': c.projectColor } as CSSProperties) : undefined}
                >
                  <span className={`tab-agent-dot agent-${c.session.status === 'exited' ? 'done' : c.state}`} aria-hidden="true" />
                  <span className="agent-tray-row-text">
                    <span className="agent-tray-row-title">{c.session.title}</span>
                    <span className="agent-tray-row-meta">{c.projectName}</span>
                  </span>
                  <FavoriteStar session={c.session} className="agent-tray-fav" />
                </button>
              ))}
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}
