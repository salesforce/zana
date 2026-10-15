import { useEffect, useState } from 'react';
import { AlertCircle, Check, Circle, Loader2 } from 'lucide-react';
import {
  HOST_INSTALL_STAGE_LABELS,
  formatHostInstallDuration,
  resolveStageDisplay,
  type HostInstallStageEntry
} from '../lib/host-install-drawer.js';

const TICK_MS = 1000;

/**
 * Ordered bootstrap stage list shared by the install drawer and Add Machine.
 * Running stages tick `m:ss / m:ss`; a stage past its limit reads as failed.
 */
export function HostInstallStages({
  stages,
  onRetry
}: {
  stages: HostInstallStageEntry[];
  onRetry?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const anyRunning = stages.some((entry) => entry.status === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [anyRunning]);

  if (stages.length === 0) return null;
  const rows = stages.map((entry) => ({ entry, view: resolveStageDisplay(entry, now) }));
  const lastFailed = rows.map((row) => row.view.status).lastIndexOf('failed');

  return (
    <ol className="host-install-stages" data-testid="host-install-stages" aria-label="Install progress">
      {rows.map(({ entry, view }, index) => (
        <li
          key={entry.stage}
          className={`host-install-stage host-install-stage-${view.status}`}
          data-testid={`host-install-stage-${entry.stage}`}
          data-status={view.status}
        >
          <span className="host-install-stage-icon" aria-hidden="true">
            {view.status === 'running' ? <Loader2 size={14} className="thread-command-send-spin" />
              : view.status === 'passed' ? <Check size={14} />
              : view.status === 'failed' ? <AlertCircle size={14} />
              : <Circle size={14} />}
          </span>
          <span className="host-install-stage-label">{HOST_INSTALL_STAGE_LABELS[entry.stage]}</span>
          {view.status === 'running' && view.elapsedMs !== undefined ? (
            <span className="host-install-stage-time" data-testid={`host-install-stage-time-${entry.stage}`}>
              {formatHostInstallDuration(view.elapsedMs)}
              {entry.limitMs !== undefined ? ` / ${formatHostInstallDuration(entry.limitMs)}` : ''}
            </span>
          ) : null}
          {view.status === 'failed' ? (
            <span className="host-install-stage-reason" data-testid={`host-install-stage-reason-${entry.stage}`}>
              {view.reason ?? 'Failed'}
            </span>
          ) : null}
          {view.status === 'failed' && index === lastFailed && onRetry ? (
            <button type="button" className="host-install-stage-retry" data-testid="host-install-retry" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
