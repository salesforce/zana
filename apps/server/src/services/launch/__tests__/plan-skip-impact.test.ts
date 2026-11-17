import { describe, expect, it } from 'vitest';
import { planBindings } from '../plan-findings.js';
import { skipImpact, type LintUnit } from '../plan-lint.js';
import type { SlotRouteSnapshotV1 } from '../../execution/routing-policy.js';

const u = (id: string, dependencies: string[] = []): LintUnit => ({ id, dependencies });
const slots: SlotRouteSnapshotV1[] = [
  { slotId: 'orchestrator:builtin:orchestrator', personaId: 'builtin:orchestrator' },
  { slotId: 'w1', personaId: 'builtin:software-engineer', label: 'Engineer', level: 'high' }
];
const asObject = (map: Map<string, string[]>) => Object.fromEntries(map);

describe('skipImpact (REQ-10, D8)', () => {
  it('lists every later step of a chain, transitively and in plan order', () => {
    const impact = skipImpact([u('a'), u('b', ['a']), u('c', ['b']), u('d', ['c'])]);
    expect(impact.get('a')).toEqual(['b', 'c', 'd']);
    expect(impact.get('b')).toEqual(['c', 'd']);
    expect(impact.get('c')).toEqual(['d']);
  });
  it('has no entry (or an empty one) for the last step of a chain', () => {
    expect(skipImpact([u('a'), u('b', ['a'])]).get('b') ?? []).toEqual([]);
  });
  it('handles a diamond: the join is listed once', () => {
    const impact = skipImpact([u('a'), u('b', ['a']), u('c', ['a']), u('d', ['b', 'c'])]);
    expect(impact.get('a')).toEqual(['b', 'c', 'd']);
    expect(impact.get('b')).toEqual(['d']);
    expect(impact.get('c')).toEqual(['d']);
  });
  it('gives independent steps nothing to skip', () => {
    const impact = skipImpact([u('a'), u('b'), u('c')]);
    for (const id of ['a', 'b', 'c']) expect(impact.get(id) ?? []).toEqual([]);
  });
  it('lists a dependent reached through two paths once', () => {
    const impact = skipImpact([u('a'), u('b', ['a']), u('c', ['a', 'b'])]);
    expect(impact.get('a')).toEqual(['b', 'c']);
  });
  it('keeps plan order even when the plan lists a dependent before the step it runs after', () => {
    const impact = skipImpact([u('late', ['root']), u('mid', ['late']), u('root')]);
    expect(impact.get('root')).toEqual(['late', 'mid']);
  });
  it('matches the engine rule: any FAILED or SKIPPED dependency skips a pending step, whatever its failure policy', () => {
    const withPolicy = { ...u('b', ['a']), onFailure: { kind: 'retry', stepId: 'b', maxRetries: 2 } } as LintUnit;
    expect(skipImpact([u('a'), withPolicy, u('c', ['b'])]).get('a')).toEqual(['b', 'c']);
  });
  it('does not crash on a cycle or an unknown dependency', () => {
    expect(() => skipImpact([u('a', ['b']), u('b', ['a'])])).not.toThrow();
    expect(skipImpact([u('a'), u('b', ['ghost'])]).get('a') ?? []).toEqual([]);
  });
  it('lists the six dependents of the early step in the 15-step plan modelled on run 4dfef173', () => {
    const units = [u('s1'), u('s2', ['s1']), u('s3', ['s1']), u('s4', ['s1']), u('s5', ['s2']), u('s6', ['s3']), u('s7', ['s5']),
      ...['s8', 's9', 's10', 's11', 's12', 's13', 's14', 's15'].map((id) => u(id))];
    const impact = skipImpact(units);
    expect(impact.get('s1')).toEqual(['s2', 's3', 's4', 's5', 's6', 's7']);
    expect(asObject(impact)['s8'] ?? []).toEqual([]);
  });
  it('A1: failing a loop review skips the dependents of its fix unit, like the engine', () => {
    const review = { ...u('review', ['impl']), loop: { fixUnitId: 'fix' } } as LintUnit;
    const impact = skipImpact([u('impl'), review, u('fix', ['review']), u('after', ['fix']), u('later', ['after'])]);
    expect(impact.get('review')).toEqual(['fix', 'after', 'later']);
    expect(impact.get('impl')).toEqual(['review', 'fix', 'after', 'later']);
    const detached = skipImpact([u('impl'), review, u('fix'), u('after', ['fix'])]);
    expect(detached.get('review')).toEqual(['after']);
  });
  it('A2: gives no skip impact above the step cap', () => {
    const many = Array.from({ length: 201 }, (_, i) => u(`s${i}`, i ? [`s${i - 1}`] : []));
    expect(skipImpact(many).size).toBe(0);
    expect(skipImpact(many.slice(0, 200)).get('s0')).toHaveLength(199);
  });
});

