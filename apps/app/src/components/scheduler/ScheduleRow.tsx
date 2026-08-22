import React, { useState, useEffect, useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Play,
  Pencil,
  Trash2,
  ChevronDown,
  History,
  Copy,
  Square,
  ExternalLink,
  FileText,
  Power,
  PowerOff
} from 'lucide-react';
import type { ScheduledTask, ScheduleRun, ScheduleGroup } from '@zana-ai/zcc-domain/product';
import { useData, useUi } from '../../store.js';
import { groupIcon, GROUP_FALLBACK_COLOR } from '../scheduleGroupMeta.js';
import {
  pickLiveRun,
  formatRelative,
  formatDuration,
  formatCountdown,
  PROFILE_LABEL
} from './schedulerUtils.js';

interface ScheduleRowProps {
  task: ScheduledTask;
  projectName: string;
  group?: ScheduleGroup | null;
  reveal?: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onAskDelete: () => void;
  onShowReport: (run: ScheduleRun, taskName: string) => void;
}

export const ScheduleRow = React.memo(function ScheduleRow({
  task,
  projectName,
  group,
  reveal,
  onEdit,
  onDuplicate,
  onAskDelete,
  onShowReport
}: ScheduleRowProps) {
  // A Claude Code `/loop` cron mirrored read-only into the Scheduler: the app
  // doesn't own its timer, so we show it with a "Claude" badge and hide every
  // mutating control (toggle / run / stop / edit / delete). See claude-loops-store.
  const isExternal = task.external?.kind === 'claude-loop';
  const lastRun = task.status.lastRunAt ? new Date(task.status.lastRunAt) : null;
  const nextRun = task.status.nextRunAt ? new Date(task.status.nextRunAt) : null;
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLLIElement | null>(null);
  const [highlighted, setHighlighted] = useState(false);
  const highlightTimerRef = useRef<number | null>(null);

  // When the menu-bar tray asks to reveal this schedule, scroll it into view,
  // expand it, and pulse a highlight. The store clears revealScheduleId once we
  // pick it up so re-renders (the 1Hz tick) don't re-trigger the scroll.
  // NOTE: the highlight timer lives in a ref, NOT the effect cleanup — calling
  // clearRevealSchedule() flips `reveal` back to false, which (with `[reveal]`
  // deps) would run the cleanup and cancel the timer before it fires, leaving
  // the row highlighted forever.
  useEffect(() => {
    if (!reveal) return;
    useUi.getState().clearRevealSchedule();
    setExpanded(true);
    setHighlighted(true);
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlighted(false);
      highlightTimerRef.current = null;
    }, 1600);
  }, [reveal]);

  // Clear a pending highlight timer on unmount.
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    };
  }, []);
  const terminals = useData((s) => s.terminals);
  const restoreTerminal = useData((s) => s.restoreTerminal);
  const setNav = useUi((s) => s.setNav);
  const enterProjectFocus = useUi((s) => s.enterProjectFocus);
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const pushToast = useUi((s) => s.pushToast);

  const toggle = async () => {
    const result = await window.cc.scheduler.setEnabled(task.id, !task.enabled);
    if (!result.ok) pushToast(result.message, 'error');
  };
  const runNow = async () => {
    const result = await window.cc.scheduler.runNow(task.id);
    if (!result.ok) {
      pushToast(`Run failed: ${result.message}`, 'error');
      return;
    }
    // The fire spawns a headless background session (surfaced under the
    // project's "Background" list and via the inbox); the toast confirms it
    // took effect, and "Running now" / row deep-links can promote it to a tab.
    pushToast(`Fired "${task.name}"`, 'info');
  };

  const projectTerminals = terminals[task.projectId] ?? [];
  const isSessionAlive = (sessionId: string) =>
    projectTerminals.some(
      (s) => s.id === sessionId && (s.status === 'running' || s.status === 'starting')
    );

  const runs = task.status.runs ?? [];
  const hasHistory = runs.length > 0;
  // Most-recent run that carries an agent-authored report — surfaced as a
  // one-click "see what happened" affordance on the collapsed row, so the run
  // report isn't buried behind expand + hunt-for-the-icon.
  const lastReportRun = runs.find((r) => !!r.report) ?? null;

  // The whole run is kept (not just the id) so the row can tell "working" (turn
  // in progress) from "done · session open" (agent finished — `finishedAt` set —
  // but the pty is still at the prompt). See {@link pickLiveRun} for why a
  // still-working run wins over a newer finished-open one.
  const liveRun = pickLiveRun(runs, isSessionAlive);
  const liveSessionId = liveRun?.sessionId ?? null;
  // The agent is still working only while the live run has no `finishedAt`.
  const isWorking = !!liveRun && !liveRun.finishedAt;
  // Alive but the turn ended — open at the prompt, resumable.
  const isFinishedOpen = !!liveRun && !!liveRun.finishedAt;
  const promoteAndOpen = (sessionId: string) => {
    // Scheduled fires spawn headless, so the session is filtered out of the
    // visible tab strip. restoreTerminal un-hides it (no-op if already visible)
    // AND selects it — selectTab alone would be reverted by Workspace's
    // reconciliation effect, since the headless id isn't in the visible list.
    // enterProjectFocus (not selectProject) is what actually mounts the
    // Workspace + its tab strip (gated on focusedProjectId), and the mode flip
    // lands on the terminal rather than the project's Agents board — matching
    // AgentsBoard's "open into workspace" path.
    setNav('projects');
    enterProjectFocus(task.projectId);
    void restoreTerminal(sessionId, task.projectId);
    setWorkspaceMode(task.projectId, 'terminals');
  };

  const jumpToRun = (sessionId: string | undefined) => {
    if (!sessionId) return;
    if (!isSessionAlive(sessionId)) return;
    void promoteAndOpen(sessionId);
  };

  const stopLive = async (e?: ReactMouseEvent) => {
    e?.stopPropagation();
    if (!liveSessionId) return;
    try {
      if (!await window.cc.terminals.close(liveSessionId)) {
        throw new Error('session remains live');
      }
      pushToast(`Stopped "${task.name}"`, 'info');
    } catch {
      pushToast(`Failed to stop "${task.name}"`, 'error');
    }
  };

  const openLive = (e?: ReactMouseEvent) => {
    e?.stopPropagation();
    if (!liveSessionId) return;
    // Peek the running session in the agent-inspector modal — the same
    // lightweight live-terminal peek the Agents list and board cards open. The
    // modal portals the headless session's live xterm and offers "Open in
    // workspace" as the escape hatch, so this no longer yanks the user out of
    // the scheduler view just to glance at a background run.
    useUi.getState().openAgentModal(liveSessionId, task.projectId);
  };

  const statusKind = isWorking
    ? 'running'
    : isFinishedOpen
    ? 'done'
    : task.enabled
    ? 'idle'
    : 'off';
  const statusLabel = isWorking
    ? 'running'
    : isFinishedOpen
    ? 'done'
    : task.enabled
    ? 'idle'
    : 'off';

  // Stop the row's expand-toggle from firing when the user clicks
  // an inner control. Each handler still runs normally.
  const stop = (e: ReactMouseEvent) => e.stopPropagation();

  // Right-click lifecycle menu — mirrors the inline hover/detail buttons
  // (Run now / Open / Stop / Report / Edit / Duplicate / Enable-Disable /
  // Delete) at the cursor, matching the Agents & Inbox lists. External
  // Claude /loop rows are read-only, so they never open the menu.
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number } | null>(null);
  const openRowMenu = (e: ReactMouseEvent) => {
    if (isExternal) return;
    e.preventDefault();
    e.stopPropagation();
    setRowMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <li ref={cardRef} className={`scheduler-card ${task.enabled ? '' : 'is-disabled'} ${expanded ? 'is-expanded' : ''} ${isWorking ? 'is-running' : ''} ${isFinishedOpen ? 'is-done' : ''} ${highlighted ? 'is-revealed' : ''}`}>
      <div
        className="scheduler-card-main scheduler-card-main--compact"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onContextMenu={openRowMenu}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        aria-expanded={expanded}
        title={expanded ? 'Click to collapse' : 'Click to expand'}
      >
        <span
          className={`scheduler-status-dot scheduler-status-dot--${statusKind}`}
          aria-label={statusLabel}
          title={statusLabel}
        />
        {isExternal ? (
          // No toggle for a foreign loop — the app can't enable/disable it.
          <span className="scheduler-toggle scheduler-toggle--readonly" aria-hidden title="Managed by Claude Code" />
        ) : (
          <label className="scheduler-toggle" onClick={stop} title={task.enabled ? 'Disable schedule' : 'Enable schedule'}>
            <input type="checkbox" checked={task.enabled} onChange={toggle} />
            <span aria-hidden />
          </label>
        )}
        <div className="scheduler-card-compact-body">
          <span className="scheduler-card-title">
            {task.name}
            {isExternal && (
              <span className="scheduler-claude-badge" title="A Claude Code /loop job — manage it from Claude Code">
                Claude
              </span>
            )}
            {group && (
              <span
                className="scheduler-group-chip"
                style={{
                  color: group.color ?? GROUP_FALLBACK_COLOR,
                  borderColor: group.color ?? GROUP_FALLBACK_COLOR
                }}
                title={`Group: ${group.name}`}
              >
                {(() => {
                  const Icon = groupIcon(group.icon);
                  return <Icon size={11} />;
                })()}
                {group.name}
              </span>
            )}
          </span>
          <span className="scheduler-card-compact-meta">
            {isExternal
              ? `${task.source && task.source !== 'global' ? `${projectName} · ` : ''}Claude /loop · ${task.schedule.every}`
              : `${projectName} · ${PROFILE_LABEL[task.profile]} · every ${task.schedule.every}`}
          </span>
        </div>
        <div className="scheduler-card-compact-when">
          {isExternal ? (
            <span className="scheduler-card-compact-next scheduler-card-compact-next--muted" title="Managed by Claude Code">
              {task.schedule.every}
            </span>
          ) : isWorking ? (
            <span className="scheduler-pill scheduler-pill--running" title="Agent is working — turn in progress">
              running
            </span>
          ) : isFinishedOpen ? (
            <span
              className="scheduler-pill scheduler-pill--done"
              title="Agent finished its turn — session still open at the prompt"
            >
              done
            </span>
          ) : task.enabled && nextRun ? (
            <span className="scheduler-card-compact-next" title="Next fire">
              in {formatCountdown(nextRun)}
            </span>
          ) : (
            <span className="scheduler-card-compact-next scheduler-card-compact-next--muted">paused</span>
          )}
        </div>
        <div className="scheduler-card-actions" onClick={stop}>
          {!isExternal && liveSessionId && (
            <>
              <button
                className="scheduler-icon-btn"
                onClick={openLive}
                title={isFinishedOpen ? 'Open session (finished)' : 'Open running terminal'}
                aria-label={isFinishedOpen ? 'Open session (finished)' : 'Open running terminal'}
              >
                <ExternalLink size={14} />
              </button>
              <button
                className="scheduler-icon-btn scheduler-icon-btn--danger"
                onClick={stopLive}
                title={isFinishedOpen ? 'Close session' : 'Stop running terminal'}
                aria-label={isFinishedOpen ? 'Close session' : 'Stop running terminal'}
              >
                <Square size={14} />
              </button>
            </>
          )}
          {!isExternal && !liveSessionId && (
            <button className="scheduler-icon-btn" onClick={runNow} title="Run now" aria-label="Run now">
              <Play size={14} />
            </button>
          )}
          {lastReportRun && (
            <button
              className="scheduler-icon-btn scheduler-icon-btn--report"
              onClick={(e) => {
                e.stopPropagation();
                onShowReport(lastReportRun, task.name);
              }}
              title="See what happened — view the latest run report"
              aria-label="View latest run report"
            >
              <FileText size={14} strokeWidth={1.75} />
            </button>
          )}
          <button
            className={`scheduler-icon-btn scheduler-icon-btn--chevron ${expanded ? 'is-open' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            title={expanded ? 'Hide details' : 'Show details'}
            aria-label="Toggle details"
            aria-expanded={expanded}
          >
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="scheduler-card-detail">
          {task.description && (
            <div className="scheduler-card-desc">{task.description}</div>
          )}
          <div className="scheduler-card-status">
            <span className="scheduler-status-item">
              <span className="scheduler-status-label">Last</span>
              {lastRun ? (
                <span className={`scheduler-status-value scheduler-status-value--${task.status.lastRunResult ?? 'none'}`}>
                  {formatRelative(lastRun)}
                  {task.status.lastRunResult ? ` · ${task.status.lastRunResult}` : ''}
                </span>
              ) : (
                <span className="scheduler-status-value scheduler-status-value--none">never</span>
              )}
            </span>
            <span className="scheduler-status-item">
              <span className="scheduler-status-label">Next</span>
              <span className="scheduler-status-value">
                {task.enabled && nextRun ? `in ${formatCountdown(nextRun)}` : 'paused'}
              </span>
              {task.enabled && (
                <span className="scheduler-pill scheduler-pill--app-open" title="Schedule fires only while this app is running">
                  app open
                </span>
              )}
            </span>
            <span className="scheduler-status-item">
              <span className="scheduler-status-label">Runs</span>
              <span className="scheduler-status-value">{task.status.runCount}</span>
            </span>
          </div>
          <div className="scheduler-card-detail-actions">
            {isExternal ? (
              <span className="scheduler-readonly-note" title="The Claude Code harness owns this loop">
                Read-only — manage with Claude Code (e.g. /loop, or cancel from the session that created it).
              </span>
            ) : (
              <>
                <button className="scheduler-icon-btn" onClick={onEdit} title="Edit" aria-label="Edit">
                  <Pencil size={14} />
                </button>
                <button
                  className="scheduler-icon-btn"
                  onClick={onDuplicate}
                  title="Duplicate"
                  aria-label="Duplicate"
                >
                  <Copy size={14} />
                </button>
                <button
                  className="scheduler-icon-btn scheduler-icon-btn--danger"
                  onClick={onAskDelete}
                  title="Delete"
                  aria-label="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {expanded && !isExternal && (
        <div className="scheduler-card-history">
          <div className="scheduler-card-history-header">
            <History size={12} />
            <span>Recent runs</span>
            <span className="scheduler-card-history-count">
              {hasHistory ? `${runs.length} of ${task.history?.retain ?? 10}` : 'none yet'}
            </span>
          </div>
          {hasHistory ? (
            <ul className="scheduler-run-list">
              {runs.map((run, i) => {
                const alive = run.sessionId ? isSessionAlive(run.sessionId) : false;
                const clickable = alive;
                return (
                  <li
                    key={`${run.at}-${run.sessionId ?? i}`}
                    className={`scheduler-run-row scheduler-run-row--${run.result} ${
                      clickable ? 'is-clickable' : run.sessionId ? 'is-closed' : ''
                    }`}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => jumpToRun(run.sessionId) : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              jumpToRun(run.sessionId);
                            }
                          }
                        : undefined
                    }
                    title={
                      clickable
                        ? 'Jump to terminal'
                        : run.sessionId
                        ? 'Session closed'
                        : undefined
                    }
                  >
                    <span className={`scheduler-run-dot scheduler-run-dot--${run.result}`} />
                    <span className="scheduler-run-when" title={new Date(run.at).toLocaleString()}>
                      {formatRelative(new Date(run.at))}
                    </span>
                    <span className="scheduler-run-result">{run.result}</span>
                    <span className="scheduler-run-duration">
                      {run.durationMs !== undefined ? formatDuration(run.durationMs) : '—'}
                    </span>
                    {run.message && (
                      <span className="scheduler-run-message" title={run.message}>
                        {run.message}
                      </span>
                    )}
                    {run.report && (
                      <button
                        type="button"
                        className="scheduler-run-report-btn"
                        title="View run report"
                        aria-label="View run report"
                        onClick={(e) => {
                          e.stopPropagation();
                          onShowReport(run, task.name);
                        }}
                      >
                        <FileText size={13} strokeWidth={1.75} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="scheduler-run-empty">
              No runs recorded yet. The first fire will appear here.
            </div>
          )}
        </div>
      )}
      {rowMenu && (
        <ScheduleRowMenu
          anchor={rowMenu}
          enabled={task.enabled}
          liveSessionId={liveSessionId}
          isFinishedOpen={isFinishedOpen}
          hasReport={!!lastReportRun}
          onClose={() => setRowMenu(null)}
          onRunNow={() => void runNow()}
          onOpenLive={() => openLive()}
          onStopLive={() => void stopLive()}
          onShowReport={() => lastReportRun && onShowReport(lastReportRun, task.name)}
          onToggleEnabled={() => void toggle()}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onDelete={onAskDelete}
        />
      )}
    </li>
  );
});

/**
 * Right-click lifecycle menu for a schedule row — the same actions as the row's
 * inline buttons (run / open / stop / report / edit / duplicate / enable-disable
 * / delete), surfaced at the cursor. Shares the app-wide `.tab-context-menu`
 * styling and the self-contained positioning + outside-click/Escape/scroll close
 * used by the Agents & Inbox row menus.
 */
function ScheduleRowMenu({
  anchor,
  enabled,
  liveSessionId,
  isFinishedOpen,
  hasReport,
  onClose,
  onRunNow,
  onOpenLive,
  onStopLive,
  onShowReport,
  onToggleEnabled,
  onEdit,
  onDuplicate,
  onDelete
}: {
  anchor: { x: number; y: number };
  enabled: boolean;
  liveSessionId: string | null;
  isFinishedOpen: boolean;
  hasReport: boolean;
  onClose: () => void;
  onRunNow: () => void;
  onOpenLive: () => void;
  onStopLive: () => void;
  onShowReport: () => void;
  onToggleEnabled: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const PAD = 8;
    const rect = el.getBoundingClientRect();
    let left = anchor.x;
    let top = anchor.y;
    if (left + rect.width > window.innerWidth - PAD) {
      left = Math.max(PAD, window.innerWidth - rect.width - PAD);
    }
    if (top + rect.height > window.innerHeight - PAD) {
      top = Math.max(PAD, window.innerHeight - rect.height - PAD);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [anchor]);

  return (
    <div
      ref={menuRef}
      className="tab-context-menu"
      role="menu"
      style={{ top: anchor.y, left: anchor.x }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {liveSessionId ? (
        <>
          <button role="menuitem" onClick={() => { onClose(); onOpenLive(); }}>
            <ExternalLink size={13} /> {isFinishedOpen ? 'Open session' : 'Open running terminal'}
          </button>
          <button role="menuitem" className="tab-context-danger" onClick={() => { onClose(); onStopLive(); }}>
            <Square size={13} /> {isFinishedOpen ? 'Close session' : 'Stop terminal'}
          </button>
        </>
      ) : (
        <button role="menuitem" onClick={() => { onClose(); onRunNow(); }}>
          <Play size={13} /> Run now
        </button>
      )}
      {hasReport && (
        <button role="menuitem" onClick={() => { onClose(); onShowReport(); }}>
          <FileText size={13} /> View latest report
        </button>
      )}
      <div className="tab-context-sep" />
      <button role="menuitem" onClick={() => { onClose(); onToggleEnabled(); }}>
        {enabled ? <><PowerOff size={13} /> Disable</> : <><Power size={13} /> Enable</>}
      </button>
      <button role="menuitem" onClick={() => { onClose(); onEdit(); }}>
        <Pencil size={13} /> Edit
      </button>
      <button role="menuitem" onClick={() => { onClose(); onDuplicate(); }}>
        <Copy size={13} /> Duplicate
      </button>
      <div className="tab-context-sep" />
      <button role="menuitem" className="tab-context-danger" onClick={() => { onClose(); onDelete(); }}>
        <Trash2 size={13} /> Delete
      </button>
    </div>
  );
}
