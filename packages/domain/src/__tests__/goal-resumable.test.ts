import { describe, expect, it } from 'vitest';
import type { GoalIteration, ScheduleRun } from '../product.js';
import { finishedIteration, latestResumableRun, resumableRun } from '../schedule-health.js';

const conversation = { profile: 'claude', id: 'conv-1', cwd: '/p', startedAt: '2026-01-01T00:00:00.000Z' } as const;
const iteration = (over: Partial<GoalIteration> = {}): GoalIteration => ({ id: 'i1', at: '2026-01-01T00:00:00.000Z', sessionId: 's1', launchState: 'running', conversation, ...over });
const scheduleRun = (over: Partial<ScheduleRun> = {}): ScheduleRun => ({ id: 'r1', at: '2026-01-01T00:00:00.000Z', result: 'success', conversation, ...over });

describe('REQ-5 resumableRun accepts a goal iteration', () => {
  it('accepts an iteration with a valid recorded conversation', () => {
    expect(resumableRun(iteration())).toBe(true);
  });
  it('still answers as before for schedule runs', () => {
    expect(resumableRun(scheduleRun())).toBe(true);
    expect(resumableRun(scheduleRun({ marker: true }))).toBe(false);
    expect(resumableRun(scheduleRun({ result: 'skipped' }))).toBe(false);
    expect(resumableRun(scheduleRun({ launchKind: 'team' }))).toBe(false);
    expect(resumableRun(scheduleRun({ conversation: undefined }))).toBe(false);
  });
  it('refuses an iteration whose recorded id could reach a launch argv as an option', () => {
    expect(resumableRun(iteration({ conversation: { ...conversation, id: '--dangerously-skip-permissions' } }))).toBe(false);
    expect(resumableRun(iteration({ conversation: { ...conversation, id: '' } }))).toBe(false);
    expect(resumableRun(iteration({ conversation: { ...conversation, id: undefined } }))).toBe(false);
    expect(resumableRun(iteration({ conversation: { ...conversation, profile: 7 as never } }))).toBe(false);
  });
  it('picks the newest resumable iteration', () => {
    const list = [
      iteration({ id: 'new-no-conv', at: '2026-01-03T00:00:00.000Z', conversation: undefined }),
      iteration({ id: 'mid', at: '2026-01-02T00:00:00.000Z', conversation: { ...conversation, id: 'mid-conv' } }),
      iteration({ id: 'old', at: '2026-01-01T00:00:00.000Z' })
    ];
    expect(latestResumableRun(list)?.id).toBe('mid');
    expect(latestResumableRun([])).toBeUndefined();
    expect(latestResumableRun(undefined)).toBeUndefined();
  });
});

describe('REQ-6 a Goal iteration is not offered when it cannot be reopened', () => {
  it.each([
    ['a Squad iteration (executionId)', { executionId: 'e1' }],
    ['a pending launch', { launchState: 'pending' as const }],
    ['a failed launch', { launchState: 'failed' as const }],
    ['an iteration with no conversation (old record)', { conversation: undefined }]
  ])('refuses %s', (_name, over) => {
    expect(resumableRun(iteration(over))).toBe(false);
    expect(latestResumableRun([iteration(over)])).toBeUndefined();
  });
});

describe('finishedIteration', () => {
  it('is true once the iteration is stamped finished or scored, false while it runs', () => {
    expect(finishedIteration({ finishedAt: '2026-01-01T00:10:00.000Z' })).toBe(true);
    expect(finishedIteration({ verdict: 'pass' })).toBe(true);
    expect(finishedIteration({})).toBe(false);
    expect(finishedIteration(undefined as never)).toBe(false);
  });
});
