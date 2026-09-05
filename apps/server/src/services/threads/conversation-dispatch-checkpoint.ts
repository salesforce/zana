export type ThreadSendMode = 'start' | 'auto' | 'steer' | 'queue-if-active' | 'steer-if-active';

export const NEXT_TURN_MAX_CONCURRENT = 8;

export type DispatchDecision =
  | { kind: 'allow' }
  | { kind: 'delay'; reason: string; sendAfter?: number }
  | { kind: 'reject'; reason: string };

export interface DispatchCheckpointInput {
  archived: boolean;
  queuePaused: boolean;
  pendingInteraction: boolean;
  hostOnline: boolean;
  sendAfter: number | null;
  liveActiveCount: number;
  /** This thread still has a live turn. Auto-drain waits; force flush remaps. */
  threadActive?: boolean;
  maxConcurrent?: number;
  now?: number;
}

/**
 * Single server gate before draining a next-turn row. v1 reasons are core
 * policy only — plugins do not veto.
 */
export function canDispatch(input: DispatchCheckpointInput): DispatchDecision {
  if (input.archived) {
    return { kind: 'reject', reason: 'thread-archived' };
  }
  if (input.queuePaused) {
    return { kind: 'delay', reason: 'queue-paused' };
  }
  if (input.pendingInteraction) {
    return { kind: 'delay', reason: 'pending-interaction' };
  }
  if (input.threadActive) {
    return { kind: 'delay', reason: 'thread-active' };
  }
  if (!input.hostOnline) {
    return { kind: 'delay', reason: 'host-offline' };
  }
  const now = input.now ?? Date.now();
  if (input.sendAfter != null && input.sendAfter > now) {
    return { kind: 'delay', reason: 'send-after', sendAfter: input.sendAfter };
  }
  const cap = input.maxConcurrent ?? NEXT_TURN_MAX_CONCURRENT;
  if (input.liveActiveCount >= cap) {
    return { kind: 'delay', reason: 'concurrency-cap' };
  }
  return { kind: 'allow' };
}

export function isHostRpcTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code !== 'host-unavailable') return false;
  return typeof record.message === 'string' && record.message.includes('timed out');
}

export function isHostOfflineError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: unknown; name?: unknown };
  return record.code === 'host-unavailable' || record.name === 'HostUnavailableError';
}
