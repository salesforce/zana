import { WebSocket } from 'ws';
import type { PushNotificationKind } from '@zana-ai/zcc-domain';
import type { MobileDeviceStore } from './device-store.js';

export interface MobilePushEvent {
  threadId: string;
  title: string;
  body: string;
}
/**
 * A thread transition worth a push. `title`/`body` are the generic fallback text;
 * the relay replaces them with the product server's readable preview, if the
 * thread's notification level lets the push through at all.
 */
export interface PushSignal extends MobilePushEvent {
  kind: PushNotificationKind;
}
/**
 * Observe transitions only. The events carry no text; whatever readable preview
 * reaches Expo comes from the product server's sanitized, bounded verdict.
 */
export class PushTransitions {
  private states = new Map<string, { status: string; pending: boolean }>();
  observe(raw: unknown): PushSignal | null {
    if (!raw || typeof raw !== 'object') return null;
    const event = raw as { type?: string; payload?: Record<string, unknown> };
    const thread = event.payload;
    if (
      event.type !== 'threads:updated' ||
      !thread ||
      typeof thread.id !== 'string' ||
      thread.id.length > 128 ||
      typeof thread.status !== 'string'
    )
      return null;
    const previous = this.states.get(thread.id);
    const pending = thread.hasPendingInteraction === true;
    this.states.delete(thread.id);
    this.states.set(thread.id, { status: thread.status, pending });
    if (this.states.size > 500) this.states.delete(this.states.keys().next().value!);
    if (pending && !previous?.pending)
      return {
        threadId: thread.id,
        kind: 'pending-interaction',
        title: 'Zana needs you',
        body: 'A thread is waiting for your input.'
      };
    if (
      !pending &&
      previous &&
      ['running', 'working', 'starting'].includes(previous.status) &&
      ['idle', 'error', 'failed'].includes(thread.status)
    )
      return {
        threadId: thread.id,
        kind: thread.status === 'idle' ? 'turn-finished' : 'thread-error',
        title: thread.status === 'idle' ? 'Zana is ready' : 'Zana needs attention',
        body:
          thread.status === 'idle'
            ? 'A thread has finished its turn.'
            : 'Open the thread to see what happened.'
      };
    return null;
  }
}
/** What the product server decided for one signal. */
export type PushVerdict =
  | { action: 'skip' }
  | { action: 'send'; title?: string; body?: string }
  /** The gate could not be reached or understood. */
  | { action: 'unavailable' };

const VERDICT_TIMEOUT_MS = 5_000;
const VERDICT_MAX_BYTES = 16_384;
// The server already caps title/body (80/180); these only bound a misbehaving upstream.
const VERDICT_TITLE_MAX = 200;
const VERDICT_BODY_MAX = 400;

function previewText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

/**
 * Ask the product server (loopback only) whether this signal should reach the
 * phone, given the thread's notification level, and what it should say. The
 * server owns the decision, so this never throws and never trusts more than a
 * bounded `{ send, title?, body? }`.
 */
