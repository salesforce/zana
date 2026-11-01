import { RunErrorDialog } from './RunErrorDialog.js';
import { failedRunMessage } from '../../lib/schedule-run-outcome';
import React, { useState, type ReactNode } from 'react';
import { PendingWorkerRecovery } from '../PendingWorkerRecovery.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Copy,
  FileText,
  History,
  MessageSquareReply,
  MoreHorizontal,
  Play,
  Power,
  PowerOff,
  Square,
  Trash2
} from 'lucide-react';
import type { ScheduledTask, ScheduleRun } from '@zana-ai/zcc-domain/product';
import {
  SCHEDULE_REASONS,
  canManualRetry,
  runManualRetry,
  isOpenProblem,
  isProblemRun,
  isRecoveryMode,
  latestResumableRun,
  newestSuccessMs,
  runOutcome,
  runReason
} from '@zana-ai/zcc-domain/schedule-health';
import { useNavigate } from 'react-router-dom';
import { RunOutcomeBadge } from './RunOutcomeBadge.js';
import { canResumeRun, resumeScheduledRun } from './resumeScheduledRun.js';
import './schedule-runs.css';
import { product } from '../../lib/product-client.js';
import { useData, useUi } from '../../store.js';
import {
  formatCountdown,
  formatDuration,
  formatRelative,
  isSessionAlive as isSessionOpen,
  pickLiveRun
} from './schedulerUtils.js';

