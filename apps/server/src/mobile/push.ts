import { WebSocket } from 'ws';
import type { MobileDeviceStore } from './device-store.js';

export interface MobilePushEvent {
  threadId: string;
  title: string;
  body: string;
}
/** Observe transitions only; never send prompts, filenames or model output to Expo. */
export class PushTransitions {
  private states = new Map<string, { status: string; pending: boolean }>();
  observe(raw: unknown): MobilePushEvent | null {
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
        title: thread.status === 'idle' ? 'Zana is ready' : 'Zana needs attention',
        body:
          thread.status === 'idle'
            ? 'A thread has finished its turn.'
            : 'Open the thread to see what happened.'
      };
    return null;
  }
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
  const queue: MobilePushEvent[] = [];
  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (!stopped && queue.length)
        await deliverPush(queue.shift()!, store, publicOrigin, fetch, shutdown.signal);
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
