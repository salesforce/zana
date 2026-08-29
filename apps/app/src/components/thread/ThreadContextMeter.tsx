import type { CSSProperties } from 'react';
import type { ThreadContextWindowUsage } from '@zana-ai/zcc-server-contract';
import { threadContextMeterView } from './thread-context-meter.js';

export function ThreadContextMeter({
  usage
}: {
  usage: ThreadContextWindowUsage | null | undefined;
}) {
  if (!usage) return null;
  const view = threadContextMeterView(usage);
  if (!view) return null;

  return (
    <div
      className="thread-context-meter"
      style={{ '--thread-context-pct': view.usedPct } as CSSProperties}
      data-testid="thread-context-window"
    >
      <button
        type="button"
        className="thread-context-meter-trigger"
        aria-label={`${view.title}: ${view.usedLabel}`}
        title={`${view.usedLabel} · ${view.leftLabel}`}
      >
        <span className="thread-context-meter-ring" aria-hidden="true" />
        <span className="thread-context-meter-pct">{view.usedPct}%</span>
      </button>
      <div className="thread-context-meter-card" role="status">
        <div className="thread-context-meter-row">
          <span>{view.title}</span>
          <span>{view.usedLabel}</span>
        </div>
        <div className="thread-context-meter-track" aria-hidden="true">
          <div className="thread-context-meter-fill" />
        </div>
        <div className="thread-context-meter-row thread-context-meter-row-sub">
          <span>{view.tokensLabel}</span>
          <span>{view.leftLabel}</span>
        </div>
      </div>
    </div>
  );
}
