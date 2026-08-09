import { describe, it, expect, vi } from 'vitest';

// goal-store imports `electron` for `app.getPath('home')` in globalDir(). The
// validator under test doesn't touch it; mocking keeps import-time happy.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cc-test-home' }
}));

import { validateGoalFile, clampRetain } from '../goal-store.js';

const baseGoal = {
  id: 'goal-1',
  projectId: 'proj-1',
  title: 'Get the suite green',
  statement: 'Make `npm test` pass.',
  successCriteria: ['npm test exits 0', '  ', 'no TS errors'],
  driver: 'native',
  assignment: { kind: 'profile', profile: 'claude-yolo' },
  cadence: { mode: 'continuous' },
  maxIterations: 8,
  iteration: 2,
  noProgressLimit: 3,
  status: 'active',
  history: {
    retain: 15,
    iterations: [
      {
        id: 'it-1',
        at: '2026-01-01T00:00:00.000Z',
        sessionId: 's-1',
        verdict: 'partial',
        rationale: 'progress',
        confidence: 0.5
      }
    ]
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

describe('validateGoalFile', () => {
  it('accepts a valid goal and round-trips fields', () => {
    const r = validateGoalFile({ ...baseGoal });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.id).toBe('goal-1');
    expect(r.title).toBe('Get the suite green');
    expect(r.driver).toBe('native');
    expect(r.status).toBe('active');
    expect(r.maxIterations).toBe(8);
    expect(r.noProgressLimit).toBe(3);
    expect(r.history.retain).toBe(15);
    expect(r.history.iterations).toHaveLength(1);
  });

  it('trims and drops blank success criteria', () => {
    const r = validateGoalFile({ ...baseGoal });
    if ('error' in r) throw new Error('unexpected error');
    expect(r.successCriteria).toEqual(['npm test exits 0', 'no TS errors']);
  });

  it.each([
    ['missing id', (g: Record<string, unknown>) => delete g.id],
    ['missing title', (g: Record<string, unknown>) => delete g.title],
    ['missing projectId', (g: Record<string, unknown>) => delete g.projectId],
    ['missing statement', (g: Record<string, unknown>) => delete g.statement]
  ])('rejects %s', (_label, mutate) => {
    const g = { ...baseGoal } as Record<string, unknown>;
    mutate(g);
    const r = validateGoalFile(g);
    expect('error' in r).toBe(true);
  });

  it('rejects a non-object', () => {
    expect('error' in validateGoalFile(null)).toBe(true);
    expect('error' in validateGoalFile('nope')).toBe(true);
  });

  it('defaults driver to native for an unknown engine', () => {
    const r = validateGoalFile({ ...baseGoal, driver: 'skynet' });
    if ('error' in r) throw new Error('unexpected error');
    expect(r.driver).toBe('native');
  });

  it('defaults status to draft for an unknown status', () => {
    const r = validateGoalFile({ ...baseGoal, status: 'vibing' });
    if ('error' in r) throw new Error('unexpected error');
    expect(r.status).toBe('draft');
  });

  it('falls back to sane defaults for missing optional pieces', () => {
    const r = validateGoalFile({
      id: 'g',
      projectId: 'p',
      title: 'T',
      statement: 'S'
    });
    if ('error' in r) throw new Error('unexpected error');
    expect(r.driver).toBe('native');
    expect(r.status).toBe('draft');
    expect(r.maxIterations).toBe(10);
    expect(r.noProgressLimit).toBe(2);
    expect(r.successCriteria).toEqual([]);
    expect(r.history.iterations).toEqual([]);
    expect(r.assignment).toEqual({ kind: 'profile', profile: 'claude-yolo' });
    expect(r.cadence).toEqual({ mode: 'continuous' });
  });

  it('caps maxIterations at 100 and floors a bad value to 10', () => {
    const hi = validateGoalFile({ ...baseGoal, maxIterations: 9999 });
    if ('error' in hi) throw new Error('unexpected error');
    expect(hi.maxIterations).toBe(100);
    const bad = validateGoalFile({ ...baseGoal, maxIterations: -3 });
    if ('error' in bad) throw new Error('unexpected error');
    expect(bad.maxIterations).toBe(10);
  });

  it('drops malformed iterations but keeps good ones', () => {
    const r = validateGoalFile({
      ...baseGoal,
      history: {
        retain: 10,
        iterations: [
          { id: 'ok', at: '2026-01-01T00:00:00.000Z' },
          { at: 'missing-id' },
          'garbage',
          null
        ]
      }
    });
    if ('error' in r) throw new Error('unexpected error');
    expect(r.history.iterations).toHaveLength(1);
    expect(r.history.iterations[0].id).toBe('ok');
  });

  it('clamps an iteration confidence into 0..1', () => {
    const r = validateGoalFile({
      ...baseGoal,
      history: {
        retain: 10,
        iterations: [
          { id: 'a', at: '2026-01-01T00:00:00.000Z', verdict: 'pass', confidence: 5 },
          { id: 'b', at: '2026-01-01T00:00:00.000Z', verdict: 'fail', confidence: -2 }
        ]
      }
    });
    if ('error' in r) throw new Error('unexpected error');
    expect(r.history.iterations[0].confidence).toBe(1);
    expect(r.history.iterations[1].confidence).toBe(0);
  });

  it('drops an unknown verdict to undefined', () => {
    const r = validateGoalFile({
      ...baseGoal,
      history: {
        retain: 10,
        iterations: [{ id: 'a', at: '2026-01-01T00:00:00.000Z', verdict: 'maybe' }]
      }
    });
    if ('error' in r) throw new Error('unexpected error');
    expect(r.history.iterations[0].verdict).toBeUndefined();
  });

  it('coerces a profile assignment with an invalid profile to claude-yolo', () => {
    const r = validateGoalFile({
      ...baseGoal,
      assignment: { kind: 'profile', profile: 'gopher' }
    });
    if ('error' in r) throw new Error('unexpected error');
    expect(r.assignment).toEqual({ kind: 'profile', profile: 'claude-yolo' });
  });

  it('preserves a persona assignment', () => {
    const r = validateGoalFile({
      ...baseGoal,
      assignment: { kind: 'persona', personaId: 'reviewer' }
    });
    if ('error' in r) throw new Error('unexpected error');
    expect(r.assignment).toEqual({ kind: 'persona', personaId: 'reviewer' });
  });

  it('reads a clocked cadence', () => {
    const r = validateGoalFile({ ...baseGoal, cadence: { every: '1h' } });
    if ('error' in r) throw new Error('unexpected error');
    expect(r.cadence).toEqual({ every: '1h' });
  });
});

describe('clampRetain', () => {
  it('defaults to 20 for non-numbers', () => {
    expect(clampRetain(undefined)).toBe(20);
    expect(clampRetain(Number.NaN)).toBe(20);
  });

  it('clamps to [1, 100] and rounds', () => {
    expect(clampRetain(0)).toBe(1);
    expect(clampRetain(-5)).toBe(1);
    expect(clampRetain(99999)).toBe(100);
    expect(clampRetain(12.7)).toBe(13);
  });
});
