import React, { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Copy,
  ExternalLink,
  FileText,
  History,
  Play,
  Power,
  PowerOff,
  Square,
  Trash2
} from 'lucide-react';
import type { ScheduledTask, ScheduleRun } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { useData, useUi } from '../../store.js';
import {
  formatCountdown,
  formatDuration,
  formatRelative,
  pickLiveRun
} from './schedulerUtils.js';
import { openScheduledLive, openScheduledLiveInSplit } from './openScheduledLive.js';

export function ScheduleInfoPanel({
  task,
  onDuplicate,
  onAskDelete,
  navigate,
  currentPathname
}: {
  task: ScheduledTask | null;
  onDuplicate?: () => void;
  onAskDelete?: () => void;
  navigate: (route: string, options?: { replace?: boolean }) => void;
  currentPathname: string;
}) {
  const terminals = useData((s) => s.terminals);
  const pushToast = useUi((s) => s.pushToast);
  const [tick, setTick] = useState(0);
  const [reportRun, setReportRun] = useState<ScheduleRun | null>(null);

  React.useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  void tick;

  const projectTerminals = task ? terminals[task.projectId] ?? [] : [];
  const isSessionAlive = (sessionId: string) =>
    projectTerminals.some(
      (s) => s.id === sessionId && (s.status === 'running' || s.status === 'starting')
    );

  const runs = task?.status.runs ?? [];
  const liveRun = task ? pickLiveRun(runs, isSessionAlive) : null;
  const liveSessionId = liveRun?.sessionId ?? null;
  const isWorking = !!liveRun && !liveRun.finishedAt;
  const isFinishedOpen = !!liveRun && !!liveRun.finishedAt;
  const isExternal = task?.external?.kind === 'claude-loop';
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
    pushToast(`Fired "${task.name}"`, 'info');
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
      <section className="schedule-info-section">
        <h3>Status</h3>
        <dl className="schedule-info-facts">
          <div>
            <dt>Enabled</dt>
            <dd>{task.enabled ? 'On' : 'Paused'}</dd>
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
            <dd>{task.enabled && nextRun ? `in ${formatCountdown(nextRun)}` : 'paused'}</dd>
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
              className="scheduler-icon-btn"
              title={isFinishedOpen ? 'Peek session' : 'Peek running terminal'}
              aria-label={isFinishedOpen ? 'Peek session' : 'Peek running terminal'}
              onClick={() => openScheduledLive(task.projectId, liveSessionId)}
            >
              <ExternalLink size={14} />
            </button>
            <button
              type="button"
              className="settings-btn"
              onClick={() =>
                openScheduledLiveInSplit(task.projectId, liveSessionId, navigate, currentPathname)
              }
            >
              Open live in split
            </button>
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
            {runs.map((run, i) => (
              <li
                key={`${run.at}-${run.sessionId ?? i}`}
                className={`scheduler-run-row scheduler-run-row--${run.result}`}
              >
                <span className={`scheduler-run-dot scheduler-run-dot--${run.result}`} />
                <span className="scheduler-run-when" title={new Date(run.at).toLocaleString()}>
                  {formatRelative(new Date(run.at))}
                </span>
                <span className="scheduler-run-result">{run.result}</span>
                <span className="scheduler-run-duration">
                  {run.durationMs !== undefined ? formatDuration(run.durationMs) : '—'}
                </span>
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
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedReport?.report ? (
        <ScheduleRunReport run={selectedReport} taskName={task.name} />
      ) : null}

      {isExternal ? null : (
        <ScheduleInfoFooter
          enabled={task.enabled}
          liveSessionId={liveSessionId}
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
  liveSessionId,
  onRunNow,
  onToggle,
  onDuplicate,
  onAskDelete
}: {
  enabled: boolean;
  liveSessionId: string | null;
  onRunNow: () => void;
  onToggle: () => void;
  onDuplicate?: () => void;
  onAskDelete?: () => void;
}): ReactNode {
  return (
    <div className="schedule-info-actions">
      {liveSessionId ? null : (
        <button type="button" className="settings-btn" onClick={onRunNow}>
          <Play size={13} /> Run now
        </button>
      )}
      <button type="button" className="settings-btn" onClick={onToggle}>
        {enabled ? <><PowerOff size={13} /> Pause</> : <><Power size={13} /> Resume</>}
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
