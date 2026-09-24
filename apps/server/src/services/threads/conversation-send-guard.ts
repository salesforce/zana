import type { ZccDatabase } from '@zana-ai/zcc-db';
import { ThreadCreateError } from '../../http/thread-create.js';

export interface ConversationSendLease {
  readonly cancelled: boolean;
  assertCurrent(): void;
  retain(): () => void;
}

type State = { blockers: number; sends: Set<{ cancelled: boolean }> };
const states = new WeakMap<ZccDatabase, Map<string, State>>();

function acquireState(db: ZccDatabase, threadId: string) {
  let threads = states.get(db);
  if (!threads) {
    threads = new Map();
    states.set(db, threads);
  }
  let state = threads.get(threadId);
  if (!state) {
    state = { blockers: 0, sends: new Set() };
    threads.set(threadId, state);
  }
  const current = state;
  return {
    state: current,
    cleanup() {
      if (current.blockers === 0 && current.sends.size === 0) threads.delete(threadId);
      if (threads.size === 0) states.delete(db);
    }
  };
}

/** Track preparation and acceptance, so a late callback cannot restart stopped work. */
export async function withConversationSend<T>(
  db: ZccDatabase, threadId: string, run: (lease: ConversationSendLease) => Promise<T>
): Promise<T> {
  const { state, cleanup } = acquireState(db, threadId);
  if (state.blockers > 0) throw new ThreadCreateError(409, 'stopping', 'Thread is stopping or being archived');
  const pending = { cancelled: false };
  state.sends.add(pending);
  let references = 0;
  const lease: ConversationSendLease = {
    get cancelled() { return pending.cancelled; },
    assertCurrent() {
      if (pending.cancelled) throw new ThreadCreateError(409, 'send_cancelled', 'Send cancelled by Stop or Archive');
    },
    retain() {
      references += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--references === 0) {
          state.sends.delete(pending);
          cleanup();
        }
      };
    }
  };
  const release = lease.retain();
  try {
    return await run(lease);
  } finally {
    release();
  }
}

/** Stop/archive block new sends until settlement and invalidate all earlier preparation. */
export async function withConversationSendCancellation<T>(
  db: ZccDatabase, threadId: string, run: () => Promise<T>
): Promise<T> {
  const { state, cleanup } = acquireState(db, threadId);
  state.blockers += 1;
  for (const send of state.sends) send.cancelled = true;
  try {
    return await run();
  } finally {
    state.blockers -= 1;
    cleanup();
  }
}
