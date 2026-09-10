import { useEffect, useState } from 'react';
import type { ExecutionBoardProjection, InboxEntry } from '@zana-ai/zcc-domain/product';

export type ExecutionInboxBlockerState = 'actionable' | 'queued' | 'resolved' | 'unknown';

export function executionInboxBlockerState(
  entry: Pick<InboxEntry, 'blockerId'>,
  execution: ExecutionBoardProjection | undefined,
  locallyAnswered: boolean
): ExecutionInboxBlockerState {
  if (!entry.blockerId || !execution) return locallyAnswered ? 'queued' : 'unknown';
  const blocker = execution.blockers?.find((candidate) => candidate.id === entry.blockerId);
  if (!blocker) return locallyAnswered ? 'queued' : 'unknown';
  if (blocker.resolved || blocker.deliveryState === 'DELIVERED') return 'resolved';
  if (blocker.deliveryState === 'PENDING' || blocker.deliveryState === 'LEASED') return 'queued';
  return 'actionable';
}

const REFRESH_MS = 5_000;

/** Polls one exact, main-authorized execution while its Inbox answer surface is mounted. */
export function useExecutionInboxBlockerState(
  entry: Pick<InboxEntry, 'projectId' | 'executionId' | 'blockerId'>,
  locallyAnswered: boolean
): ExecutionInboxBlockerState {
  const [execution, setExecution] = useState<ExecutionBoardProjection>();

  useEffect(() => {
    if (!entry.executionId || !entry.blockerId) {
      setExecution(undefined);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const refresh = () => {
      void window.cc.executionBoard.snapshot(entry.projectId, entry.executionId!).then(
        (snapshot) => {
          if (cancelled) return;
          setExecution(snapshot?.execution);
          // The blocker is terminal once resolved — stop polling rather than
          // hammering the snapshot endpoint for the rest of the mount's life.
          if (executionInboxBlockerState(entry, snapshot?.execution, locallyAnswered) === 'resolved') {
            window.clearInterval(timer);
          }
        },
        () => { /* retain last authoritative state across transient failures */ }
      );
    };
    refresh();
    timer = window.setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [entry.projectId, entry.executionId, entry.blockerId]);

  return executionInboxBlockerState(entry, execution, locallyAnswered);
}
