import { describe, expect, it } from 'vitest';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';
import { isSessionAlive, liveSessionIdForTask } from './schedulerUtils.js';

const sessions = [
  { id: 'run', status: 'running' }, { id: 'boot', status: 'starting' }, { id: 'done', status: 'exited' }
] as never;

describe('isSessionAlive', () => {
  it.each([['run', true], ['boot', true], ['done', false], ['unknown', false], [undefined, false], ['', false]])(
    'session %j is open: %s', (id, expected) => expect(isSessionAlive(sessions, id as string | undefined)).toBe(expected));

  it('is false when the project has no terminals at all', () => {
    expect(isSessionAlive(undefined, 'run')).toBe(false);
    expect(isSessionAlive([], 'run')).toBe(false);
  });
});

describe('liveSessionIdForTask', () => {
  const task = (runs: unknown[]) => ({ projectId: 'p1', status: { runs } }) as unknown as ScheduledTask;
  it('uses the same open rule for the newest run', () => {
    const t = task([{ id: 'a', at: '2026-01-01T00:00:00Z', result: 'success', sessionId: 'run' }]);
    expect(liveSessionIdForTask(t, { p1: sessions })).toBe('run');
    expect(liveSessionIdForTask(t, { p1: [{ id: 'run', status: 'exited' }] as never })).toBeNull();
    expect(liveSessionIdForTask(t, {})).toBeNull();
  });
});
