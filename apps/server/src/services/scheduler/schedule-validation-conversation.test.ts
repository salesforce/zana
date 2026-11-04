import { describe, it, expect } from 'vitest';
import { validateScheduleFile } from './schedule-validation.js';

const base = (runs: unknown[]) => ({
  id: 's1', name: 'Job', enabled: true, projectId: 'p1', profile: 'claude', schedule: { every: '1h' },
  overlap: 'skip', history: { retain: 10 }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  status: { runCount: runs.length, runs }
});
const run = (extra: Record<string, unknown>) => ({ id: 'r1', at: '2026-10-27T10:00:00Z', result: 'success', sessionId: 'x', ...extra });
const load = (runs: unknown[]) => {
  const result = validateScheduleFile(base(runs));
  if ('error' in result) throw new Error(result.error);
  return result.status.runs as unknown as Array<Record<string, unknown>>;
};

describe('schedule run conversation validation', () => {
  it('round-trips a valid conversation, with and without an id', () => {
    const withId = { profile: 'claude', id: 'abc-123_DEF', cwd: '/p', startedAt: '2026-10-27T10:00:00Z' };
    const noId = { profile: 'codex', cwd: '/p', startedAt: '2026-10-27T10:00:00Z' };
    const runs = load([run({ conversation: withId }), run({ id: 'r2', conversation: noId })]);
    expect(runs[0]!.conversation).toEqual(withId);
    expect(runs[1]!.conversation).toEqual(noId);
  });

  it.each([
    ['a flag-like id', { profile: 'claude', id: '--flag', cwd: '/p', startedAt: '2026-10-27T10:00:00Z' }],
    ['a non-string id', { profile: 'claude', id: 7, cwd: '/p', startedAt: '2026-10-27T10:00:00Z' }],
    ['a missing cwd', { profile: 'claude', startedAt: '2026-10-27T10:00:00Z' }],
    ['an unregistered profile', { profile: 'not-a-harness', id: 'abc', cwd: '/p', startedAt: '2026-10-27T10:00:00Z' }],
    ['a profile with different case', { profile: 'Claude', id: 'abc', cwd: '/p', startedAt: '2026-10-27T10:00:00Z' }],
    ['a non-string profile', { profile: 3, cwd: '/p', startedAt: '2026-10-27T10:00:00Z' }],
    ['an unparseable startedAt', { profile: 'claude', cwd: '/p', startedAt: 'x' }],
    ['a missing startedAt', { profile: 'claude', cwd: '/p' }],
    ['a string', 'claude'],
    ['an array', []],
    ['null', null]
  ])('drops %s but keeps the run and the file', (_name, conversation) => {
    const runs = load([run({ conversation, message: 'kept' })]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: 'r1', result: 'success', message: 'kept' });
    expect('conversation' in runs[0]!).toBe(false);
  });
});
