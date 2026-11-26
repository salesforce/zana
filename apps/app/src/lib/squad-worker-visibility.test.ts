import { describe, expect, it } from 'vitest';
import type { ExecutionBoardProjection } from '@zana-ai/zcc-domain/product';
import { formatAge, squadWorkerVisibility, squadWorkerVisibilityText, STALE_HEARTBEAT_MS } from './squad-worker-visibility.js';

const MIN = 60_000;
type Assignment = NonNullable<ExecutionBoardProjection['work']>['assignments'][number];

function execution(over: Partial<ExecutionBoardProjection> = {}, assignments: Partial<Assignment>[] = []): ExecutionBoardProjection {
  return {
    executionId: 'e1', projectId: 'p1', jobTitle: 'Job title', state: 'RUNNING', attempt: 1, createdAt: 0, updatedAt: 0,
    work: { total: 1, completed: 0, counts: {} as never, rosterSlotIds: [], assignments: assignments.map((a) => ({ workUnitId: 'u', title: 'U', dependencies: [], state: 'CLAIMED', ...a }) as Assignment) },
    ...over
  } as ExecutionBoardProjection;
}

describe('formatAge', () => {
  it.each([[0, '0s'], [-5, '0s'], [45_000, '45s'], [59_600, '1m'], [7 * MIN, '7m'], [90 * MIN, '2h']])('%s -> %s', (ms, text) => {
    expect(formatAge(ms)).toBe(text);
  });
});

describe('squadWorkerVisibility', () => {
  it('is undefined without an execution or a slot', () => {
    expect(squadWorkerVisibility(undefined, 's', 0)).toBeUndefined();
    expect(squadWorkerVisibility(execution(), undefined, 0)).toBeUndefined();
  });

  it('names the Squad and owner thread, preferring the team name', () => {
    const info = squadWorkerVisibility(execution({ teamName: ' Review Squad ', startedFrom: { kind: 'thread', id: 't', title: ' Fix auth ' } }), 'w1', 0)!;
    expect(info).toEqual({ squad: 'Review Squad', owner: 'Fix auth', stale: false });
    expect(squadWorkerVisibility(execution(), 'w1', 0)!.squad).toBe('Job title');
    expect(squadWorkerVisibility(execution({ startedFrom: { kind: 'pty', id: 'x' } }), 'w1', 0)).not.toHaveProperty('owner');
  });

  it('derives last activity, heartbeat age and turns from the slot claim', () => {
    const exec = execution({}, [{ slotId: 'w1', claimedAt: 1_000, heartbeatAt: 5_000, progressAt: 3_000, turnCount: 4 }]);
    const info = squadWorkerVisibility(exec, 'w1', 3_000 + 2 * MIN)!;
    expect(info).toMatchObject({ lastActivityAt: 5_000, heartbeatAgeMs: 2 * MIN, turnCount: 4, stale: false });
  });

  it('falls back to the claim time and zero turns', () => {
    const info = squadWorkerVisibility(execution({}, [{ slotId: 'w1', claimedAt: 1_000 }]), 'w1', 1_000 + MIN)!;
    expect(info).toMatchObject({ lastActivityAt: 1_000, heartbeatAgeMs: MIN, turnCount: 0 });
  });

  it('flags a stale heartbeat at the threshold, which the caller may shorten', () => {
    const exec = execution({}, [{ slotId: 'w1', claimedAt: 0, progressAt: 0 }]);
    expect(squadWorkerVisibility(exec, 'w1', STALE_HEARTBEAT_MS - 1)!.stale).toBe(false);
    expect(squadWorkerVisibility(exec, 'w1', STALE_HEARTBEAT_MS)!.stale).toBe(true);
    expect(squadWorkerVisibility(exec, 'w1', 1_000, 1_000)!.stale).toBe(true);
  });

  it('shows only the Squad for a seat with no claim or a claim without timestamps', () => {
    expect(squadWorkerVisibility(execution({}, [{ slotId: 'w1', state: 'COMPLETED' }]), 'w1', 0)).toEqual({ squad: 'Job title', stale: false });
    expect(squadWorkerVisibility(execution({}, [{ slotId: 'w2' }]), 'w1', 0)).toEqual({ squad: 'Job title', stale: false });
    const bare = squadWorkerVisibility(execution({}, [{ slotId: 'w1' }]), 'w1', 0)!;
    expect(bare).toMatchObject({ turnCount: 0, stale: false });
    expect(bare.lastActivityAt).toBeUndefined();
    expect(bare.heartbeatAgeMs).toBeUndefined();
  });

  it('two Squads show their own owner', () => {
    const a = squadWorkerVisibility(execution({ startedFrom: { kind: 'thread', id: 'a', title: 'Thread A' } }), 'w1', 0)!;
    const b = squadWorkerVisibility(execution({ executionId: 'e2', startedFrom: { kind: 'thread', id: 'b', title: 'Thread B' } }), 'w1', 0)!;
    expect([a.owner, b.owner]).toEqual(['Thread A', 'Thread B']);
  });
});

describe('squadWorkerVisibilityText', () => {
  it('joins every field with singular and plural turns and the stale marker', () => {
    expect(squadWorkerVisibilityText({ squad: 'S', owner: 'T', lastActivityAt: 0, heartbeatAgeMs: 7 * MIN, turnCount: 1, stale: true }, 2 * MIN))
      .toBe('S · owner T · active 2m ago · heartbeat 7m (stale) · 1 turn');
    expect(squadWorkerVisibilityText({ squad: 'S', heartbeatAgeMs: MIN, turnCount: 3, stale: false }, 0)).toBe('S · heartbeat 1m · 3 turns');
    expect(squadWorkerVisibilityText({ squad: 'S', stale: false }, 0)).toBe('S');
  });
});

describe('squadWorkerVisibilityText without the squad name', () => {
  it('drops the squad name for rows grouped under their Squad card', () => {
    const text = squadWorkerVisibilityText({ squad: 'S', lastActivityAt: 0, heartbeatAgeMs: 7 * 60_000, turnCount: 3, stale: true }, 2 * 60_000, { includeSquad: false });
    expect(text).toBe('active 2m ago · heartbeat 7m (stale) · 3 turns');
  });

  it('is empty for a seat with no claim and no owner, and keeps the owner when there is one', () => {
    expect(squadWorkerVisibilityText({ squad: 'S', stale: false }, 0, { includeSquad: false })).toBe('');
    expect(squadWorkerVisibilityText({ squad: 'S', owner: 'Thread', stale: false }, 0, { includeSquad: false })).toBe('owner Thread');
  });

  it('drops the owner from grouped rows, which show it once on the Squad card', () => {
    expect(squadWorkerVisibilityText({ squad: 'S', owner: 'Thread', lastActivityAt: 0, stale: false }, 2 * MIN, { includeSquad: false, includeOwner: false }))
      .toBe('active 2m ago');
    expect(squadWorkerVisibilityText({ squad: 'S', owner: 'Thread', stale: false }, 0, { includeSquad: false, includeOwner: false })).toBe('');
  });
});
