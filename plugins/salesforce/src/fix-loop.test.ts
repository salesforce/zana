import { describe, expect, it } from 'vitest';
import { FIX_LOOP_LIMITS, FixLoops } from '../lib/fix-loop.js';

function loops() {
  let time = 1000;
  let n = 0;
  const clock = { advance: (ms: number) => { time += ms; } };
  return { clock, loops: new FixLoops({ now: () => time, id: () => `loop-${++n}` }) };
}
const input = { projectId: 'p1', agentPath: 'Bot.agent', suitePath: 'tests/Bot.scenario.json', caseIds: ['a', 'b', 'a', ''] };

describe('FixLoops', () => {
  it('starts a bounded loop and spends attempts until the cases pass', () => {
    const { loops: l } = loops();
    const loop = l.start(input);
    expect(loop).toMatchObject({ id: 'loop-1', caseIds: ['a', 'b'], budget: FIX_LOOP_LIMITS.budget, status: 'running', attempts: [] });
    expect(l.claim('p1', 'loop-1', 'Bot.agent')).toBe(loop);
    expect(l.record('p1', 'loop-1', { a: 'pass', b: 'fail' })).toMatchObject({ status: 'running', attempts: [{ n: 1, pass: 1, total: 2, failing: ['b'] }] });
    expect(l.record('p1', 'loop-1', { a: 'pass', b: 'pass' })).toMatchObject({ status: 'passed' });
    // A finished loop records nothing more and refuses another run.
    expect(l.record('p1', 'loop-1', { a: 'fail' })!.attempts).toHaveLength(2);
    expect(() => l.claim('p1', 'loop-1', 'Bot.agent')).toThrow(expect.objectContaining({ code: 'loop_passed' }));
    expect(l.record('p1', 'missing', {})).toBeNull();
  });

  it('clamps the budget and exhausts it', () => {
    const { loops: l } = loops();
    expect(l.start({ ...input, budget: 99 }).budget).toBe(FIX_LOOP_LIMITS.maxBudget);
    const loop = l.start({ ...input, budget: 0.4 });
    expect(loop.budget).toBe(1);
    expect(l.record('p1', loop.id, { a: 'fail', b: 'pass' })).toMatchObject({ status: 'exhausted' });
    expect(() => l.claim('p1', loop.id, 'Bot.agent')).toThrow(/is exhausted/);
    expect(() => l.start({ ...input, caseIds: [] })).toThrow('Pick at least one failing case.');
  });

  it('refuses another project, another file, a used budget and unknown loops', () => {
    const { loops: l } = loops();
    const loop = l.start({ ...input, budget: 1 });
    expect(l.get('p2', loop.id)).toBeNull();
    expect(() => l.claim('p2', loop.id, 'Bot.agent')).toThrow(expect.objectContaining({ code: 'not_found' }));
    expect(() => l.claim('p1', loop.id, 'Other.agent')).toThrow(expect.objectContaining({ code: 'path_refused' }));
    loop.attempts.push({ n: 1, pass: 0, total: 2, at: 1, failing: ['a', 'b'] });
    expect(() => l.claim('p1', loop.id, 'Bot.agent')).toThrow(expect.objectContaining({ code: 'loop_exhausted' }));
  });

  it('stops the running loop on the same file when a new one starts, and on request', () => {
    const { loops: l } = loops();
    const first = l.start(input);
    const other = l.start({ ...input, agentPath: 'Other.agent' });
    const second = l.start(input);
    expect(first.status).toBe('stopped');
    expect(other.status).toBe('running');
    expect(l.latest('p1', 'Bot.agent')).toBe(second);
    expect(l.latest('p1', 'None.agent')).toBeNull();
    expect(l.stop('p1', second.id)).toMatchObject({ status: 'stopped' });
    expect(l.stop('p1', first.id)).toMatchObject({ status: 'stopped' });
    expect(l.stop('p1', 'nope')).toBeNull();
  });

  it('lapses idle loops and keeps a bounded number', () => {
    const { loops: l, clock } = loops();
    const idle = l.start(input);
    clock.advance(FIX_LOOP_LIMITS.idleMs);
    expect(l.get('p1', idle.id)).toMatchObject({ status: 'expired' });
    for (let i = 0; i < FIX_LOOP_LIMITS.loops + 2; i++) l.start({ ...input, agentPath: `A${i}.agent` });
    expect(l.get('p1', idle.id)).toBeNull();
    expect(l.latest('p1', `A${FIX_LOOP_LIMITS.loops + 1}.agent`)).not.toBeNull();
  });
});
