import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultFetchJson, MARKETPLACE_FETCH_TIMEOUT_MS } from './plugin-process.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('defaultFetchJson', () => {
  it('reads chunked JSON and clears the request deadline on success', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('{"plugins":'));
        controller.enqueue(Buffer.from('[]}'));
        controller.close();
      }
    })));
    vi.stubGlobal('fetch', fetch);
    await expect(defaultFetchJson('https://example.test/index.json')).resolves.toEqual({ plugins: [] });
    expect(fetch).toHaveBeenCalledWith('https://example.test/index.json', {
      redirect: 'error', signal: expect.any(AbortSignal)
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an oversized streaming body before reading it all', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    let pulls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(512 * 1024));
      },
      cancel
    }))));
    await expect(defaultFetchJson('https://example.test/index.json')).rejects.toThrow(/exceeds/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(pulls).toBeLessThanOrEqual(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([204, 205, 304])('handles a bodyless %s without leaving a deadline', async (status) => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
    await expect(defaultFetchJson('https://example.test/index.json')).rejects.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an HTTP error body and releases its deadline', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 503 })));
    await expect(defaultFetchJson('https://example.test/index.json')).rejects.toThrow('503');
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its deadline on malformed JSON and transport errors', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('not json'))
      .mockRejectedValueOnce(new Error('offline')));
    await expect(defaultFetchJson('https://example.test/index.json')).rejects.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    await expect(defaultFetchJson('https://example.test/index.json')).rejects.toThrow('offline');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['headers', 'body'])('aborts stalled %s after the deadline', async (stage) => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, { signal }: RequestInit) => {
      if (stage === 'headers') return new Promise((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
      });
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          signal!.addEventListener('abort', () => controller.error(signal!.reason), { once: true });
        }
      })));
    }));
    const result = expect(defaultFetchJson('https://example.test/index.json')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(MARKETPLACE_FETCH_TIMEOUT_MS);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses non-https marketplace URLs', async () => {
    await expect(defaultFetchJson('http://example.test/mp.json')).rejects.toThrow(/must be https/);
    await expect(defaultFetchJson('file:///tmp/mp.json')).rejects.toThrow(/must be https/);
  });
});
