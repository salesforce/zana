import { describe, it, expect, vi } from 'vitest';

// scheduler-store imports `electron` for its `app.getPath('home')` call. We
// only need that path inside `listAllSchedules` / `saveSchedule`; the
// validator we're testing here doesn't touch it. Mocking keeps the tests
// from blowing up at import time.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cc-test-home' }
}));

import { validateScheduleFile } from '../scheduler-store.js';

const baseTask = {
  id: 'sched-1',
  name: 'My schedule',
  enabled: true,
  projectId: 'proj-1',
  profile: 'claude',
  schedule: { every: '5m' },
  overlap: 'skip',
  history: { retain: 10 },
  status: { runCount: 0, runs: [] },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

describe('validateScheduleFile', () => {
  it('accepts a valid schedule and round-trips fields', () => {
    const r = validateScheduleFile({ ...baseTask });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.id).toBe('sched-1');
    expect(r.name).toBe('My schedule');
    expect(r.profile).toBe('claude');
    expect(r.schedule.every).toBe('5m');
    expect(r.history.retain).toBe(10);
  });

  it('rejects missing every', () => {
    const r = validateScheduleFile({ ...baseTask, schedule: {} });
    expect('error' in r).toBe(true);
  });

  it('rejects unparseable every (e.g. "1 hour")', () => {
    const r = validateScheduleFile({ ...baseTask, schedule: { every: '1 hour' } });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toMatch(/invalid interval/i);
  });

  it('accepts a cron schedule and round-trips cron + tz', () => {
    const r = validateScheduleFile({
      ...baseTask,
      schedule: { cron: '0 9 * * 1-5', tz: 'Europe/Paris' }
    });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.schedule.cron).toBe('0 9 * * 1-5');
    expect(r.schedule.tz).toBe('Europe/Paris');
    expect(r.schedule.every).toBeUndefined();
  });

  it('rejects an invalid cron expression', () => {
    const r = validateScheduleFile({ ...baseTask, schedule: { cron: 'not a cron' } });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toMatch(/invalid cron/i);
  });

  it('rejects a schedule that sets both every and cron', () => {
    const r = validateScheduleFile({
      ...baseTask,
      schedule: { every: '5m', cron: '0 9 * * *' }
    });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toMatch(/exactly one/i);
  });

  it('rejects invalid profile', () => {
    const r = validateScheduleFile({ ...baseTask, profile: 'gopher' });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toMatch(/invalid profile/i);
  });

  it('rejects non-string name', () => {
    const r = validateScheduleFile({ ...baseTask, name: 42 });
    expect('error' in r).toBe(true);
  });

  it('rejects missing projectId', () => {
    const { projectId: _drop, ...rest } = baseTask;
    void _drop;
    const r = validateScheduleFile(rest);
    expect('error' in r).toBe(true);
  });

  it('rejects non-boolean enabled', () => {
    const r = validateScheduleFile({ ...baseTask, enabled: 'yes' });
    expect('error' in r).toBe(true);
  });

  it('falls back to defaults for missing optional pieces', () => {
    const { history: _h, status: _s, ...rest } = baseTask;
    void _h;
    void _s;
    const r = validateScheduleFile(rest);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.history.retain).toBe(10);
    expect(r.status.runs).toEqual([]);
    expect(r.status.runCount).toBe(0);
  });

  describe('inboxLevel migration', () => {
    it('defaults to quiet when neither inboxLevel nor notifyInbox is present', () => {
      const r = validateScheduleFile({ ...baseTask });
      expect('error' in r).toBe(false);
      if ('error' in r) return;
      expect(r.inboxLevel).toBe('quiet');
    });

    it('honors an explicit inboxLevel', () => {
      for (const level of ['silent', 'quiet', 'loud'] as const) {
        const r = validateScheduleFile({ ...baseTask, inboxLevel: level });
        expect('error' in r).toBe(false);
        if ('error' in r) return;
        expect(r.inboxLevel).toBe(level);
      }
    });

    it('migrates legacy notifyInbox:true → loud', () => {
      const r = validateScheduleFile({ ...baseTask, notifyInbox: true });
      expect('error' in r).toBe(false);
      if ('error' in r) return;
      expect(r.inboxLevel).toBe('loud');
    });

    it('migrates legacy notifyInbox:false → quiet', () => {
      const r = validateScheduleFile({ ...baseTask, notifyInbox: false });
      expect('error' in r).toBe(false);
      if ('error' in r) return;
      expect(r.inboxLevel).toBe('quiet');
    });

    it('prefers inboxLevel over a conflicting legacy notifyInbox', () => {
      const r = validateScheduleFile({ ...baseTask, inboxLevel: 'silent', notifyInbox: true });
      expect('error' in r).toBe(false);
      if ('error' in r) return;
      expect(r.inboxLevel).toBe('silent');
    });

    it('falls back to quiet for an unrecognized inboxLevel string', () => {
      const r = validateScheduleFile({ ...baseTask, inboxLevel: 'shout' });
      expect('error' in r).toBe(false);
      if ('error' in r) return;
      expect(r.inboxLevel).toBe('quiet');
    });
  });
});
