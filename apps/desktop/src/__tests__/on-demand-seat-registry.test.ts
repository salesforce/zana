import { describe, expect, it, vi } from 'vitest';
import { createDeferredSeatRegistry, type DeferredSeatHooks } from '../on-demand-seat.js';

/** #580 review round 1: failure paths of the deferred-seat registry. */
const hooks = (over: Partial<DeferredSeatHooks> = {}): DeferredSeatHooks => ({
  claim: vi.fn(async () => true), sessionOf: vi.fn(async () => undefined),
  start: vi.fn(async () => ({ ok: true as const, sessionId: 'sess' })),
  markFailed: vi.fn(async () => undefined), reopen: vi.fn(async () => true), isStuck: vi.fn(async () => true), close: vi.fn(async () => undefined), ...over
});

describe('a store error while claiming does not escape (F6)', () => {
  it('returns a refusal and raises no unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const log = vi.fn();
    const registry = createDeferredSeatRegistry({ log });
    registry.register('r', ['s'], hooks({ claim: vi.fn(async () => { throw new Error('disk full'); }) }));
    expect(await registry.spawn('r', 's')).toEqual({ ok: false, message: 'disk full' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('r/s'), expect.any(Error));
  });

  it('turns a non-error throw into a message', async () => {
    const registry = createDeferredSeatRegistry();
    registry.register('r', ['s'], hooks({ claim: vi.fn(async () => { throw 'plain'; }) }));
    expect(await registry.spawn('r', 's')).toEqual({ ok: false, message: 'plain' });
  });
});

describe('recording a failed seat is retried and reported (F7)', () => {
  it('retries once and logs with the run and seat when the store keeps failing', async () => {
    const log = vi.fn();
    const markFailed = vi.fn(async () => { throw new Error('locked'); });
    const registry = createDeferredSeatRegistry({ log });
    registry.register('r', ['s'], hooks({ start: vi.fn(async () => ({ ok: false as const, message: 'no' })), markFailed }));
    expect(await registry.spawn('r', 's')).toEqual({ ok: false, message: 'no' });
    expect(markFailed).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('r/s'), expect.any(Error));
  });

  it('succeeds quietly when the second try works', async () => {
    const log = vi.fn();
    const markFailed = vi.fn().mockRejectedValueOnce(new Error('busy')).mockResolvedValue(undefined);
    const registry = createDeferredSeatRegistry({ log });
    registry.register('r', ['s'], hooks({ start: vi.fn(async () => ({ ok: false as const, message: 'no' })), markFailed }));
    await registry.spawn('r', 's');
    expect(markFailed).toHaveBeenCalledTimes(2);
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('settle failed'), expect.anything());
  });

  it('settles a seat that was claimed earlier but has no session and nobody starting it', async () => {
    const markFailed = vi.fn(async () => undefined);
    const registry = createDeferredSeatRegistry();
    registry.register('r', ['s'], hooks({ claim: vi.fn(async () => false), markFailed }));
    expect(await registry.spawn('r', 's')).toEqual({ ok: false, message: 'the seat is not waiting to start' });
    expect(markFailed).toHaveBeenCalledWith('s');
  });
});

describe('a refusal that may pass keeps the seat waiting (A4)', () => {
  it('reopens the seat and reports it as retryable instead of failing it for good', async () => {
    const reopen = vi.fn(async () => true);
    const markFailed = vi.fn(async () => undefined);
    const registry = createDeferredSeatRegistry();
    registry.register('r', ['s'], hooks({ start: vi.fn(async () => ({ ok: false as const, message: 'provider busy', retryable: true as const })), reopen, markFailed }));
    expect(await registry.spawn('r', 's')).toEqual({ ok: false, message: 'provider busy', retryable: true });
    expect(reopen).toHaveBeenCalledWith('s');
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('logs every refusal with its run, seat and reason', async () => {
    const log = vi.fn();
    const registry = createDeferredSeatRegistry({ log });
    registry.register('r', ['s'], hooks({ start: vi.fn(async () => ({ ok: false as const, message: 'denied' })) }));
    await registry.spawn('r', 's');
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/s of r did not start: denied/));
  });
});

