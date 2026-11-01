/**
 * Dashboard tab: my tickets by status, the sprint countdown, and what's blocked.
 * (Written by the scripted agent in e2e/demo-zana-tour.spec.ts.)
 */
import { AlertCircle, CalendarClock, CheckCircle2, CircleDot, Flame } from 'lucide-react';
import type { GusIdentity, GusSprint, GusWorkItem } from '../../lib/types.js';

const STATUS_ORDER = ['New', 'In Progress', 'Ready for Review', 'Waiting', 'Fixed', 'QA In Progress', 'Completed'];
const STATUS_COLOR: Record<string, string> = {
  New: '#94a3b8', 'In Progress': '#3b82f6', 'Ready for Review': '#8b5cf6', Waiting: '#f59e0b',
  Fixed: '#14b8a6', 'QA In Progress': '#06b6d4', Completed: '#22c55e'
};
const isBlocked = (it: GusWorkItem) => /waiting|blocked/i.test(it.status);
const isDone = (it: GusWorkItem) => /fixed|completed|closed/i.test(it.status);

function daysLeft(sprint: GusSprint | null): number | null {
  if (!sprint?.endDate) return null;
  return Math.max(0, Math.ceil((new Date(`${sprint.endDate}T23:59:59`).getTime() - Date.now()) / 86_400_000));
}

const css = `
.gus-dash { padding: 18px 22px 28px; display: grid; gap: 16px; overflow: auto; min-height: 0; }
.gus-dash-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.gus-dash-kpi { border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; background: var(--bg-elevated); display: grid; gap: 6px; animation: gus-dash-in .45s ease both; }
.gus-dash-kpi span { color: var(--text-dim); font-size: 12px; display: flex; gap: 6px; align-items: center; }
.gus-dash-kpi strong { font-size: 30px; line-height: 1; color: var(--text-primary); }
.gus-dash-row { display: grid; grid-template-columns: 1.3fr 1fr; gap: 12px; }
.gus-dash-card { border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; background: var(--bg-elevated); animation: gus-dash-in .45s .1s ease both; }
.gus-dash-card h3 { font-size: 13px; margin: 0 0 12px; color: var(--text-primary); display: flex; gap: 6px; align-items: center; }
.gus-dash-bar { display: grid; grid-template-columns: 130px 1fr 28px; gap: 10px; align-items: center; font-size: 12px; color: var(--text-muted); margin: 7px 0; }
.gus-dash-bar i { display: block; height: 10px; border-radius: 6px; background: var(--bg-hover); overflow: hidden; }
.gus-dash-bar i b { display: block; height: 100%; border-radius: 6px; transform-origin: left; animation: gus-dash-grow .7s .2s ease both; }
.gus-dash-bar em { font-style: normal; text-align: right; color: var(--text-primary); font-weight: 600; }
.gus-dash-item { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 8px; cursor: pointer; font-size: 12.5px; color: var(--text-primary); }
.gus-dash-item:hover { background: var(--bg-hover); }
.gus-dash-item code { color: var(--accent-blue); font-size: 11.5px; }
.gus-dash-item small { margin-left: auto; color: var(--text-dim); white-space: nowrap; }
.gus-dash-empty { color: var(--text-dim); font-size: 12px; }
@keyframes gus-dash-in { from { opacity: 0; transform: translateY(8px); } }
@keyframes gus-dash-grow { from { transform: scaleX(0); } }
`;

export function GusDashboard({ items, sprint, identity, onOpen }: {
  items: GusWorkItem[];
  sprint: GusSprint | null;
  identity: GusIdentity | null;
  onOpen: (item: GusWorkItem) => void;
}) {
  const mine = identity ? items.filter((it) => !it.assigneeId || it.assigneeId === identity.userId) : items;
  const counts = STATUS_ORDER.map((status) => ({ status, count: mine.filter((it) => it.status === status).length })).filter((row) => row.count > 0);
  const max = Math.max(1, ...counts.map((row) => row.count));
  const blocked = mine.filter(isBlocked);
  const open = mine.filter((it) => !isDone(it));
  const due = open.filter((it) => !isBlocked(it) && it.sprintId === sprint?.id);
  const left = daysLeft(sprint);
  const points = open.reduce((sum, it) => sum + (it.storyPoints ?? 0), 0);

  return (
    <div className="gus-dash">
      <style>{css}</style>
      <div className="gus-dash-kpis">
        <div className="gus-dash-kpi"><span><CircleDot size={13} /> Open tickets</span><strong>{open.length}</strong></div>
        <div className="gus-dash-kpi"><span><Flame size={13} /> Story points left</span><strong>{points}</strong></div>
        <div className="gus-dash-kpi"><span><AlertCircle size={13} /> Blocked</span><strong style={{ color: blocked.length ? 'var(--danger)' : undefined }}>{blocked.length}</strong></div>
        <div className="gus-dash-kpi"><span><CalendarClock size={13} /> {sprint?.name ?? 'Sprint'}</span><strong>{left === null ? '–' : `${left}d`}</strong></div>
      </div>
      <div className="gus-dash-row">
        <div className="gus-dash-card">
          <h3>Tickets by status</h3>
          {counts.map((row) => (
            <div className="gus-dash-bar" key={row.status}>
              <span>{row.status}</span>
              <i><b style={{ width: `${(row.count / max) * 100}%`, background: STATUS_COLOR[row.status] ?? 'var(--accent-blue)' }} /></i>
              <em>{row.count}</em>
            </div>
          ))}
        </div>
        <div className="gus-dash-card">
          <h3><AlertCircle size={14} /> Blocked</h3>
          {blocked.length === 0 ? <div className="gus-dash-empty">Nothing blocked.</div> : blocked.map((it) => (
            <div className="gus-dash-item" key={it.id} onClick={() => onOpen(it)}>
              <code>{it.name}</code>{it.subject}<small>{it.status}</small>
            </div>
          ))}
        </div>
      </div>
      <div className="gus-dash-card">
        <h3><CheckCircle2 size={14} /> Due this sprint{left === null ? '' : ` · ${left} days left`}</h3>
        {due.map((it) => (
          <div className="gus-dash-item" key={it.id} onClick={() => onOpen(it)}>
            <code>{it.name}</code>{it.subject}<small>{it.status} · {it.storyPoints ?? 0} pts</small>
          </div>
        ))}
      </div>
    </div>
  );
}
