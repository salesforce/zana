import { describe, expect, it } from 'vitest';
import type { Project, ScheduledTask } from '@zana-ai/zcc-domain/product';
import { filterSchedules, scheduleIssue } from './schedule-filter.js';
import { missedRunChoices } from './schedulerUtils.js';

const projects = new Map([['p1', { id: 'p1', name: 'Garden' } as Project]]);
const make = (over: Partial<ScheduledTask> = {}, runs: unknown[] = []) => ({
  id: 's', name: 'Job', enabled: true, projectId: 'p1', profile: 'claude', description: '',
  status: { runCount: runs.length, runs }, ...over
}) as unknown as ScheduledTask;
const failed = (over: Record<string, unknown> = {}) => ({ id: 'r', at: new Date().toISOString(), result: 'error', ...over });

describe('scheduleIssue', () => {
  it('reports a missing project first', () => {
    expect(scheduleIssue(make({ projectId: 'gone' }, [failed()]), projects)).toBe('Project missing');
  });
  it('reports an open problem', () => {
    expect(scheduleIssue(make({}, [failed()]), projects)).toBe('Open problem');
    expect(scheduleIssue(make({}, [{ id: 'm', at: new Date().toISOString(), result: 'skipped', reasonCode: 'missed-asleep' }]), projects)).toBe('Open problem');
  });
  it.each([
    ['dismissed', failed({ dismissedAt: new Date().toISOString() })],
    ['resolved', failed({ resolvedBy: 'r2' })],
    ['too old', failed({ at: new Date(Date.now() - 30 * 86_400_000).toISOString() })],
    ['a success', { id: 'ok', at: new Date().toISOString(), result: 'success' }],
    ['a plain skip', { id: 'sk', at: new Date().toISOString(), result: 'skipped' }]
  ])('is clear for %s', (_label, run) => {
    expect(scheduleIssue(make({}, [run]), projects)).toBeNull();
  });
  it('is clear when a later finished success closed an older failure (pre-recovery history)', () => {
    const older = failed({ at: new Date(Date.now() - 3_600_000).toISOString() });
    const later = { id: 'ok', at: new Date().toISOString(), result: 'success', durationMs: 10 };
    expect(scheduleIssue(make({}, [later, older]), projects)).toBeNull();
    // The optimistic in-flight record is not a finished success.
    expect(scheduleIssue(make({}, [{ ...later, durationMs: undefined, launchState: 'running' }, older]), projects)).toBe('Open problem');
  });
  it('tolerates a task with no status', () => {
    expect(scheduleIssue({ ...make(), status: undefined } as unknown as ScheduledTask, projects)).toBeNull();
  });
});

describe('filterSchedules', () => {
  const a = make({ id: 'a', name: 'Alpha' }, [failed()]);
  const b = make({ id: 'b', name: 'Beta', enabled: false });
  it('filters by enabled, paused and attention', () => {
    expect(filterSchedules([a, b], projects, '', 'enabled')).toEqual([a]);
    expect(filterSchedules([a, b], projects, '', 'paused')).toEqual([b]);
    expect(filterSchedules([a, b], projects, '', 'attention')).toEqual([a]);
    expect(filterSchedules([a, b], projects, '', 'all')).toEqual([a, b]);
  });
  it('searches name and project', () => {
    expect(filterSchedules([a, b], projects, ' beta ', 'all')).toEqual([b]);
    expect(filterSchedules([a, b], projects, 'garden', 'all')).toEqual([a, b]);
  });
});

describe('missed-run wording', () => {
  it('says turning a schedule back on runs the missed time', () => {
    const original = missedRunChoices('cron', true).find((c) => c.value === 'original');
    expect(original?.hint).toContain('Turning a schedule back on also runs the time it missed.');
    expect(original?.hint).not.toMatch(/paused/i);
  });
});
