import { SquareTerminal } from 'lucide-react';
import { runningProcessCount, runningProcessLabel } from '../lib/thread-running-processes.js';
import type { ThreadActivityState } from '@zana-ai/zcc-domain/thread-runtime';

/** Thread-row badge for background shells still running after the turn ended. */
export function ThreadProcessBadge({ thread }: { thread: { activity?: ThreadActivityState } }) {
  const count = runningProcessCount(thread);
  if (count === 0) return null;
  const label = runningProcessLabel(count);
  return (
    <span className="thread-process-badge" data-testid="thread-process-badge" title={label} aria-label={label}>
      <SquareTerminal size={10} aria-hidden="true" />
      {count}
    </span>
  );
}