/** "14:30", or with the date when not today: linear backoff can wait days. */
export function retryAtLabel(dueAt: string, now = new Date()): string {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return '';
  const time = due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return due.toDateString() === now.toDateString()
    ? time
    : `${due.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

/** The policy's total attempts, unless manual retries took this chain past it. */
function policyMaxFor(task: ScheduledTask, run: ScheduleRun): number | undefined {
  const max = task.retry ? task.retry.attempts + 1 : undefined;
  return max !== undefined && (run.attempt ?? 1) <= max ? max : undefined;
}

export function ScheduleInfoPanel({
  task,
  onDuplicate,
  onAskDelete
}: {
  task: ScheduledTask | null;
  onDuplicate?: () => void;
  onAskDelete?: () => void;
}) {
  const terminals = useData((s) => s.terminals);
  const projects = useData((s) => s.projects);
  const pushToast = useUi((s) => s.pushToast);
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const [reportRun, setReportRun] = useState<ScheduleRun | null>(null);
  const [errorRun, setErrorRun] = useState<ScheduleRun | null>(null);
  const [busyRuns, setBusyRuns] = useState<ReadonlySet<string>>(new Set());

  React.useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  void tick;

  const projectTerminals = task ? terminals[task.projectId] ?? [] : [];
  const isSessionAlive = (sessionId: string) => isSessionOpen(projectTerminals, sessionId);

  const runs = task?.status.runs ?? [];
  // A later finished success closes earlier problems, also for history written before recovery existed.
  const closedBefore = newestSuccessMs(runs);
  const pending = runs.filter(run => run.launchState === 'pending');
  const liveRun = task ? pickLiveRun(runs, isSessionAlive) : null;
  const liveSessionId = liveRun?.sessionId ?? null;
  const isWorking = !!liveRun && !liveRun.finishedAt;
  const isFinishedOpen = !!liveRun && !!liveRun.finishedAt;
  const isExternal = task?.external?.kind === 'claude-loop';
  // Never for Squads or /loop rows. Read `projects` defensively: some tests mock the store with `terminals` only.
  const canResume = !!task && !isExternal && task.kind !== 'team';
  const projectMissing = !!task && Array.isArray(projects) && !projects.some((project) => project.id === task.projectId);
  const latestResumable = canResume ? latestResumableRun(runs) : undefined;
  const nextRun = task?.status.nextRunAt ? new Date(task.status.nextRunAt) : null;
  const lastRun = task?.status.lastRunAt ? new Date(task.status.lastRunAt) : null;

  if (!task) {
    return (
      <div className="schedule-info-panel" data-testid="schedule-info-panel">
        <p className="thread-detail-empty">Save this schedule to start recording runs.</p>
      </div>
    );
  }

  const toggle = async () => {
    const result = await product.scheduler.setEnabled(task.id, !task.enabled);
    if (!result.ok) pushToast(result.message, 'error');
  };
  const runNow = async () => {
    const result = await product.scheduler.runNow(task.id);
    if (!result.ok) {
      pushToast(`Run failed: ${result.message}`, 'error');
      return;
    }
    const failure = failedRunMessage(result.value);
    if (failure) {
      pushToast(`Run failed: ${failure}`, 'error');
      return;
    }
    pushToast(`Fired "${task.name}"`, 'info');
  };
  const actOnRun = async (run: ScheduleRun, action: 'retry' | 'dismiss') => {
    if (!run.id) return;
    const key = run.id;
    setBusyRuns((prev) => new Set(prev).add(key));
    try {
      const refs = [{ scheduleId: task.id, runId: run.id }];
      if (action === 'retry') {
        const result = await product.scheduler.retryRuns(refs);
        if (!result.ok) pushToast(`Run failed: ${result.message}`, 'error');
        else if (result.value[0] && !result.value[0].ok) pushToast(`Run failed: ${result.value[0].error ?? 'not started'}`, 'error');
        else pushToast(result.value[0]?.status === 'queued' ? `Queued "${task.name}" for a free slot` : `Fired "${task.name}"`, 'info');
      } else {
        const result = await product.scheduler.dismissRuns(refs);
        if (!result.ok) pushToast(`Dismiss failed: ${result.message}`, 'error');
      }
    } catch (error) {
      // A thrown IPC failure must not vanish as an unhandled rejection.
      pushToast(`${action === 'retry' ? 'Run' : 'Dismiss'} failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setBusyRuns((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };
  const stopLive = async () => {
    if (!liveSessionId) return;
    try {
      if (!await product.terminals.close(liveSessionId)) {
        throw new Error('session remains live');
      }
      pushToast(`Stopped "${task.name}"`, 'info');
    } catch {
      pushToast(`Failed to stop "${task.name}"`, 'error');
    }
  };

  const selectedReport = reportRun ?? runs.find((r) => !!r.report) ?? null;

  return (
    <div className="schedule-info-panel" data-testid="schedule-info-panel">
      {pending.length > 0 && <PendingWorkerRecovery key={task.id} kind="schedule" id={task.id} sessionIds={pending.flatMap(run => run.sessionId ? [run.sessionId] : [])} />}
      <section className="schedule-info-section">
        <h3>Status</h3>
        {isExternal ? null : (
          <div className="schedule-chips">
            {task.status.queuedAt ? (
              <span className="schedule-chip" title="Waiting for a free slot under the scheduled-run limit">Queued</span>
            ) : null}
            {task.status.pendingRetry ? (
              <span className="schedule-chip" title="An automatic retry is waiting to start">
                Retry at {retryAtLabel(task.status.pendingRetry.dueAt)}
              </span>
            ) : null}
            {!isRecoveryMode(task) ? (
              <span className="schedule-chip" title="Missed and over-the-limit runs follow this schedule's original rules. Edit the schedule to choose how missed runs are caught up.">Recovery off</span>
            ) : null}
          </div>
        )}
        <dl className="schedule-info-facts">
          <div>
            <dt>Enabled</dt>
            <dd>{task.enabled ? 'On' : 'Off'}</dd>
          </div>
          <div>
            <dt>Last run</dt>
            <dd>
              {lastRun
                ? `${formatRelative(lastRun)}${task.status.lastRunResult ? ` · ${task.status.lastRunResult}` : ''}`
                : 'never'}
            </dd>
          </div>
          <div>
            <dt>Next</dt>
            <dd>{task.enabled && nextRun ? `in ${formatCountdown(nextRun)}` : 'off'}</dd>
          </div>
          <div>
            <dt>Runs</dt>
            <dd>{task.status.runCount}</dd>
          </div>
        </dl>
        {liveSessionId ? (
          <div className="schedule-info-live">
            <span className={`scheduler-pill ${isWorking ? 'scheduler-pill--running' : 'scheduler-pill--done'}`}>
              {isWorking ? 'running' : 'done'}
            </span>
            <button
              type="button"
              className="scheduler-icon-btn scheduler-icon-btn--danger"
              title={isFinishedOpen ? 'Close session' : 'Stop running terminal'}
              aria-label={isFinishedOpen ? 'Close session' : 'Stop running terminal'}
              onClick={() => void stopLive()}
            >
              <Square size={14} />
            </button>
          </div>
        ) : null}
      </section>

      <section className="schedule-info-section">
        <h3>
          <History size={12} /> Recent runs
        </h3>
        {runs.length === 0 ? (
          <p className="scheduler-run-empty">No runs recorded yet. The first fire will appear here.</p>
        ) : (
          <ul className="scheduler-run-list">
            {runs.slice(0, Math.max(1, task.history?.retain ?? 10)).map((run, i) => {
              const reason = runReason(run);
              // The same predicate the server and Problems use (a paused schedule's
              // missed marker can't be caught up, so no Run now there).
              const retryable = !isExternal
                && canManualRetry({ manualRetry: runManualRetry(task, run), open: isOpenProblem(run, Date.now(), closedBefore) });
              const busy = !!run.id && busyRuns.has(run.id);
              return (
              <li
                key={`${run.at}-${run.sessionId ?? i}`}
                className={`scheduler-run-row scheduler-run-row--${run.result}`}
              >
                <span className={`scheduler-run-dot scheduler-run-dot--${run.result}`} />
                <span className="scheduler-run-when" title={new Date(run.at).toLocaleString()}>
                  {formatRelative(new Date(run.at))}
                </span>
                <span className="scheduler-run-result"><RunOutcomeBadge run={run} maxAttempts={policyMaxFor(task, run)} /></span>
                <span className="scheduler-run-duration">
                  {run.durationMs !== undefined ? formatDuration(run.durationMs) : '—'}
                </span>
                {run.message && run.result !== 'success' ? (
                  <button
                    type="button"
                    className="scheduler-run-report-btn"
                    title="View details"
                    aria-label="View run details"
                    onClick={() => setErrorRun(run)}
                  >
                    <MoreHorizontal size={13} strokeWidth={1.75} />
                  </button>
                ) : null}
                {run.report ? (
                  <button
                    type="button"
                    className="scheduler-run-report-btn"
                    title="View run report"
                    aria-label="View run report"
                    onClick={() => setReportRun(run)}
                  >
                    <FileText size={13} strokeWidth={1.75} />
                  </button>
                ) : null}
                {run.id && canResumeRun(task, run)
                  && !(run.sessionId && isSessionAlive(run.sessionId)) ? (
                  <button
                    type="button"
                    className="scheduler-run-report-btn"
                    title="Resume this run"
                    aria-label="Resume this run"
                    onClick={() => void resumeScheduledRun(task, run.id, navigate)}
                  >
                    <MessageSquareReply size={13} strokeWidth={1.75} />
                  </button>
                ) : null}
                {retryable ? (
                  <span className="schedule-run-actions">
                    <button
                      type="button"
                      className="settings-btn"
                      disabled={busy}
                      aria-label={`${runOutcome(run) === 'missed' ? 'Run now' : 'Retry'} ${task.name} run`}
                      onClick={() => void actOnRun(run, 'retry')}
                    >
                      {runOutcome(run) === 'missed' ? 'Run now' : 'Retry'}
                    </button>
                    <button
                      type="button"
                      className="settings-btn"
                      disabled={busy}
                      aria-label={`Dismiss ${task.name} run`}
                      onClick={() => void actOnRun(run, 'dismiss')}
                    >
                      Dismiss
                    </button>
                  </span>
                ) : null}
              </li>
              );
            })}
          </ul>
        )}
      </section>

      {errorRun?.message ? (
        <RunErrorDialog
          title={`${task.name} — run details`}
          when={new Date(errorRun.at).toLocaleString()}
          message={errorRun.message}
          onClose={() => setErrorRun(null)}
        />
      ) : null}

      {selectedReport?.report ? (
        <ScheduleRunReport run={selectedReport} taskName={task.name} />
      ) : null}

      {isExternal ? null : (
        <ScheduleInfoFooter
          enabled={task.enabled}
          pending={pending.length > 0}
          liveSessionId={liveSessionId}
          resume={canResume && runs.length > 0 ? {
            disabledReason: projectMissing
              ? 'The project for this schedule is no longer registered'
              : latestResumable ? undefined : "This run didn't record a conversation to reopen",
            title: latestResumable ? `Reopen the agent from the run ${formatRelative(new Date(latestResumable.at))} with its conversation` : undefined,
            onResume: () => void resumeScheduledRun(task, undefined, navigate)
          } : undefined}
          onRunNow={() => void runNow()}
          onToggle={() => void toggle()}
          onDuplicate={onDuplicate}
          onAskDelete={onAskDelete}
        />
      )}
    </div>
  );
}

function ScheduleRunReport({ run, taskName }: { run: ScheduleRun; taskName: string }) {
  const badge = run.reportStatus ?? run.result;
  return (
    <section className="schedule-info-section" data-testid="schedule-run-report">
      <h3>{taskName} — run report</h3>
      <div className="scheduler-report-meta">
        <span className={`scheduler-pill scheduler-pill--${badge}`}>{badge}</span>
        <span className="scheduler-report-meta-when">{new Date(run.at).toLocaleString()}</span>
        {run.durationMs !== undefined ? (
          <span className="scheduler-report-meta-dur">{formatDuration(run.durationMs)}</span>
        ) : null}
      </div>
      <div className="inbox-md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: (props) => <a {...props} target="_blank" rel="noreferrer" />
          }}
        >
          {run.report ?? ''}
        </ReactMarkdown>
      </div>
    </section>
  );
}

