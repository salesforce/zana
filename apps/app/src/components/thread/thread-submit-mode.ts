import type { ThreadRuntimeDisplayStatus } from '@zana-ai/zcc-domain/thread-runtime';
import { isRunningThreadRuntimeDisplayStatus } from './thread-timeline-model.js';

export type ThreadSubmitBlockedReason =
  | 'pending-interaction'
  | 'stopping'
  | 'unavailable';

export type ThreadSubmitMode =
  | { kind: 'ready' }
  | { kind: 'queue' }
  | { kind: 'stop-only' }
  | { kind: 'blocked'; reason: ThreadSubmitBlockedReason };

export function resolveThreadSubmitMode(args: {
  displayStatus: string;
  waitingOnUser: boolean;
}): ThreadSubmitMode {
  if (args.waitingOnUser) return { kind: 'blocked', reason: 'pending-interaction' };
  if (args.displayStatus === 'stopping') return { kind: 'blocked', reason: 'stopping' };
  if (args.displayStatus === 'waiting-for-host') return { kind: 'stop-only' };
  if (isRunningThreadRuntimeDisplayStatus(args.displayStatus as ThreadRuntimeDisplayStatus | string)
    && args.displayStatus !== 'starting') {
    return { kind: 'queue' };
  }
  if (args.displayStatus === 'starting' || args.displayStatus === 'provisioning') {
    return { kind: 'stop-only' };
  }
  if (args.displayStatus === 'error' || args.displayStatus === 'idle' || !args.displayStatus) {
    return { kind: 'ready' };
  }
  return { kind: 'blocked', reason: 'unavailable' };
}
