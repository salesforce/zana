import { describe, expect, it } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';
import * as seatModule from '../on-demand-seat.js';
import { deferredSeatsOf, freshContextSeatsOf, recycleGuard, respawnLaunchShape, onDemandLaunchProblem } from '../on-demand-seat.js';
import { jobCoordinatorPrompt } from '../team-coordinator-prompt.js';

/** #579: the pure decisions behind a fresh session per unit. */
const seat = (slotId: string, personaId = 'p', label?: string, role: 'worker' | 'orchestrator' = 'worker') => ({ slotId, personaId, label, role });
const facts = (over: Partial<Parameters<typeof recycleGuard>[0]> = {}) => ({ deliveredUnitCount: 1, hasBlockedUnit: false, hasOpenBlockerDelivery: false, queuedInInjector: 0, ...over });

describe('REQ-1 freshContextSeatsOf', () => {
  const team = { slots: [{ freshContextPerUnit: true }, {}, { freshContextPerUnit: false }, { startOnDemand: true, freshContextPerUnit: true }] };
  it('picks worker seats whose row opted in, with every expanded seat of the row', () => {
    const seats = [seat('0:a:0'), seat('0:a:1'), seat('1:b:0'), seat('2:c:0'), seat('3:d:0'), seat('orchestrator:o', 'o', undefined, 'orchestrator')];
    expect(freshContextSeatsOf(team, seats).map((s) => s.slotId)).toEqual(['0:a:0', '0:a:1', '3:d:0']);
  });
  it('picks nothing for a team without the field, without rows, or for an unknown row', () => {
    expect(freshContextSeatsOf({ slots: [{}, { startOnDemand: true }] }, [seat('0:a:0'), seat('1:b:0')])).toEqual([]);
    expect(freshContextSeatsOf({}, [seat('0:a:0')])).toEqual([]);
    expect(freshContextSeatsOf(team, [seat('x')])).toEqual([]);
  });
  it('leaves deferredSeatsOf exactly as before (a fresh-context row is not a waiting seat by itself)', () => {
    expect(deferredSeatsOf(team, [seat('0:a:0'), seat('3:d:0')]).map((s) => s.slotId)).toEqual(['3:d:0']);
  });
});

describe('REQ-9 a Modern or non-durable launch with a fresh-context seat is refused before anything spawns', () => {
  const problem = (seatModule as Record<string, unknown>).freshContextLaunchProblem as
    | ((team: object, fresh: readonly object[], launch: { durable: boolean; structured: boolean }) => string | undefined)
    | undefined;
  const fresh = [seat('0:a:0', 'a', 'Engineer')];
  it('exports freshContextLaunchProblem, built like onDemandLaunchProblem', () => {
    expect(typeof problem).toBe('function');
  });
  it('allows no fresh seats and a supported launch', () => {
    expect(problem?.({ slots: [] }, [], { durable: false, structured: false })).toBeUndefined();
    expect(problem?.({ slots: [] }, fresh, { durable: true, structured: true })).toBeUndefined();
    expect(problem).toBeTypeOf('function');
  });
  it('refuses a Modern team naming the seat', () => {
    expect(problem?.({ transport: 'MODERN', slots: [] }, fresh, { durable: true, structured: true }))
      .toBe("Fresh session per unit isn't available for Modern squads yet; turn it off for: Engineer");
  });
  it('refuses a launch without a durable plan', () => {
    expect(problem?.({ slots: [] }, fresh, { durable: false, structured: true })).toContain('turn it off for: Engineer');
    expect(problem?.({ slots: [] }, fresh, { durable: true, structured: false })).toContain('plan-driven');
  });
  it('leaves the on-demand message alone', () => {
    expect(onDemandLaunchProblem({ transport: 'MODERN', slots: [] }, fresh, { durable: true, structured: true })).toContain("Start on demand isn't available");
  });
});

describe('REQ-3 / REQ-5 respawnLaunchShape', () => {
  it('a respawn uses the respawn approval and drops the old conversation and recovery prompt', () => {
    expect(respawnLaunchShape('respawn')).toEqual({ usesRespawnApproval: true, dropsRecovery: true });
  });
  it('a first start and a late seat keep today\'s shape', () => {
    expect(respawnLaunchShape('start')).toEqual({ usesRespawnApproval: false, dropsRecovery: false });
    expect(respawnLaunchShape('lateSeat')).toEqual({ usesRespawnApproval: false, dropsRecovery: false });
  });
});

