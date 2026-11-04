import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPtySessionInstructionsResolver,
  productRoutePtySessionInstructions
} from './pty-session-instructions.js';

const request = { sessionId: 's1', projectId: 'p1', profile: 'claude' };

afterEach(() => vi.useRealTimers());

describe('createPtySessionInstructionsResolver', () => {
  it('returns the trimmed instructions from the supervised channel', async () => {
    const supervised = vi.fn(async () => ({ instructions: '  be kind \n' }));
    const resolve = createPtySessionInstructionsResolver({ supervised: () => supervised, productRoute: () => null, log: vi.fn() });
    await expect(resolve(request)).resolves.toBe('be kind');
    expect(supervised).toHaveBeenCalledWith(request);
  });

  it('falls back to the product route when no supervisor runs', async () => {
    const route = vi.fn(async () => ({ instructions: 'x' }));
    const resolve = createPtySessionInstructionsResolver({ supervised: () => null, productRoute: () => route, log: vi.fn() });
    await expect(resolve(request)).resolves.toBe('x');
  });

  it('answers empty when no channel exists', async () => {
    const resolve = createPtySessionInstructionsResolver({ supervised: () => null, productRoute: () => null, log: vi.fn() });
    await expect(resolve(request)).resolves.toBe('');
  });

  it('logs and answers empty on a transport error', async () => {
    const log = vi.fn();
    const resolve = createPtySessionInstructionsResolver({ supervised: () => async () => { throw new Error('boom'); }, productRoute: () => null, log });
    await expect(resolve(request)).resolves.toBe('');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('logs and answers empty on an invalid reply', async () => {
    const log = vi.fn();
    const resolve = createPtySessionInstructionsResolver({ supervised: () => async () => ({ nope: 1 }), productRoute: () => null, log });
    await expect(resolve(request)).resolves.toBe('');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('invalid reply'));
  });

  it('gives up after the timeout so a stuck plugin host cannot hold a launch', async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const resolve = createPtySessionInstructionsResolver({ supervised: () => () => new Promise(() => undefined), productRoute: () => null, log, timeoutMs: 50 });
    const pending = resolve(request);
    await vi.advanceTimersByTimeAsync(60);
    await expect(pending).resolves.toBe('');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  });
});

describe('productRoutePtySessionInstructions', () => {
  const deps = (fetchImpl: typeof fetch) => ({
    serverUrl: () => 'http://127.0.0.1:1',
    credential: () => 'secret',
    fetch: fetchImpl
  }) as never;

  it('posts the signed request and returns the body', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ instructions: 'hi' }), { status: 200 })) as unknown as typeof fetch;
    await expect(productRoutePtySessionInstructions(deps(fetchImpl))(request)).resolves.toEqual({ instructions: 'hi' });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain('/api/v1/pty-session-instructions');
    expect(init.method).toBe('POST');
  });

  it('rejects on a non-ok status', async () => {
    const fetchImpl = vi.fn(async () => new Response('no', { status: 403 })) as unknown as typeof fetch;
    await expect(productRoutePtySessionInstructions(deps(fetchImpl))(request)).rejects.toThrow('HTTP 403');
  });
});