function ScheduleInfoFooter({
  enabled,
  pending,
  liveSessionId,
  resume,
  onRunNow,
  onToggle,
  onDuplicate,
  onAskDelete
}: {
  enabled: boolean;
  pending: boolean;
  liveSessionId: string | null;
  resume?: { disabledReason?: string; title?: string; onResume: () => void };
  onRunNow: () => void;
  onToggle: () => void;
  onDuplicate?: () => void;
  onAskDelete?: () => void;
}): ReactNode {
  return (
    <div className="schedule-info-actions">
      {liveSessionId || !resume ? null : (
        <button
          type="button"
          className="settings-btn"
          disabled={!!resume.disabledReason}
          title={resume.disabledReason ?? resume.title}
          onClick={resume.onResume}
        >
          <MessageSquareReply size={13} /> Resume latest run
        </button>
      )}
      {liveSessionId ? null : (
        <button type="button" className="settings-btn" disabled={pending} onClick={onRunNow}>
          <Play size={13} /> Run now
        </button>
      )}
      <button type="button" className="settings-btn" disabled={pending && !enabled} onClick={onToggle}>
        {enabled ? <><PowerOff size={13} /> Disable</> : <><Power size={13} /> Enable</>}
      </button>
      {onDuplicate ? (
        <button type="button" className="settings-btn" onClick={onDuplicate}>
          <Copy size={13} /> Duplicate
        </button>
      ) : null}
      {onAskDelete ? (
        <button type="button" className="settings-btn settings-btn--danger" onClick={onAskDelete}>
          <Trash2 size={13} /> Delete
        </button>
      ) : null}
    </div>
  );
}
