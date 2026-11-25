/**
 * Resume after API errors for conversation (Modern) threads (issue #649).
 *
 * The rule engine is the same {@link ApiErrorResumeService} the terminal
 * sessions use; only the adapter differs. This module turns a thread's own
 * events into the neutral `api-error-stop` the service takes, and delivers the
 * rule's message as a new turn through the normal send path.
 *
 *  - Error: the last non-retrying `provider/error` of the turn, read when the
 *    turn completes as `failed`.
 *  - Rests: a thread at rest is `idle` or `error`; anything else is working.
 *  - Yields to the human: any `client/turn/requested` we did not send moves the
 *    input marker, so a pending resume stands down. Our own send is muted.
 *  - Rate limits are left to the provider's own retry, so a rule never doubles it.
 */
import { getConversationThread } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { sendConversationTurn } from '../threads/conversation-lifecycle.js';
import { ApiErrorResumeService, openRegexSession } from './api-error-resume.js';

/** Provider error categories that mean "temporary", mapped to the shared error kinds. */
const KIND_BY_CATEGORY: Readonly<Record<string, string>> = {
  overloaded: 'overloaded',
  internal: 'server_error',
  'connection-failed': 'server_error',
  'stream-disconnected': 'server_error',
  unknown: 'unknown'
};

const MAX_TRACKED_THREADS = 500;

interface ThreadState {
  lastError: { error: string; text: string } | null;
  /** Bumped by every turn request that is not ours; the service compares it for "user typed". */
  inputMarker: number;
}

interface HubEvent {
  threadId?: unknown;
  type?: unknown;
  payload?: unknown;
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** The `{ error, text }` a stop carries, or null when this error is not one to resume. */
export function apiErrorFromProviderError(payload: unknown): { error: string; text: string } | null {
  const body = record(payload);
  if (!body || body.willRetry === true) return null;
  const category = record(body.errorInfo)?.category;
  if (typeof category !== 'string') return null;
  const error = KIND_BY_CATEGORY[category];
  if (!error) return null;
  const parts = [body.message, body.detail].filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  return { error, text: parts.join(' ') };
}

export interface ThreadApiErrorResume {
  service: ApiErrorResumeService;
  dispose(): void;
}

export function createThreadApiErrorResume(
  ctx: ProductHttpContext,
  options: { log?: (line: string) => void } = {}
): ThreadApiErrorResume {
  const log = options.log ?? ((line: string) => console.log(line));
  const states = new Map<string, ThreadState>();
  /** Threads where our own send is in flight: its turn request is not the user typing. */
  const sending = new Set<string>();

  const stateOf = (threadId: string): ThreadState => {
    let state = states.get(threadId);
    if (!state) {
      if (states.size >= MAX_TRACKED_THREADS) {
        const evicted = states.keys().next().value as string;
        service.forget(evicted); // drop its pending resume too, or it could fire after dispose
        states.delete(evicted);
      }
      state = { lastError: null, inputMarker: 0 };
      states.set(threadId, state);
    }
    return state;
  };

  const service = new ApiErrorResumeService({
    getConfig: () => ctx.config.getConfig().apiErrorResume,
    getSession: (threadId) => {
      const row = getConversationThread(ctx.db, threadId);
      if (!row || row.archivedAt !== null) return null;
      return { projectId: row.projectId, title: row.title ?? 'Thread', status: row.status, lastInputAt: stateOf(threadId).inputMarker };
    },
    getAgentState: (threadId) => {
      const status = getConversationThread(ctx.db, threadId)?.status;
      return status === 'idle' || status === 'error' ? 'idle' : 'working';
    },
    reply: (threadId, text) => {
      sending.add(threadId);
      void sendConversationTurn(ctx, threadId, [{ type: 'text', text, mentions: [] }], 'auto', undefined, { origin: 'system' })
        .catch((error) => log(`[api-error-resume] thread=${threadId.slice(0, 8)} send failed: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => sending.delete(threadId));
      return true;
    },
    // The thread already shows its error state; the inbox entry carries the news.
    markNeedsYou: () => undefined,
    pushInbox: (input) => {
      void ctx.inbox.append(input).catch((error) => log(`[api-error-resume] inbox failed: ${error instanceof Error ? error.message : String(error)}`));
    },
    openRegex: () => openRegexSession(),
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle),
    log
  });

  const onEvent = (raw: unknown): void => {
    const event = raw as HubEvent;
    if (typeof event?.threadId !== 'string') return;
    // A host-reported row can be filed under a legacy name (`turn.failed` for a provider error);
    // the payload's own type is the canonical one.
    const type = record(event.payload)?.type ?? event.type;
    if (typeof type !== 'string') return;
    const threadId = event.threadId;
    switch (type) {
      case 'provider/error': {
        // An error the provider is still retrying changes nothing; any final error replaces the last one,
        // so a terminal error (auth, billing) after a temporary one is not resumed as the temporary one.
        if (record(event.payload)?.willRetry === true) return;
        stateOf(threadId).lastError = apiErrorFromProviderError(event.payload);
        return;
      }
      case 'client/turn/requested':
        if (!sending.has(threadId)) stateOf(threadId).inputMarker += 1;
        return;
      case 'turn/started':
        stateOf(threadId).lastError = null;
        service.cancel(threadId);
        return;
      case 'system/thread/interrupted':
        stateOf(threadId).lastError = null;
        service.cancel(threadId);
        return;
      case 'turn/completed': {
        const body = record(event.payload);
        if (body?.status !== 'failed' || record(body.scope)?.kind === 'tool') return;
        const state = states.get(threadId);
        const failure = state?.lastError;
        if (!state || !failure) return;
        state.lastError = null;
        void service.onApiErrorStop(threadId, failure).catch((error) => log(`[api-error-resume] thread=${threadId.slice(0, 8)} ${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      default:
    }
  };

  const unsubscribe = ctx.hub.subscribe('threads:event', onEvent);
  return {
    service,
    dispose() {
      unsubscribe();
      for (const threadId of states.keys()) service.forget(threadId);
      states.clear();
      sending.clear();
    }
  };
}

const running = new WeakMap<ProductHttpContext, ThreadApiErrorResume>();

/** Start the resume watcher once per product context, whichever entry point built it. */
export function startThreadApiErrorResume(ctx: ProductHttpContext): void {
  if (!running.has(ctx)) running.set(ctx, createThreadApiErrorResume(ctx));
}

export function disposeThreadApiErrorResume(ctx: ProductHttpContext): void {
  running.get(ctx)?.dispose();
  running.delete(ctx);
}
