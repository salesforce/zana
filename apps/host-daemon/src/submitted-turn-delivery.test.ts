import { describe, expect, it, vi } from 'vitest';
import { deliverSubmittedTurn } from './submitted-turn-delivery.js';

const payload = { threadId: 't1', input: [], clientRequestId: 'r1', options: {} } as never;

function runtime(overrides: {
  active?: Array<string | null>;
  live?: boolean | boolean[];
  awaited?: string | null;
  steer?: Array<{ status: 'steered' } | { status: 'stale'; activeTurnId: string | null } | undefined>;
} = {}) {
  const active = [...(overrides.active ?? [null])];
  const live = Array.isArray(overrides.live) ? [...overrides.live] : null;
  const steer = [...(overrides.steer ?? [{ status: 'steered' as const }])];
  return {
    getActiveTurnId: vi.fn(() => (active.length > 1 ? active.shift()! : active[0]!) ?? null),
    getLiveThreadIds: vi.fn(() => ((live ? (live.length > 1 ? live.shift()! : live[0]!) : overrides.live) ? ['t1'] : [])),
    waitForActiveTurn: vi.fn(async () => overrides.awaited ?? null),
    steerTurn: vi.fn(async () => (steer.length > 1 ? steer.shift() : steer[0]) as never),
    runTurn: vi.fn(async () => undefined)
  };
}

describe('deliverSubmittedTurn', () => {
  it('steers the expected turn', async () => {
    const rt = runtime();
    await expect(deliverSubmittedTurn(rt, payload, { mode: 'steer', expectedTurnId: 'turn-1' })).resolves.toBe('steered');
    expect(rt.steerTurn).toHaveBeenCalledWith(expect.objectContaining({ expectedTurnId: 'turn-1' }));
    expect(rt.runTurn).not.toHaveBeenCalled();
  });

  it('treats a void steer result as applied', async () => {
    const rt = runtime({ active: ['turn-1'], steer: [undefined] });
    await expect(deliverSubmittedTurn(rt, payload, { mode: 'auto' })).resolves.toBe('steered');
  });

  it('starts a new turn for auto with no active turn', async () => {
    const rt = runtime();
    await expect(deliverSubmittedTurn(rt, payload, { mode: 'auto' })).resolves.toBe('started');
    expect(rt.steerTurn).not.toHaveBeenCalled();
  });

  it('starts a new turn for start mode even while a turn is active', async () => {
    const rt = runtime({ active: ['turn-1'] });
    await expect(deliverSubmittedTurn(rt, payload, { mode: 'start' })).resolves.toBe('started');
    expect(rt.steerTurn).not.toHaveBeenCalled();
  });

  it('starts a stale steer as a new turn once the thread is idle', async () => {
    const rt = runtime({ steer: [{ status: 'stale', activeTurnId: null }], live: false });
    await expect(deliverSubmittedTurn(rt, payload, { mode: 'steer', expectedTurnId: 'turn-1' })).resolves.toBe('started');
    expect(rt.runTurn).toHaveBeenCalledWith(payload);
  });

  it('retargets a stale steer at the turn that replaced it', async () => {
    const rt = runtime({
      active: ['turn-2'],
      steer: [{ status: 'stale', activeTurnId: 'turn-2' }, { status: 'steered' }]
    });
    await expect(deliverSubmittedTurn(rt, payload, { mode: 'steer', expectedTurnId: 'turn-1' })).resolves.toBe('steered');
    expect(rt.steerTurn).toHaveBeenLastCalledWith(expect.objectContaining({ expectedTurnId: 'turn-2' }));
    expect(rt.runTurn).not.toHaveBeenCalled();
  });

  it('fails visibly when the same turn stays stale', async () => {
    const rt = runtime({ active: ['turn-1'], steer: [{ status: 'stale', activeTurnId: 'turn-9' }] });
    await expect(deliverSubmittedTurn(rt, payload, { mode: 'steer', expectedTurnId: 'turn-1' }))
      .rejects.toMatchObject({ code: 'stale_turn' });
  });

  it('fails visibly when retargeting is still stale', async () => {
    const rt = runtime({ active: ['turn-2'], steer: [{ status: 'stale', activeTurnId: 'turn-3' }] });
    await expect(deliverSubmittedTurn(rt, payload, { mode: 'steer', expectedTurnId: 'turn-1' }))
      .rejects.toMatchObject({ code: 'stale_turn', message: expect.stringContaining('turn-3') });
  });

  it('waits for a starting turn before steering', async () => {
    const rt = runtime({ live: true, awaited: 'turn-1' });
    await expect(deliverSubmittedTurn(rt, payload, { mode: 'steer-if-active', activeTurnWaitMs: 10 })).resolves.toBe('steered');
    expect(rt.waitForActiveTurn).toHaveBeenCalledWith('t1', { timeoutMs: 10 });
    expect(rt.steerTurn).toHaveBeenCalledWith(expect.objectContaining({ expectedTurnId: 'turn-1' }));
  });

  it('uses a turn that appeared while the wait timed out', async () => {
    const rt = runtime({ active: [null, 'turn-1'], live: true, awaited: null });
    await expect(deliverSubmittedTurn(rt, payload, { mode: 'steer' })).resolves.toBe('steered');
  });

  it('refuses a competing turn while the thread is still starting', async () => {
    const rt = runtime({ live: true, awaited: null });
    await expect(deliverSubmittedTurn(rt, payload, { mode: 'steer' })).rejects.toMatchObject({ code: 'competing_turn' });
    expect(rt.runTurn).not.toHaveBeenCalled();
  });

  it('starts a new turn when the starting thread went idle during the wait', async () => {
    const rt = runtime({ live: [true, false], awaited: null });
    await expect(deliverSubmittedTurn(rt, payload, { mode: 'steer' })).resolves.toBe('started');
  });

  it('starts a new turn for a steer on a thread with nothing live', async () => {
    const rt = runtime({ live: false });
    await expect(deliverSubmittedTurn(rt, payload, { mode: 'steer' })).resolves.toBe('started');
    expect(rt.waitForActiveTurn).not.toHaveBeenCalled();
  });
});
