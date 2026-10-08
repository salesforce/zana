import { afterEach, describe, expect, it, vi } from 'vitest';
import { product } from '../product-client.js';
import {
  CONVERSATION_READ_RETRIES,
  CONVERSATION_READ_TIMEOUT_MESSAGE,
  CONVERSATION_READ_TIMEOUT_MS,
  readConversationJson
} from '../conversation-read.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('bounded conversation reads', () => {
  it.each(['metadata', 'timeline'] as const)('retries hung %s once, then aborts and allows the next read to succeed', async (kind) => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const signal = init!.signal!;
      signals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const read = () => kind === 'metadata'
      ? product.threads.get('thread/1')
      : product.threads.timeline('thread/1', { segmentLimit: 100, afterSequence: '4', summaryOnly: 'true' });
    const pending = read();
    const rejected = expect(pending).rejects.toThrow(CONVERSATION_READ_TIMEOUT_MESSAGE);
    await vi.advanceTimersByTimeAsync(CONVERSATION_READ_TIMEOUT_MS - 1);
    expect(signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]!.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals[1]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(CONVERSATION_READ_TIMEOUT_MS * CONVERSATION_READ_RETRIES);
    await rejected;
    expect(signals[1]!.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1 + CONVERSATION_READ_RETRIES);
    expect(vi.getTimerCount()).toBe(0);
    const expectedUrl = kind === 'metadata'
      ? '/api/v1/threads/thread%2F1'
      : '/api/v1/threads/thread%2F1/timeline?segmentLimit=100&afterSequence=4&summaryOnly=true';
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([expectedUrl, expectedUrl]);

    fetchMock.mockImplementationOnce(async (_url, init) => {
      expect(init?.signal?.aborted).toBe(false);
      return Response.json({ recovered: true });
    });
    await expect(read()).resolves.toEqual({ recovered: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 503])('keeps the deadline through a stalled HTTP %s response body', async (status) => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      signal = init.signal;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"rows":'));
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        }
      }), { status });
    }));
    const rejected = expect(readConversationJson('/threads/t1/timeline')).rejects.toThrow(CONVERSATION_READ_TIMEOUT_MESSAGE);
    await vi.advanceTimersByTimeAsync(CONVERSATION_READ_TIMEOUT_MS * (1 + CONVERSATION_READ_RETRIES));
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers on the retry when only the first attempt times out', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    fetchMock.mockImplementationOnce((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    })).mockImplementationOnce(async () => Response.json({ rows: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = readConversationJson('/threads/t1/timeline');
    await vi.advanceTimersByTimeAsync(CONVERSATION_READ_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ rows: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry after the caller cancels during the first attempt', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const reason = new Error('Conversation left');
    const pending = expect(readConversationJson('/threads/t1', controller.signal)).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort(reason);
    await pending;
    await vi.advanceTimersByTimeAsync(CONVERSATION_READ_TIMEOUT_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves HTTP errors and clears their deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'unknown-thread' }, { status: 404 })));
    await expect(readConversationJson('/threads/missing')).rejects.toMatchObject({ message: 'unknown-thread', status: 404 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves network errors and clears their deadline', async () => {
    vi.useFakeTimers();
    const error = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn(async () => { throw error; }));
    await expect(readConversationJson('/threads/t1')).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['metadata', 'timeline'] as const)('cancels %s immediately when its caller leaves or retries', async (kind) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    let signal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }));
    const reason = new Error('Conversation left');
    const options = { signal: controller.signal };
    const pending = kind === 'metadata'
      ? product.threads.get('t1', options)
      : product.threads.timeline('t1', undefined, options);
    const rejected = expect(pending).rejects.toBe(reason);
    controller.abort(reason);
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a fetch or timer for an already cancelled view', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(readConversationJson('/threads/t1', controller.signal)).rejects.toBe(controller.signal.reason);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases the caller subscription after a successful response', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ thread: {} })));
    await readConversationJson('/threads/t1', controller.signal);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