describe('a start for a run with no spawner is settled once (A2)', () => {
  it('asks the host to fail the seat visibly, and still refuses', async () => {
    const onOrphan = vi.fn(async () => undefined);
    const registry = createDeferredSeatRegistry({ onOrphan });
    expect(await registry.spawn('gone', 's')).toEqual({ ok: false, message: 'no seat is waiting to start for this run' });
    expect(onOrphan).toHaveBeenCalledWith('gone', 's');
  });

  it('logs when settling the orphan fails and never throws', async () => {
    const log = vi.fn();
    const registry = createDeferredSeatRegistry({ log, onOrphan: async () => { throw new Error('store down'); } });
    expect(await registry.spawn('gone', 's')).toMatchObject({ ok: false });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('gone'), expect.any(Error));
  });
});

describe('release fences a claim that was already pending (F2)', () => {
  it('starts nothing and settles the seat when the run is released during the claim', async () => {
    let resolveClaim!: (value: boolean) => void;
    const markFailed = vi.fn(async () => undefined);
    const start = vi.fn(async () => ({ ok: true as const, sessionId: 'x' }));
    const registry = createDeferredSeatRegistry();
    registry.register('r', ['s'], hooks({ claim: vi.fn(() => new Promise<boolean>((resolve) => { resolveClaim = resolve; })), start, markFailed }));
    const pending = registry.spawn('r', 's');
    registry.release('r');
    resolveClaim(true);
    expect(await pending).toEqual({ ok: false, message: 'the run ended before the seat could start' });
    expect(start).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith('s');
  });
});

describe('review round 2 (#580)', () => {
  it('N1: a run released while the seat is starting closes the new session and hands it no work', async () => {
    let finish!: (value: { ok: true; sessionId: string }) => void;
    const close = vi.fn(async () => undefined);
    const registry = createDeferredSeatRegistry();
    registry.register('r', ['s'], hooks({ start: vi.fn(() => new Promise<{ ok: true; sessionId: string }>((resolve) => { finish = resolve; })), close }));
    const pending = registry.spawn('r', 's');
    await vi.waitFor(() => expect(finish).toBeDefined());
    registry.release('r');
    finish({ ok: true, sessionId: 'late' });
    expect(await pending).toEqual({ ok: false, message: 'the run ended while the seat was starting' });
    expect(close).toHaveBeenCalledWith('late');
  });

  it('A9: a retryable refusal on a run that is no longer active finishes the seat instead of leaving it starting', async () => {
    const markFailed = vi.fn(async () => undefined);
    const registry = createDeferredSeatRegistry();
    registry.register('r', ['s'], hooks({
      start: vi.fn(async () => ({ ok: false as const, message: 'run ended', retryable: true as const })),
      reopen: vi.fn(async () => false), markFailed
    }));
    expect(await registry.spawn('r', 's')).toEqual({ ok: false, message: 'run ended' });
    expect(markFailed).toHaveBeenCalledWith('s');
  });

  it('A9: a retryable refusal on a live run reopens the seat and is reported as retryable', async () => {
    const markFailed = vi.fn(async () => undefined);
    const registry = createDeferredSeatRegistry();
    registry.register('r', ['s'], hooks({ start: vi.fn(async () => ({ ok: false as const, message: 'busy', retryable: true as const })), markFailed }));
    expect(await registry.spawn('r', 's')).toEqual({ ok: false, message: 'busy', retryable: true });
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('A13: a seat that already ended is not settled again on every dispatch', async () => {
    const markFailed = vi.fn(async () => undefined);
    const registry = createDeferredSeatRegistry();
    registry.register('r', ['s'], hooks({ claim: vi.fn(async () => false), sessionOf: vi.fn(async () => undefined), isStuck: vi.fn(async () => false), markFailed }));
    expect(await registry.spawn('r', 's')).toEqual({ ok: false, message: 'the seat is not waiting to start' });
    expect(markFailed).not.toHaveBeenCalled();
  });
});
