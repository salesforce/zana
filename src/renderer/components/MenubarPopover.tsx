import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  WandSparkles,
  RefreshCw,
  Star,
  ArrowRight,
  Zap,
  Settings,
  Power,
  AppWindow
} from 'lucide-react';
import type { AgentState, MenubarAgent, MenubarSnapshot } from '@shared/types';

/**
 * The macOS menu-bar popover — a frameless card rendered by the same bundle
 * under `?surface=popover` (see `main.tsx`). It is a THIN, read-only view over a
 * snapshot main pushes (`MenubarController.buildSnapshot`): it never touches the
 * heavy app store, spawns nothing, and every action it fires routes back through
 * a main-authorized IPC verb.
 *
 * Layout is a fixed header + status strip, a scrolling agents list, and a fixed
 * footer nav — the card itself fills the frameless window; only the rows scroll.
 * The popover is the agent list, full stop: the status-strip counts double as
 * one-click filters, so there's no separate dashboard view.
 */

const STATE_DOT_CLASS: Record<AgentState, string> = {
  blocked: 'agent-blocked',
  working: 'agent-working',
  done: 'agent-done',
  idle: 'agent-idle',
  unknown: 'agent-idle',
  waiting: 'agent-waiting'
};

const EMPTY: MenubarSnapshot = {
  agents: [],
  needsYou: 0,
  working: 0,
  scheduleCount: 0,
  nextRunAt: null,
  theme: 'dark'
};

