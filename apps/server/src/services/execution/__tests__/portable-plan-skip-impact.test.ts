import { describe, expect, it } from 'vitest';
import { planCriticalPathWidth, planReachability, planSkippedIfFails } from '../portable-plan.js';

// The 4dfef173-shaped graph: two roots feed surface-sync-error, a chain hangs off it, verify-all waits for everything.
const chain = ['surface-sync-error', 'unify-classification', 'sync-diagnostics', 'diagnose-live-stall', 'sync-runbook'];
const graph = [
  { id: 'conflict-review-ui' },
  { id: 'ui-rename' },
  { id: 'surface-sync-error', dependencies: ['conflict-review-ui', 'ui-rename'] },
  { id: 'unify-classification', dependencies: ['surface-sync-error'] },
  { id: 'sync-diagnostics', dependencies: ['unify-classification'] },
  { id: 'diagnose-live-stall', dependencies: ['sync-diagnostics'] },
  { id: 'sync-runbook', dependencies: ['diagnose-live-stall'] },
  { id: 'verify-all', dependencies: ['conflict-review-ui', 'ui-rename', ...chain] }
];

describe('planSkippedIfFails', () => {
  it('lists the 6 downstream units of conflict-review-ui, in plan order', () => {
    const skipped = planSkippedIfFails(graph);
    expect(skipped.get('conflict-review-ui')).toEqual([...chain, 'verify-all']);
    expect(skipped.get('conflict-review-ui')).toHaveLength(6);
    expect(skipped.get('ui-rename')).toHaveLength(6);
  });

  it('shrinks along the chain and leaves the last unit with nothing', () => {
    const skipped = planSkippedIfFails(graph);
    expect(skipped.get('unify-classification')).toEqual(['sync-diagnostics', 'diagnose-live-stall', 'sync-runbook', 'verify-all']);
    expect(skipped.get('sync-runbook')).toEqual(['verify-all']);
    expect(skipped.get('verify-all')).toEqual([]);
  });

  it('counts a transitive dependent once even when reached by several paths', () => {
    const diamond = [{ id: 'a' }, { id: 'b', dependencies: ['a'] }, { id: 'c', dependencies: ['a'] }, { id: 'd', dependencies: ['b', 'c'] }];
    expect(planSkippedIfFails(diamond).get('a')).toEqual(['b', 'c', 'd']);
  });

  it('ignores unknown dependencies and returns empty lists for cyclic or duplicate-id plans', () => {
    expect(planSkippedIfFails([{ id: 'a', dependencies: ['zzz'] }]).get('a')).toEqual([]);
    expect(planSkippedIfFails([{ id: 'a', dependencies: ['b'] }, { id: 'b', dependencies: ['a'] }]).get('a')).toEqual([]);
    expect(planSkippedIfFails([{ id: 'a' }, { id: 'a' }]).get('a')).toEqual([]);
    expect(planSkippedIfFails([]).size).toBe(0);
  });
});

describe('planReachability', () => {
  it('is undefined for empty, duplicate and cyclic plans and shared with the width computation', () => {
    expect(planReachability([])).toBeUndefined();
    expect(planReachability([{ id: 'a' }, { id: 'a' }])).toBeUndefined();
    expect(planReachability([{ id: 'a', dependencies: ['a'] }])).toBeUndefined();
    expect(planReachability(graph)?.reach[7].size).toBe(7);
    expect(planCriticalPathWidth(graph)).toBe(2);
  });
});