export async function fetchPushVerdict(
  upstream: URL,
  signal: Pick<PushSignal, 'threadId' | 'kind'>,
  fetcher = fetch,
  shutdown?: AbortSignal
): Promise<PushVerdict> {
  if (shutdown?.aborted) return { action: 'unavailable' };
  const url = new URL(
    `/api/v1/threads/${encodeURIComponent(signal.threadId)}/notification-verdict`,
    upstream
  );
  url.searchParams.set('kind', signal.kind);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERDICT_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: shutdown ? AbortSignal.any([controller.signal, shutdown]) : controller.signal
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return { action: 'skip' };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { action: 'unavailable' };
    }
    const reader = response.body?.getReader();
    if (!reader) return { action: 'unavailable' };
    const decoder = new TextDecoder();
    let text = '';
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > VERDICT_MAX_BYTES) {
        await reader.cancel();
        return { action: 'unavailable' };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    const verdict = JSON.parse(text) as { send?: unknown; title?: unknown; body?: unknown } | null;
    if (typeof verdict?.send !== 'boolean') return { action: 'unavailable' };
    if (!verdict.send) return { action: 'skip' };
    const title = previewText(verdict.title, VERDICT_TITLE_MAX);
    const body = previewText(verdict.body, VERDICT_BODY_MAX);
    return { action: 'send', ...(title && body ? { title, body } : {}) };
  } catch {
    return { action: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The push to deliver for a signal, or null. A failed lookup fails open only for
 * things that need the user (a question or an error); a finished turn is dropped
 * so a muted thread can never be broken by an outage.
 */
export function applyPushVerdict(signal: PushSignal, verdict: PushVerdict): MobilePushEvent | null {
  if (verdict.action === 'skip') return null;
  if (verdict.action === 'unavailable' && signal.kind === 'turn-finished') return null;
  const preview = verdict.action === 'send' && verdict.title && verdict.body ? verdict : null;
  return {
    threadId: signal.threadId,
    title: preview?.title ?? signal.title,
    body: preview?.body ?? signal.body
  };
}

export async function deliverPush(
  event: MobilePushEvent,
  store: MobileDeviceStore,
  serverUrl: string,
  fetcher = fetch,
  signal?: AbortSignal
) {
  const targets = store.pushTargets();
  if (!targets.length || signal?.aborted) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(
        targets.map((device) => ({
          to: device.pushToken,
          title: event.title,
          body: event.body,
          sound: 'default',
          channelId: 'threads',
          data: { serverUrl, path: `/threads/${encodeURIComponent(event.threadId)}` }
        }))
      )
    });
    if (!response.ok) {
      await response.body?.cancel();
      return;
    }
    // Read a bounded ticket response, and drop tokens Expo reports as revoked.
    const reader = response.body?.getReader();
    let text = '';
    let size = 0;
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 32_768) {
          await reader.cancel();
          return;
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
    }
    const tickets = (
      JSON.parse(text) as { data?: Array<{ status?: string; details?: { error?: string } }> }
    ).data;
    tickets?.forEach((ticket, index) => {
      if (ticket.details?.error === 'DeviceNotRegistered' && targets[index])
        store.setPushToken(targets[index].id, null);
    });
  } catch {
    /* Push is best-effort; the product event stream is authoritative. */
  } finally {
    clearTimeout(timer);
  }
}

/** One optional subscription per gateway, independent of the foreground WebView. */
export function createMobilePushRelay(
  upstream: URL,
  publicOrigin: string,
  store: MobileDeviceStore
) {
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const shutdown = new AbortController();
  const transitions = new PushTransitions();
  const queue: PushSignal[] = [];
  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (!stopped && queue.length) {
        const signal = queue.shift()!;
        const push = applyPushVerdict(
          signal,
          await fetchPushVerdict(upstream, signal, fetch, shutdown.signal)
        );
        if (push) await deliverPush(push, store, publicOrigin, fetch, shutdown.signal);
      }
    } finally {
      draining = false;
    }
  }
  function refresh() {
    if (stopped) return;
    if (!store.pushTargets().length) {
      clearTimeout(timer);
      socket?.close();
      socket = undefined;
      return;
    }
    if (socket) return;
    const url = new URL('/ws', upstream);
    url.protocol = 'ws:';
    const next = new WebSocket(url, {
      origin: upstream.origin,
      maxPayload: 1024 * 1024,
      handshakeTimeout: 10_000
    });
    socket = next;
    next.on('message', (data) => {
      try {
        const event = transitions.observe(JSON.parse(data.toString()));
        if (event && queue.length < 40) {
          queue.push(event);
          void drain();
        }
      } catch {
        /* malformed frames cannot interrupt the relay */
      }
    });
    next.on('error', () => next.close());
    next.on('close', () => {
      if (socket === next) socket = undefined;
      if (!stopped && store.pushTargets().length) {
        clearTimeout(timer);
        timer = setTimeout(refresh, 5000);
        timer.unref();
      }
    });
  }
  return {
    refresh,
    close() {
      stopped = true;
      shutdown.abort();
      clearTimeout(timer);
      socket?.terminate();
      queue.length = 0;
    }
  };
}