describe('REQ-3 / REQ-4 recycleGuard', () => {
  it('recycles a seat that has finished a unit and has nothing in the way', () => {
    expect(recycleGuard(facts())).toEqual({ recycle: true });
    expect(recycleGuard(facts({ deliveredUnitCount: 7 }))).toEqual({ recycle: true });
  });
  it('never recycles the first unit', () => {
    expect(recycleGuard(facts({ deliveredUnitCount: 0 }))).toMatchObject({ recycle: false, reason: expect.stringMatching(/first/i) });
  });
  it.each([
    ['a blocked unit', { hasBlockedUnit: true }, /block/i],
    ['an open blocker delivery', { hasOpenBlockerDelivery: true }, /blocker/i],
    ['queued injector items', { queuedInInjector: 2 }, /queue/i]
  ])('delivers to the current session with %s and says why', (_n, over, reason) => {
    expect(recycleGuard(facts(over))).toMatchObject({ recycle: false, reason: expect.stringMatching(reason) });
  });
});

describe('REQ-7 / D7 the coordinator roster', () => {
  const team: Team = { id: 't', name: 'Squad', description: 'x', orchestratorPersonaId: 'lead', slots: [{ personaId: 'w', quantity: 1, freshContextPerUnit: true }], source: 'builtin' } as Team;
  const job = { objective: 'Ship' } as never;
  it('lists a fresh-context seat without a session id that a recycle makes stale', () => {
    const roster = [{ slotId: '0:w:0', label: 'Engineer', startsWhenNeeded: true, freshSessionPerUnit: true }] as never;
    const prompt = jobCoordinatorPrompt({ team, executionId: 'e', job, roster, planReady: true });
    expect(prompt).toContain('slot `0:w:0`');
    expect(prompt).not.toMatch(/session `/);
    expect(prompt).toMatch(/new session for each unit/i);
  });
  it('keeps today\'s wording for a running seat and a start-on-demand seat', () => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'e', job, planReady: true,
      roster: [{ sessionId: 's-1', slotId: '1:w:0', label: 'A' }, { slotId: '2:w:0', label: 'B', startsWhenNeeded: true }] });
    expect(prompt).toContain('session `s-1`');
    expect(prompt).toContain('The engine starts each of these seats when it assigns its first unit.');
    expect(prompt).not.toMatch(/new session for each unit/i);
  });
});

describe('OBL-001 / REQ-4 the old session is not closed inside the turn that completed the previous unit', () => {
  it('does not detach or close a session still working when the rest wait runs out', async () => {
    const { createSeatRecycler, SEAT_REST_WAIT_MS } = await import('../on-demand-seat.js');
    const calls: string[] = [];
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const recycler = createSeatRecycler({
      stateOf: () => 'working', sessionOf: async () => 'old',
      sampleUsage: async () => { calls.push('sample'); }, detach: async () => { calls.push('detach'); return true; },
      clearRecovery: async () => { calls.push('clear'); }, close: async (id: string) => { calls.push(`close:${id}`); },
      log: () => undefined, setTimer: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => undefined
    } as never);
    recycler.register('r1', ['s1'], { executionId: 'e1', respawn: async () => ({ ok: true as const, sessionId: 'new' }) });
    const done = recycler.recycle('r1', 's1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const restTimer = timers.find((t) => t.ms === SEAT_REST_WAIT_MS);
    expect(restTimer).toBeDefined();
    restTimer!.fn();
    await expect(done).resolves.toEqual({ declined: true });
    expect(calls).not.toContain('detach');
    expect(calls).not.toContain('close:old');
  });
});

describe('OBL-002 / REQ-11 a run released during the final usage sample leaves no waiter or timer', () => {
  it('registers no exit timer after release', async () => {
    const { createSeatRecycler } = await import('../on-demand-seat.js');
    const live = new Set<number>();
    let next = 0;
    let finishSample!: () => void;
    const recycler = createSeatRecycler({
      stateOf: () => 'idle', sessionOf: async () => 'old',
      sampleUsage: () => new Promise<void>((resolve) => { finishSample = resolve; }),
      detach: async () => true, clearRecovery: async () => undefined, close: async () => undefined, log: () => undefined,
      setTimer: () => { const id = ++next; live.add(id); return id; }, clearTimer: (h: unknown) => { live.delete(h as number); }
    } as never);
    recycler.register('r1', ['s1'], { executionId: 'e1', respawn: async () => ({ ok: true as const, sessionId: 'new' }) });
    const done = recycler.recycle('r1', 's1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    recycler.release('r1');
    finishSample();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(done).resolves.toEqual({ final: true });
    expect(live.size).toBe(0);
  });
});