describe('planBindings skipsIfFailed (REQ-9, REQ-8)', () => {
  const units = [
    { id: 'a', dependencies: [] as string[] },
    { id: 'b', dependencies: ['a'] },
    { id: 'c', dependencies: ['a', 'b'] },
    { id: 'd', dependencies: [] as string[] }
  ];
  it('fills skipsIfFailed from the dependencies, in plan order', () => {
    const [a, b] = planBindings(units, slots);
    expect(a.skipsIfFailed).toEqual(['b', 'c']);
    expect(b.skipsIfFailed).toEqual(['c']);
  });
  it('leaves the field off a step without dependents (no key at all)', () => {
    const bindings = planBindings(units, slots);
    expect(bindings[2]).toEqual({ stepId: 'c', slotId: 'w1', label: 'Engineer', personaId: 'builtin:software-engineer' });
    expect(bindings[3]).not.toHaveProperty('skipsIfFailed');
  });
  it('adds nothing for units that carry no dependencies, exactly as before', () => {
    expect(planBindings([{ id: 'x' }, { id: 'y' }], slots)).toEqual([
      { stepId: 'x', slotId: 'w1', label: 'Engineer', personaId: 'builtin:software-engineer' },
      { stepId: 'y', slotId: 'w1', label: 'Engineer', personaId: 'builtin:software-engineer' }
    ]);
  });
  it('keeps an unbound step unbound and still lists its dependents', () => {
    const [a] = planBindings([{ id: 'a', dependencies: [] as string[], routing: { version: 1 as const, requiredRole: 'nobody' } }, { id: 'b', dependencies: ['a'] }], slots);
    expect(a).toMatchObject({ stepId: 'a', unbound: true, skipsIfFailed: ['b'] });
  });
  it('A1: carries a loop plan through to the bindings', () => {
    const [review] = planBindings([{ id: 'review', dependencies: [], loop: { version: 1, until: 'PASS', max: 2, fixUnitId: 'fix' } } as never, { id: 'fix', dependencies: ['review'] }, { id: 'after', dependencies: ['fix'] }], slots);
    expect(review.skipsIfFailed).toEqual(['fix', 'after']);
  });
  it('A3: adds the failure policy only to a step that has dependents and a policy', () => {
    const [retry, failRun, none, last] = planBindings([
      { id: 'a', dependencies: [], onFailure: { kind: 'retry' } } as never, { id: 'b', dependencies: ['a'], onFailure: { kind: 'fail-run' } } as never,
      { id: 'c', dependencies: ['b'] }, { id: 'd', dependencies: ['c'], onFailure: { kind: 'retry' } } as never], slots);
    expect(retry.failurePolicy).toBe('retry');
    expect(failRun.failurePolicy).toBe('fail-run');
    expect(none).not.toHaveProperty('failurePolicy');
    expect(last).not.toHaveProperty('failurePolicy');
  });
});