export function MenubarPopover() {
  const [snapshot, setSnapshot] = useState<MenubarSnapshot>(EMPTY);
  const [filter, setFilter] = useState<'all' | 'blocked' | 'working'>('all');
  // Bumped whenever the popover window regains focus. The window is reused
  // across opens (main hides/shows it, never remounts), so keying the body on
  // this replays the CSS entrance animation on every open — the card always
  // feels freshly drawn rather than static.
  const [openTick, setOpenTick] = useState(0);
  const clock = useClock();

  // Seed once on mount, then follow live pushes. Both go through the same
  // read-only channel; main owns the data.
  useEffect(() => {
    let alive = true;
    window.cc.menubar
      .request()
      .then((s) => alive && setSnapshot(s))
      .catch(() => {});
    const off = window.cc.menubar.onSnapshot((s) => setSnapshot(s));
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Match the app's theme on the popover's own document (it has no store).
  useEffect(() => {
    document.documentElement.dataset.theme = snapshot.theme;
  }, [snapshot.theme]);

  // Esc dismisses, like a native menu.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') window.cc.menubar.hide().catch(() => {});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Replay the entrance on each open (window regains focus when main shows it).
  useEffect(() => {
    const onFocus = () => setOpenTick((n) => n + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const rows = useMemo(() => {
    if (filter === 'all') return snapshot.agents;
    return snapshot.agents.filter((a) => a.state === filter);
  }, [snapshot.agents, filter]);

  const calm = snapshot.needsYou === 0 && snapshot.working === 0;

  // A stat-strip click toggles the list filter for that state — click "3 need
  // you" to see only blocked rows, click again to clear back to all.
  const drill = (next: 'blocked' | 'working') => {
    setFilter((f) => (f === next ? 'all' : next));
  };

  return (
    <div className="mbp-card">
      <header className="mbp-header">
        <div className="mbp-brand">
          <span className="mbp-brand-badge" aria-hidden="true">
            <WandSparkles size={15} className="mbp-brand-glyph" />
          </span>
          <span className="mbp-brand-name">Zana</span>
        </div>
        <div className="mbp-header-right">
          <span className="mbp-clock" title={clock.full}>
            <span
              className={`mbp-clock-dot ${snapshot.needsYou > 0 ? 'is-alert' : 'is-calm'}`}
              aria-hidden="true"
            />
            {clock.short}
          </span>
          <button
            className="mbp-icon-btn"
            title="Refresh"
            aria-label="Refresh"
            onClick={() => window.cc.menubar.request().then(setSnapshot).catch(() => {})}
          >
            <RefreshCw size={13} />
          </button>
          <button
            className="mbp-icon-btn mbp-open-app"
            title="Open Zana"
            aria-label="Open Zana"
            onClick={() => nav('dashboard')}
          >
            <AppWindow size={14} />
          </button>
        </div>
      </header>

      <div className="mbp-strip" role="group" aria-label="Fleet status">
        <button
          className={`mbp-stat ${filter === 'blocked' ? 'is-active' : ''}`}
          onClick={() => drill('blocked')}
        >
          <span className="mbp-stat-value mbp-stat-value--alert">{snapshot.needsYou}</span>
          <span className="mbp-stat-label">need you</span>
        </button>
        <button
          className={`mbp-stat ${filter === 'working' ? 'is-active' : ''}`}
          onClick={() => drill('working')}
        >
          <span className="mbp-stat-value">{snapshot.working}</span>
          <span className="mbp-stat-label">working</span>
        </button>
      </div>

      {/* The body is the agents list. Keyed on filter+openTick so the entrance
          animation replays when the filter changes and on each open. */}
      <div className="mbp-body" key={`${filter}-${openTick}`}>
        <div className="mbp-rows">
          {rows.length === 0 ? (
            <CalmState snapshot={snapshot} filtered={!calm} />
          ) : (
            rows.map((a, i) => (
              <Row
                key={a.sessionId}
                agent={a}
                index={i}
                // Divider between the attention group and the running group.
                showDivider={i > 0 && rows[i - 1].state === 'blocked' && a.state !== 'blocked'}
              />
            ))
          )}
        </div>
      </div>

      <footer className="mbp-nav">
        <NavButton
          icon={<Zap size={17} />}
          label="All agents"
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <NavButton icon={<Settings size={17} />} label="Settings" onClick={() => nav('settings')} />
        <NavButton icon={<Power size={17} />} label="Quit" danger onClick={() => window.cc.menubar.quit()} />
      </footer>
    </div>
  );
}

function Row({
  agent,
  showDivider,
  index
}: {
  agent: MenubarAgent;
  showDivider: boolean;
  index: number;
}) {
  const subtitle = useSubtitle(agent);
  // Stagger the entrance: each row's animation-delay steps with its position,
  // capped so a long list doesn't crawl in. CSS reads --mbp-i off the row.
  const style = {
    ...(agent.projectColor ? { '--project-color': agent.projectColor } : {}),
    '--mbp-i': Math.min(index, 8)
  } as CSSProperties;
  return (
    <>
      {showDivider && <div className="mbp-divider" aria-hidden="true" />}
      <div className={`mbp-row ${agent.projectColor ? 'is-tinted' : ''}`} style={style}>
        <span className={`tab-agent-dot ${STATE_DOT_CLASS[agent.state]}`} aria-hidden="true" />
        <button
          className="mbp-row-main"
          title={`${agent.title} — ${agent.projectName}`}
          onClick={() => window.cc.menubar.focusSession(agent.sessionId, agent.projectId)}
        >
          <span className="mbp-row-title">{agent.title}</span>
          <span className="mbp-row-subline">
            {/* A blocked agent's parked question is the most useful subtitle —
                prefer it over the generic "needs you" when we have it. */}
            <span className="mbp-row-sub">{agent.question || subtitle}</span>
            <span className="mbp-row-project">{agent.projectName}</span>
          </span>
        </button>
        {/* Star + open stacked vertically in one narrow column so the two
            actions claim a single column of row width instead of two. */}
        <span className="mbp-row-actions">
          <button
            className={`mbp-icon-btn mbp-fav ${agent.favorite ? 'is-fav' : ''}`}
            title={agent.favorite ? 'Following — click to unfollow' : 'Follow this agent'}
            aria-label={agent.favorite ? 'Unfollow agent' : 'Follow agent'}
            aria-pressed={agent.favorite}
            onClick={() => window.cc.menubar.setFavorite(agent.sessionId, !agent.favorite)}
          >
            <Star size={13} fill={agent.favorite ? 'currentColor' : 'none'} />
          </button>
          <button
            className="mbp-icon-btn mbp-open"
            title="Open in workspace"
            aria-label="Open in workspace"
            onClick={() => window.cc.menubar.focusSession(agent.sessionId, agent.projectId)}
          >
            <ArrowRight size={14} />
          </button>
        </span>
      </div>
    </>
  );
}

function CalmState({ snapshot, filtered }: { snapshot: MenubarSnapshot; filtered: boolean }) {
  if (filtered) {
    return <div className="mbp-empty">No agents match this filter.</div>;
  }
  return (
    <div className="mbp-empty">
      <div className="mbp-empty-title">No agents need you right now</div>
      {snapshot.scheduleCount > 0 && (
        <div className="mbp-empty-sub">
          {snapshot.scheduleCount} scheduled
          {snapshot.nextRunAt ? ` · next ${formatClock(snapshot.nextRunAt)}` : ''}
        </div>
      )}
    </div>
  );
}

function NavButton({
  icon,
  label,
  onClick,
  danger,
  active
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      className={`mbp-nav-btn ${danger ? 'is-danger' : ''} ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="mbp-nav-icon">{icon}</span>
      <span className="mbp-nav-label">{label}</span>
    </button>
  );
}

function nav(view: 'dashboard' | 'agents' | 'settings' | 'scheduler') {
  window.cc.menubar.open(view).catch(() => {});
}

/** Row subtitle: `state · reason/elapsed`. A live elapsed ticks for working. */
function useSubtitle(agent: MenubarAgent): string {
  const [, tick] = useState(0);
  useEffect(() => {
    if (agent.state !== 'working') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [agent.state]);

  if (agent.state === 'blocked') return 'needs you';
  if (agent.state === 'done') return 'done · session open';
  if (agent.state === 'working') return `working · ${formatElapsed(Date.now() - agent.createdAt)}`;
  if (agent.state === 'waiting') return 'waiting for model';
  return agent.state;
}

/**
 * Live header clock, ticking each minute. `short` (time + tz) is what fits in
 * the narrow 380px header beside the brand; `full` (with the date) rides in the
 * title tooltip — the whole "Jul 6, 2026 at 1:43 PM GMT+2" would collide with
 * "Command Center" at this width.
 */
function useClock(): { short: string; full: string } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const d = new Date(now);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const short = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });
  return { short, full: `${date} at ${short}` };
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return remS ? `${m}m ${remS}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM ? `${h}h ${remM}m` : `${h}h`;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
