import { describe, expect, it, vi } from 'vitest';
import { coldStartCanceled, createDeferredSeatRegistry, deferredSeatsOf, lifecycleSeatId, onDemandLaunchProblem, type DeferredSeatHooks } from '../on-demand-seat.js';

const seat = (slotId: string, personaId = 'p', label?: string, role: 'worker' | 'orchestrator' = 'worker') => ({ slotId, personaId, label, role });

describe('deferredSeatsOf', () => {
  const team = { slots: [{ startOnDemand: true }, {}, { startOnDemand: false }] };
  it('picks worker seats whose row opted in, and nothing else', () => {
    const seats = [seat('0:a:0'), seat('0:a:1'), seat('1:b:0'), seat('2:c:0'), seat('orchestrator:o', 'o', undefined, 'orchestrator')];
    expect(deferredSeatsOf(team, seats).map((s) => s.slotId)).toEqual(['0:a:0', '0:a:1']);
  });
  it('treats a team without a slots list as having no on-demand rows', () => {
    expect(deferredSeatsOf({}, [seat('0:a:0')])).toEqual([]);
  });
  it('ignores a slot id without a row', () => {
    expect(deferredSeatsOf(team, [seat('x')])).toEqual([]);
  });
});

describe('onDemandLaunchProblem', () => {
  const deferred = [seat('0:a:0', 'a', 'Reviewer')];
  it('allows no deferred seats and a supported launch', () => {
    expect(onDemandLaunchProblem({ slots: [] }, [], { durable: false, structured: false })).toBeUndefined();
    expect(onDemandLaunchProblem({ slots: [] }, deferred, { durable: true, structured: true })).toBeUndefined();
  });
  it('refuses a Modern team naming the seat', () => {
    expect(onDemandLaunchProblem({ transport: 'MODERN', slots: [] }, deferred, { durable: true, structured: true }))
      .toBe("Start on demand isn't available for Modern squads yet; turn it off for: Reviewer");
  });
  it('refuses a launch without a durable plan, falling back to the persona id', () => {
    expect(onDemandLaunchProblem({ slots: [] }, [seat('0:a:0', 'a')], { durable: false, structured: true })).toContain('turn it off for: a');
    expect(onDemandLaunchProblem({ slots: [] }, deferred, { durable: true, structured: false })).toContain('plan-driven');
  });
});

describe('coldStartCanceled / lifecycleSeatId', () => {
  it('cancels a launch-time wait when the run is no longer launching, but lets a late seat outlive the launch call', () => {
    expect(coldStartCanceled({ state: 'active', outcome: { status: 'in-progress' } }, false)).toBe(false);
    expect(coldStartCanceled({ state: 'active', outcome: { status: 'completed' } }, false)).toBe(true);
    expect(coldStartCanceled({ state: 'active', outcome: { status: 'completed' } }, true)).toBe(false);
    expect(coldStartCanceled({ state: 'canceled', outcome: { status: 'completed' } }, true)).toBe(true);
    expect(coldStartCanceled(undefined, true)).toBe(true);
  });
  it('names a seat', () => { expect(lifecycleSeatId('r', 's')).toBe('deferred:r:s'); });
});

describe('createDeferredSeatRegistry', () => {
  const hooks = (over: Partial<DeferredSeatHooks> = {}): DeferredSeatHooks => ({
    claim: vi.fn(async () => true), sessionOf: vi.fn(async () => undefined),
    start: vi.fn(async () => ({ ok: true as const, sessionId: 'sess' })), markFailed: vi.fn(async () => undefined), ...over
  });

  it('registers nothing without seats and refuses to start anything', async () => {
    const registry = createDeferredSeatRegistry();
    registry.register('r', [], hooks());
    expect(registry.has('r')).toBe(false);
    expect(await registry.spawn('r', 's')).toMatchObject({ ok: false });
  });

  it('starts a seat once for concurrent callers and answers a later caller with the same session', async () => {
    const registry = createDeferredSeatRegistry();
    let claimed = false;
    const h = hooks({
      claim: vi.fn(async () => { if (claimed) return false; claimed = true; return true; }),
      sessionOf: vi.fn(async () => 'sess')
    });
    registry.register('r', ['s'], h);
    const [a, b] = await Promise.all([registry.spawn('r', 's'), registry.spawn('r', 's')]);
    expect(a).toEqual({ ok: true, sessionId: 'sess' });
    expect(b).toEqual(a);
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(await registry.spawn('r', 's')).toEqual(a);
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('reports a seat that is not waiting and has no session', async () => {
    const registry = createDeferredSeatRegistry();
    registry.register('r', ['s'], hooks({ claim: vi.fn(async () => false) }));
    expect(await registry.spawn('r', 's')).toEqual({ ok: false, message: 'the seat is not waiting to start' });
  });

  it.each([
    ['a refusal', async () => ({ ok: false as const, message: 'nope' }), 'nope'],
    ['a throw', async () => { throw new Error('boom'); }, 'boom'],
    ['a non-error throw', async () => { throw 'plain'; }, 'plain']
  ])('marks the seat failed after %s', async (_label, start, message) => {
    const registry = createDeferredSeatRegistry();
    const h = hooks({ start: start as never, markFailed: vi.fn(async () => { throw new Error('ignored'); }) });
    registry.register('r', ['s'], h);
    expect(await registry.spawn('r', 's')).toEqual({ ok: false, message });
    expect(h.markFailed).toHaveBeenCalledWith('s');
  });

  it('forgets the run on release', async () => {
    const registry = createDeferredSeatRegistry();
    const h = hooks();
    registry.register('r', ['s'], h);
    expect(registry.has('r')).toBe(true);
    registry.release('r');
    expect(registry.has('r')).toBe(false);
    expect(await registry.spawn('r', 's')).toMatchObject({ ok: false });
    expect(h.start).not.toHaveBeenCalled();
  });
});
