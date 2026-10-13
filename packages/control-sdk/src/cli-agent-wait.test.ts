import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliAgentHandle } from './cli-agents.js';
import { ProductHttpClient } from './http.js';
import type { CliAgentRecord } from './types.js';
const row = (status = 'working') => ({ id: 'agent-1', status } as CliAgentRecord);
const never = () => new Promise<never>(() => {});
afterEach(() => vi.useRealTimers());

describe('CLI wait deadline', () => {
  it.each(['fetch', 'body', 'sleep'])('bounds stalled %s and cancels HTTP work', async stage => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url, opts) => {
      signal = opts?.signal ?? undefined;
      if (stage === 'fetch') return never();
      if (stage === 'body') return { ok: true, text: never } as unknown as Response;
      return new Response(JSON.stringify({ session: row() }));
    }) as typeof fetch;
    const http = new ProductHttpClient('http://localhost', { fetchImpl, ...(stage === 'sleep' ? { sleep: never } : {}) });
    const agent = new CliAgentHandle(http, 'agent-1', row());
    const waiting = expect(agent.wait({ timeoutMs: 100 })).rejects.toMatchObject({ code: 'TIMEOUT', details: { id: 'agent-1', status: 'working' } });
    await vi.advanceTimersByTimeAsync(100);
    await waiting;
    if (stage !== 'sleep') expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each([
    ['working', 'working'], ['idle', 'idle'], ['idle', 'done'], ['idle', 'exited'],
    ['done', 'done'], ['done', 'exited'], ['exited', 'exited']
  ] as const)('retains %s completion semantics for %s', async (until, status) => {
    vi.useFakeTimers();
    const http = new ProductHttpClient('http://localhost', { fetchImpl: async () => new Response(JSON.stringify({ agent: row(status) })) });
    const agent = new CliAgentHandle(http, 'agent-1', row());
    expect(await agent.wait({ until, timeoutMs: 100 })).toEqual(row(status));
    expect(vi.getTimerCount()).toBe(0);
  });
  it('caps polling sleep to the remaining budget', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const http = new ProductHttpClient('http://localhost', {
      nowMs: () => now,
      fetchImpl: async () => { now += 80; return new Response(JSON.stringify({ session: row() })); },
      sleep: async ms => { sleeps.push(ms); now += ms; }
    });
    await expect(new CliAgentHandle(http, 'agent-1', row()).wait({ timeoutMs: 100 })).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(sleeps).toEqual([20]);
  });
  it('does not start a request with an expired budget', async () => {
    const fetchImpl = vi.fn();
    await expect(new CliAgentHandle(new ProductHttpClient('http://localhost', { fetchImpl }), 'agent-1', row()).wait({ timeoutMs: 0 })).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('preserves request failures and cleans up the timer', async () => {
    vi.useFakeTimers();
    const http = new ProductHttpClient('http://localhost', { fetchImpl: async () => new Response('missing', { status: 404 }) });
    await expect(new CliAgentHandle(http, 'agent-1', row()).wait()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
