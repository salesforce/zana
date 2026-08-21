import React, { useMemo } from 'react';
import {
  Clock,
  Activity,
  History,
  CheckCircle2,
  XCircle,
  CircleSlash,
  AlertTriangle,
  ExternalLink,
  Folder,
  FileText,
  Play,
  Square
} from 'lucide-react';
import type { ScheduledTask, Project, ScheduleRun } from '@shared/types';
import { useData } from '../../store';
import { KpiCard } from './KpiCard';
import {
  formatRelative,
  formatDuration,
  formatCountdown,
  cadenceLabel,
  PROFILE_LABEL
} from './schedulerUtils';

interface SchedulerOverviewProps {
  tasks: ScheduledTask[];
  projects: Project[];
  tick: number;
  onJump: (t: ScheduledTask) => void;
  onOpenTerminal: (t: ScheduledTask, sessionId: string) => void;
  onEdit: (t: ScheduledTask) => void;
  onShowReport: (run: ScheduleRun, taskName: string) => void;
  onToggle: (t: ScheduledTask) => void;
  onRunNow: (t: ScheduledTask) => void;
  onStopLive: (t: ScheduledTask, sessionId: string) => void;
  /** Hide the cross-project "By project" breakdown — redundant when the
   *  overview is already scoped to a single project (the per-project tab). */
  hideByProject?: boolean;
  /** Open a project's own Scheduler tab from the "By project" breakdown. */
  onOpenProject?: (projectId: string) => void;
}

