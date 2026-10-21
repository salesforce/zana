import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronRight, Play, Plus } from 'lucide-react';
import type {
  CompanionAgent,
  CompanionPanelState,
  CompanionRequest,
  CompanionSchedule,
  CompanionSnapshot
} from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { CompanionQuestion } from './CompanionQuestion.js';
import {
  agentDot,
  agentStatusLabel,
  formatAge,
  groupAgents,
  scheduleStatus
} from './companion-model.js';
import { useCompanion, useNow } from './useCompanion.js';

/** Card inset from the panel window edge (room for the CSS shadow). */
const INSET = 8;

/**
 * The quick panel window (level 2) — and, for an expanded question, level 3.
 * Main sizes the window once; the card hugs the rail side and aligns with the
 * rail top. Clicking the transparent area or pressing Esc closes it.
 */
export function CompanionPanel() {
  const { snapshot, pending, resolve } = useCompanion();
  const [state, setState] = useState<CompanionPanelState | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [top, setTop] = useState(INSET);
  const cardRef = useRef<HTMLDivElement>(null);
  const kindRef = useRef<CompanionPanelState['kind'] | null>(null);
  const now = useNow();

  useEffect(() => {
    void product.companion.panelState().then((s) => s && apply(s));
    const offPanel = product.companion.onPanel(apply);
    const offClosed = product.companion.onPanelClosed(() => {
      kindRef.current = null;
      setState(null);
      setExpanded(null);
    });
    return () => {
      offPanel();
      offClosed();
    };
  }, []);

  function apply(s: CompanionPanelState) {
    // A re-layout (display change) re-sends the same kind without a focus id:
    // keep whatever question is open. Switching panels starts fresh.
    const sameKind = kindRef.current === s.kind;
    kindRef.current = s.kind;
    setState(s);
    setExpanded((cur) => s.focusRequestId ?? (sameKind ? cur : null));
  }

  // A focused request that's gone (answered elsewhere) falls back to the list.
  const expandedRequest = expanded ? pending.find((r) => r.id === expanded) ?? null : null;

  // Align the card's top with the rail, sliding up only if it would overflow.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !state) return;
    const place = () => {
      const h = card.offsetHeight;
      setTop(Math.max(INSET, Math.min(state.anchorY, window.innerHeight - h - INSET)));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(card);
    return () => ro.disconnect();
  }, [state, expandedRequest]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (expandedRequest) setExpanded(null);
      else void product.companion.closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expandedRequest]);

  if (!state) return null;

  const onResolved = (r: CompanionRequest) => {
    resolve(r);
    setExpanded(null);
    // The flow ends quiet: once nothing's left, the panel gets out of the way.
    if (pending.length <= 1) setTimeout(() => void product.companion.closePanel(), 250);
  };

  let body: ReactNode;
  if (state.kind === 'needs-you') {
    body = expandedRequest ? (
      <CompanionQuestion
        key={expandedRequest.id}
        request={expandedRequest}
        onBack={() => setExpanded(null)}
        onResolved={onResolved}
      />
    ) : (
      <NeedsYouList pending={pending} snapshot={snapshot} now={now} onOpen={setExpanded} />
    );
  } else if (state.kind === 'agents') {
    body = <AgentsList snapshot={snapshot} pending={pending} now={now} />;
  } else if (state.kind === 'scheduler') {
    body = <ScheduleList schedules={snapshot.schedules} now={now} />;
  } else {
    body = <StatusCard snapshot={snapshot} pendingCount={pending.length} />;
  }

  return (
    <div
      className={`cc-panel-stage cc-rail-${state.railSide}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) void product.companion.closePanel();
      }}
    >
      <div
        ref={cardRef}
        className={`cc-card${expandedRequest ? ' is-expanded' : ''}`}
        style={{ top }}
        role="dialog"
        aria-label={panelTitle(state.kind)}
      >
        {body}
      </div>
    </div>
  );
}

function panelTitle(kind: CompanionPanelState['kind']): string {
  return { 'needs-you': 'Needs you', agents: 'Agents', scheduler: 'Scheduler', status: 'Status' }[kind];
}

function CardHeader({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <header className="cc-card-head">
      <span className="cc-card-title">{title}</span>
      {count !== undefined && count > 0 && <span className="cc-count">{count}</span>}
      <span className="cc-spacer" />
      {action}
    </header>
  );
}

function AllClear({ working }: { working: number }) {
  return (
    <div className="cc-all-clear">
      <span className="cc-all-clear-check">
        <Check size={18} />
      </span>
      <span className="cc-all-clear-title">All clear</span>
      <span className="cc-all-clear-sub">
        {working > 0 ? `${working} agent${working === 1 ? '' : 's'} working` : 'Nothing needs you'}
      </span>
    </div>
  );
}

function NeedsYouList({
  pending,
  snapshot,
  now,
  onOpen
}: {
  pending: CompanionRequest[];
  snapshot: CompanionSnapshot;
  now: number;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <CardHeader title="Needs you" count={pending.length} />
      {pending.length === 0 ? (
        <AllClear working={snapshot.counts.working} />
      ) : (
        <ul className="cc-list">
          {pending.map((r) => (
            <li key={r.id}>
              <button type="button" className="cc-row cc-request" onClick={() => onOpen(r.id)}>
                <span className="cc-dot cc-dot-attention" aria-hidden />
                <span className="cc-row-main">
                  <span className="cc-row-title">{r.agentTitle}</span>
                  <span className="cc-row-prompt">{r.prompt || 'Waiting for your input'}</span>
                  <span className="cc-row-meta">
                    {r.projectName} · {formatAge(r.ts, now)}
                    {r.questions && r.questions.length > 1 ? ` · ${r.questions.length} questions` : ''}
                  </span>
                </span>
                <ChevronRight size={14} className="cc-row-chevron" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AgentsList({
  snapshot,
  pending,
  now
}: {
  snapshot: CompanionSnapshot;
  pending: CompanionRequest[];
  now: number;
}) {
  const groups = groupAgents(snapshot.agents, pending);
  const total = snapshot.agents.length;
  return (
    <>
      <CardHeader
        title="Agents"
        count={total}
        action={
          <button
            type="button"
            className="cc-icon-btn"
            title="New agent"
            aria-label="New agent"
            onClick={() => void product.companion.open({ kind: 'home' })}
          >
            <Plus size={15} />
          </button>
        }
      />
      {total === 0 ? (
        <p className="cc-empty">No agents running.</p>
      ) : (
        <div className="cc-scroll">
          <AgentGroup label="Needs you" agents={groups.needsYou} now={now} />
          <AgentGroup label="Working" agents={groups.working} now={now} />
          <AgentGroup label="Idle" agents={groups.idle} now={now} />
        </div>
      )}
      <footer className="cc-card-foot">
        <button type="button" className="cc-link" onClick={() => void product.companion.open({ kind: 'agents' })}>
          Open Agents
        </button>
      </footer>
    </>
  );
}

function AgentGroup({ label, agents, now }: { label: string; agents: CompanionAgent[]; now: number }) {
  if (agents.length === 0) return null;
  return (
    <section className="cc-group">
      <h3 className="cc-group-label">
        {label} <span>{agents.length}</span>
      </h3>
      <ul className="cc-list">
        {agents.map((a) => (
          <li key={a.sessionId}>
            <button
              type="button"
              className="cc-row"
              title={`${a.title} — ${agentStatusLabel(a)}`}
              onClick={() => void product.companion.open({ kind: 'session', sessionId: a.sessionId })}
            >
              <span className={`cc-dot ${agentDot(a)}`} aria-hidden />
              <span className="cc-row-main">
                <span className="cc-row-title">{a.title}</span>
                <span className="cc-row-meta">
                  {agentStatusLabel(a)} · {a.projectName}
                  {a.state === 'working' ? ` · ${formatAge(a.createdAt, now)}` : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** How long a "Starting…" row waits for the run to show up before giving up. */
const START_GRACE_MS = 8000;

function ScheduleList({ schedules, now }: { schedules: CompanionSchedule[]; now: number }) {
  // Run now → "Starting…" until main reports the run (or it was refused).
  const [starting, setStarting] = useState<Record<string, number>>({});
  const [refused, setRefused] = useState<Record<string, true>>({});

  useEffect(() => {
    setStarting((cur) => {
      const next = { ...cur };
      let changed = false;
      for (const id of Object.keys(cur)) {
        const t = schedules.find((s) => s.id === id);
        if (!t || t.running || now - cur[id] > START_GRACE_MS) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [schedules, now]);

  const runNow = (id: string) => {
    setRefused(({ [id]: _drop, ...rest }) => rest);
    setStarting((cur) => ({ ...cur, [id]: Date.now() }));
    void product.companion
      .runSchedule(id)
      .catch(() => false)
      .then((ok) => {
        if (ok) return;
        setStarting(({ [id]: _drop, ...rest }) => rest);
        setRefused((cur) => ({ ...cur, [id]: true }));
      });
  };

  return (
    <>
      <CardHeader title="Scheduler" count={schedules.filter((s) => s.running).length} />
      {schedules.length === 0 ? (
        <p className="cc-empty">No schedules yet.</p>
      ) : (
        <ul className="cc-list cc-scroll">
          {schedules.map((t) => {
            const isStarting = !t.running && starting[t.id] !== undefined;
            const failed = !t.running && !isStarting && t.lastResult === 'error';
            return (
              <li key={t.id} className="cc-row-wrap">
                <button
                  type="button"
                  className="cc-row"
                  onClick={() => void product.companion.open({ kind: 'scheduler', taskId: t.id })}
                >
                  <span
                    className={`cc-dot ${t.running || isStarting ? 'cc-dot-working' : failed ? 'cc-dot-attention' : 'cc-dot-idle'}`}
                    aria-hidden
                  />
                  <span className="cc-row-main">
                    <span className="cc-row-title">{t.name}</span>
                    <span className="cc-row-meta">
                      {scheduleStatus(t, now, isStarting)} · {t.projectName}
                    </span>
                    {refused[t.id] && <span className="cc-row-error">Couldn't start — open it in Zana</span>}
                  </span>
                </button>
                {!t.running && (
                  <button
                    type="button"
                    className="cc-icon-btn cc-row-action"
                    title="Run now"
                    aria-label={`Run ${t.name} now`}
                    disabled={isStarting}
                    onClick={() => runNow(t.id)}
                  >
                    <Play size={13} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <footer className="cc-card-foot">
        <button type="button" className="cc-link" onClick={() => void product.companion.open({ kind: 'scheduler' })}>
          Open Scheduler
        </button>
      </footer>
    </>
  );
}

function StatusCard({ snapshot, pendingCount }: { snapshot: CompanionSnapshot; pendingCount: number }) {
  const c = snapshot.counts;
  return (
    <>
      <div className="cc-status-head">
        <span className="cc-avatar cc-avatar-lg">{snapshot.userInitials || '·'}</span>
        <div>
          <div className="cc-card-title">{pendingCount > 0 ? `${pendingCount} need${pendingCount === 1 ? 's' : ''} you` : 'All clear'}</div>
          <div className="cc-row-meta">
            {c.working} working · {c.idle} idle · {c.runningSchedules} scheduled running
          </div>
        </div>
      </div>
      <div className="cc-status-actions">
        <button type="button" className="cc-btn-primary" onClick={() => void product.companion.open({ kind: 'main' })}>
          Open Zana
        </button>
        <button type="button" className="cc-btn-ghost" onClick={() => void product.companion.exit()}>
          Exit Command Center
        </button>
      </div>
    </>
  );
}