export function SchedulerOverview({
  tasks,
  projects,
  tick,
  onJump,
  onOpenTerminal,
  onEdit,
  onShowReport,
  onToggle,
  onRunNow,
  onStopLive,
  hideByProject = false,
  onOpenProject
}: SchedulerOverviewProps) {
  const terminalsByProject = useData((s) => s.terminals);

  const {
    enabled,
    disabled,
    working,
    finishedOpen,
    runs24,
    success24,
    errors24,
    skipped24,
    incomplete24
  } = useMemo(() => {
    const en = tasks.filter((t) => t.enabled);
    const live = new Set<string>();
    for (const [pid, list] of Object.entries(terminalsByProject)) {
      for (const s of list) {
        if (s.status === 'running' || s.status === 'starting') {
          live.add(`${pid}:${s.id}`);
        }
      }
    }
    // Walk the run history newest→oldest so a task whose latest record is a
    // 'skipped' (no sessionId) but whose previous run is still alive still
    // shows up. Emit one row per live task, split by whether the agent is still
    // working (no `finishedAt`) or finished its turn but left the session open.
    const work: Array<{ task: ScheduledTask; sessionId: string }> = [];
    const done: Array<{ task: ScheduledTask; sessionId: string }> = [];
    for (const t of tasks) {
      const runs = t.status?.runs ?? [];
      for (const r of runs) {
        if (r.sessionId && live.has(`${t.projectId}:${r.sessionId}`)) {
          (r.finishedAt ? done : work).push({ task: t, sessionId: r.sessionId });
          break;
        }
      }
    }
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    let r24 = 0, ok = 0, err = 0, skip = 0, incomplete = 0;
    for (const t of tasks) {
      for (const r of t.status?.runs ?? []) {
        const ts = Date.parse(r.at);
        if (Number.isNaN(ts) || ts < dayAgo) continue;
        r24++;
        if (r.result === 'success') ok++;
        else if (r.result === 'error') err++;
        else if (r.result === 'skipped') skip++;
        // 'incomplete' = exited 0 but never filed a schedule_report — a silent
        // failure (dead stream mid-run, etc.). Counted separately from 'error'
        // so the KPI distinguishes "crashed loudly" from "died quietly".
        else if (r.result === 'incomplete') incomplete++;
      }
    }
    return {
      enabled: en,
      disabled: tasks.length - en.length,
      working: work,
      finishedOpen: done,
      runs24: r24,
      success24: ok,
      errors24: err,
      skipped24: skip,
      incomplete24: incomplete
    };
    // dayAgo and live-session liveness depend on real time; tick keeps them fresh.
  }, [tasks, terminalsByProject, tick]);

  // Per-task action state for the "All schedules" list rows, so those rows can
  // offer the SAME run-now / open / stop / report gestures as a SchedulerCard.
  // Keyed by task id: the live session (if the agent is running) and the newest
  // run that produced a report. Mirrors SchedulerCard's liveSessionId +
  // lastReportRun derivation, but computed in bulk here.
  const rowActionState = useMemo(() => {
    const live = new Set<string>();
    for (const [pid, list] of Object.entries(terminalsByProject)) {
      for (const s of list) {
        if (s.status === 'running' || s.status === 'starting') live.add(`${pid}:${s.id}`);
      }
    }
    const map = new Map<string, { liveSessionId: string | null; lastReportRun: ScheduleRun | null }>();
    for (const t of tasks) {
      const runs = t.status?.runs ?? [];
      let liveSessionId: string | null = null;
      for (const r of runs) {
        if (r.sessionId && live.has(`${t.projectId}:${r.sessionId}`)) {
          liveSessionId = r.sessionId;
          break;
        }
      }
      const lastReportRun = runs.find((r) => !!r.report) ?? null;
      map.set(t.id, { liveSessionId, lastReportRun });
    }
    return map;
    // live-session liveness depends on real time; tick keeps it fresh.
  }, [tasks, terminalsByProject, tick]);

  const upcoming = useMemo(
    () =>
      enabled
        .map((t) => ({ task: t, at: t.status?.nextRunAt ? new Date(t.status.nextRunAt) : null }))
        .filter((x): x is { task: ScheduledTask; at: Date } => x.at !== null && !Number.isNaN(x.at.getTime()))
        .sort((a, b) => a.at.getTime() - b.at.getTime())
        .slice(0, 10),
    [enabled]
  );

  const recent = useMemo(
    () =>
      tasks
        .flatMap((t) => (t.status?.runs ?? []).map((r) => ({ task: t, run: r, ts: Date.parse(r.at) })))
        .filter((x) => !Number.isNaN(x.ts))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 12),
    [tasks]
  );

  const projectStats = useMemo(
    () =>
      projects
        .map((p) => {
          const own = tasks.filter((t) => t.projectId === p.id);
          const en = own.filter((t) => t.enabled).length;
          const lastTs = own
            .flatMap((t) => (t.status?.lastRunAt ? [Date.parse(t.status.lastRunAt)] : []))
            .filter((n) => !Number.isNaN(n))
            .sort((a, b) => b - a)[0];
          return {
            project: p,
            total: own.length,
            enabled: en,
            disabled: own.length - en,
            lastRun: lastTs ?? null
          };
        })
        .filter((s) => s.total > 0)
        .sort((a, b) => b.total - a.total),
    [tasks, projects]
  );

  const nextFire = upcoming[0]?.at ?? null;

  // Every schedule, armed ones first (by soonest fire), then paused ones — so
  // Overview answers "what's on?" at a glance and lets you flip any schedule
  // on/off inline.
  const allSchedules = useMemo(() => {
    const nextAt = (t: ScheduledTask) => {
      const ts = t.status?.nextRunAt ? Date.parse(t.status.nextRunAt) : NaN;
      return Number.isNaN(ts) ? Infinity : ts;
    };
    return [...tasks].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      if (a.enabled) return nextAt(a) - nextAt(b);
      return a.name.localeCompare(b.name);
    });
  }, [tasks]);

  return (
    <div className="scheduler-overview">
      <section className="overview-kpis">
        <KpiCard label="Schedules" value={tasks.length} sub={`${enabled.length} on · ${disabled} off`} />
        <KpiCard
          label="Running now"
          value={working.length}
          sub={
            working.length === 0
              ? finishedOpen.length > 0
                ? `${finishedOpen.length} done · open`
                : 'No live sessions'
              : 'Agents working'
          }
          accent={working.length > 0 ? 'live' : undefined}
        />
        <KpiCard
          label="Next fire"
          value={nextFire ? formatCountdown(nextFire) : '—'}
          sub={nextFire ? upcoming[0].task.name : 'Nothing scheduled'}
        />
        <KpiCard
          label="Last 24h"
          value={runs24}
          sub={`${success24} ok · ${errors24} err · ${incomplete24} incomplete · ${skipped24} skip`}
          accent={errors24 > 0 || incomplete24 > 0 ? 'error' : undefined}
        />
      </section>

      {working.length > 0 && (
        <section className="overview-card">
          <header className="overview-card-header">
            <Activity size={14} />
            <h3>Running now</h3>
            <span className="overview-card-badge">{working.length}</span>
          </header>
          <ul className="overview-list">
            {working.map(({ task, sessionId }) => {
              const project = projects.find((p) => p.id === task.projectId);
              return (
                <li key={task.id} className="overview-item">
                  <span
                    className="scheduler-status-dot scheduler-status-dot--running"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className="overview-item-main"
                    onClick={() => onOpenTerminal(task, sessionId)}
                    title="Jump into the running terminal"
                  >
                    <div className="overview-item-name">{task.name}</div>
                    <div className="overview-item-meta">
                      {project?.name ?? '⟨missing⟩'} · {PROFILE_LABEL[task.profile]} · {cadenceLabel(task.schedule)}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onOpenTerminal(task, sessionId)}
                    title="Open running terminal"
                    aria-label="Open running terminal"
                  >
                    <ExternalLink size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {finishedOpen.length > 0 && (
        <section className="overview-card">
          <header className="overview-card-header">
            <CheckCircle2 size={14} />
            <h3>Finished · session open</h3>
            <span className="overview-card-badge">{finishedOpen.length}</span>
          </header>
          <ul className="overview-list">
            {finishedOpen.map(({ task, sessionId }) => {
              const project = projects.find((p) => p.id === task.projectId);
              return (
                <li key={task.id} className="overview-item">
                  <span
                    className="scheduler-status-dot scheduler-status-dot--done"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className="overview-item-main"
                    onClick={() => onOpenTerminal(task, sessionId)}
                    title="Agent finished — open the session to review or continue"
                  >
                    <div className="overview-item-name">{task.name}</div>
                    <div className="overview-item-meta">
                      {project?.name ?? '⟨missing⟩'} · {PROFILE_LABEL[task.profile]} · {cadenceLabel(task.schedule)}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onOpenTerminal(task, sessionId)}
                    title="Open session"
                    aria-label="Open session"
                  >
                    <ExternalLink size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="overview-columns">
        <section className="overview-card">
          <header className="overview-card-header">
            <Clock size={14} />
            <h3>Next up</h3>
          </header>
          {upcoming.length === 0 ? (
            <div className="overview-empty">No upcoming fires. Enable a schedule to populate this list.</div>
          ) : (
            <ul className="overview-list">
              {upcoming.map(({ task, at }) => {
                const project = projects.find((p) => p.id === task.projectId);
                return (
                  <li key={task.id} className="overview-item">
                    <button
                      type="button"
                      className="overview-item-main"
                      onClick={() => onEdit(task)}
                      title="Edit schedule"
                    >
                      <div className="overview-item-name">{task.name}</div>
                      <div className="overview-item-meta">
                        {project?.name ?? '⟨missing⟩'} · {PROFILE_LABEL[task.profile]} · {cadenceLabel(task.schedule)}
                      </div>
                    </button>
                    <div className="overview-item-when">
                      <div className="overview-item-countdown">{formatCountdown(at)}</div>
                      <div className="overview-item-abs">{at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="overview-card">
          <header className="overview-card-header">
            <History size={14} />
            <h3>Recent activity</h3>
          </header>
          {recent.length === 0 ? (
            <div className="overview-empty">No runs recorded yet.</div>
          ) : (
            <ul className="overview-list">
              {recent.map(({ task, run, ts }, i) => (
                <li key={`${task.id}-${i}`} className="overview-item">
                  <div className={`overview-result overview-result--${run.result}`}>
                    {run.result === 'success' ? (
                      <CheckCircle2 size={14} />
                    ) : run.result === 'error' ? (
                      <XCircle size={14} />
                    ) : run.result === 'incomplete' ? (
                      <AlertTriangle size={14} />
                    ) : (
                      <CircleSlash size={14} />
                    )}
                  </div>
                  <button
                    type="button"
                    className="overview-item-main"
                    onClick={() => onJump(task)}
                    title="Open in scope"
                  >
                    <div className="overview-item-name">{task.name}</div>
                    <div className="overview-item-meta">
                      {run.result}
                      {run.durationMs ? ` · ${formatDuration(run.durationMs)}` : ''}
                      {run.message ? ` · ${run.message}` : ''}
                    </div>
                  </button>
                  {run.report && (
                    <button
                      type="button"
                      className="scheduler-run-report-btn"
                      title="View run report"
                      aria-label="View run report"
                      onClick={() => onShowReport(run, task.name)}
                    >
                      <FileText size={13} strokeWidth={1.75} />
                    </button>
                  )}
                  <div className="overview-item-when">
                    <div className="overview-item-abs">{formatRelative(new Date(ts))}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="overview-card">
        <header className="overview-card-header">
          <Clock size={14} />
          <h3>All schedules</h3>
          <span className="overview-card-badge overview-card-badge--neutral">
            {enabled.length} on · {disabled} off
          </span>
        </header>
        {allSchedules.length === 0 ? (
          <div className="overview-empty">No schedules yet.</div>
        ) : (
          <ul className="overview-list">
            {allSchedules.map((t) => {
              const project = projects.find((p) => p.id === t.projectId);
              const nextRun = t.status?.nextRunAt ? new Date(t.status.nextRunAt) : null;
              const nextValid = nextRun && !Number.isNaN(nextRun.getTime());
              const external = t.external?.kind === 'claude-loop';
              const { liveSessionId, lastReportRun } = rowActionState.get(t.id) ?? {
                liveSessionId: null,
                lastReportRun: null
              };
              return (
                <li
                  key={t.id}
                  className={`overview-item overview-item--schedule ${t.enabled ? '' : 'is-off'}`}
                >
                  {external ? (
                    <span
                      className="scheduler-toggle scheduler-toggle--readonly"
                      aria-hidden
                      title="Managed by Claude Code"
                    />
                  ) : (
                    <label
                      className="scheduler-toggle"
                      onClick={(e) => e.stopPropagation()}
                      title={t.enabled ? 'Disable schedule' : 'Enable schedule'}
                    >
                      <input type="checkbox" checked={t.enabled} onChange={() => onToggle(t)} />
                      <span aria-hidden />
                    </label>
                  )}
                  <button
                    type="button"
                    className="overview-item-main"
                    onClick={() => onEdit(t)}
                    title="Edit schedule"
                  >
                    <div className="overview-item-name">{t.name}</div>
                    <div className="overview-item-meta">
                      {project?.name ?? '⟨missing⟩'} · {PROFILE_LABEL[t.profile]} · {cadenceLabel(t.schedule)}
                    </div>
                  </button>
                  {/* Per-row actions — the same gestures as a SchedulerCard:
                      open/stop a live run, or fire it now; plus the last report.
                      External (Claude-loop) schedules are host-managed, so they
                      only ever expose the report button, never run/stop. */}
                  <div
                    className="overview-item-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!external && liveSessionId && (
                      <>
                        <button
                          type="button"
                          className="scheduler-icon-btn"
                          onClick={() => onOpenTerminal(t, liveSessionId)}
                          title="Open live run"
                        >
                          <ExternalLink size={14} />
                        </button>
                        <button
                          type="button"
                          className="scheduler-icon-btn scheduler-icon-btn--danger"
                          onClick={() => onStopLive(t, liveSessionId)}
                          title="Stop live run"
                        >
                          <Square size={14} />
                        </button>
                      </>
                    )}
                    {!external && !liveSessionId && (
                      <button
                        type="button"
                        className="scheduler-icon-btn"
                        onClick={() => onRunNow(t)}
                        title="Run now"
                      >
                        <Play size={14} />
                      </button>
                    )}
                    {lastReportRun && (
                      <button
                        type="button"
                        className="scheduler-icon-btn scheduler-icon-btn--report"
                        onClick={() => onShowReport(lastReportRun, t.name)}
                        title="View last report"
                      >
                        <FileText size={14} strokeWidth={1.75} />
                      </button>
                    )}
                  </div>
                  <div className="overview-item-when">
                    {t.enabled && nextValid ? (
                      <>
                        <div className="overview-item-countdown">{formatCountdown(nextRun)}</div>
                        <div className="overview-item-abs">
                          {nextRun.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </>
                    ) : (
                      <span className="scheduler-card-compact-next scheduler-card-compact-next--muted">
                        {t.enabled ? '—' : 'paused'}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!hideByProject && (
      <section className="overview-card">
        <header className="overview-card-header">
          <Folder size={14} />
          <h3>By project</h3>
        </header>
        {projectStats.length === 0 ? (
          <div className="overview-empty">No project schedules yet.</div>
        ) : (
          <ul className="overview-projects">
            {projectStats.map((s) => (
              <li key={s.project.id} className="overview-project-row">
                <span
                  className="project-dot"
                  style={s.project.color ? { background: s.project.color } : undefined}
                />
                {onOpenProject ? (
                  <button
                    type="button"
                    className="overview-project-name"
                    onClick={() => onOpenProject(s.project.id)}
                    title="Open project schedules"
                  >
                    {s.project.name}
                  </button>
                ) : (
                  <span className="overview-project-name">{s.project.name}</span>
                )}
                <span className="overview-project-count">{s.total}</span>
                <span className="overview-project-split">
                  {s.enabled} on · {s.disabled} off
                </span>
                <span className="overview-project-last">
                  {s.lastRun ? `last ${formatRelative(new Date(s.lastRun))}` : 'never run'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}
    </div>
  );
}
