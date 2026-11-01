import { describe, expect, it } from 'vitest';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';
import { reasonHint } from '@zana-ai/zcc-domain/schedule-health';
import { isSessionAlive, liveSessionIdForTask, skippedLastRunLabel, skippedLastRunPill } from './schedulerUtils.js';

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

describe('skippedLastRunLabel', () => {
  // Local-time constructors keep the results independent of the machine's timezone.
  const now = new Date(2026, 9, 14, 12, 0).getTime();
  const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const at = (d: Date) => d.toISOString();

  it('shows only the time for a slot on the same day', () => {
    const slot = new Date(2026, 9, 14, 7, 40);
    const label = skippedLastRunLabel({ slotAt: at(slot), reason: 'overlap' }, now);
    expect(label.text).toBe(`skipped ${time(slot)} · Previous run still active`);
    expect(label.title).toBe(`Skipped the ${time(slot)} run. The previous run's session was still open, so this run didn't start. Close that session or press Run now.`);
  });
  it('adds the weekday within a week', () => {
    const slot = new Date(2026, 9, 11, 7, 40);
    const when = `${slot.toLocaleDateString([], { weekday: 'short' })} ${time(slot)}`;
    expect(skippedLastRunLabel({ slotAt: at(slot), reason: 'overlap' }, now).text).toBe(`skipped ${when} · Previous run still active`);
  });
  it('shows the date for an older slot', () => {
    const slot = new Date(2026, 8, 20, 7, 40);
    expect(skippedLastRunLabel({ slotAt: at(slot), reason: 'overlap' }, now).text)
      .toBe(`skipped ${slot.toLocaleDateString([], { day: 'numeric', month: 'short' })} · Previous run still active`);
  });
  it('shows the date for the same weekday last week, even at a later clock time', () => {
    const slot = new Date(2026, 9, 7, 13, 0);
    expect(skippedLastRunLabel({ slotAt: at(slot) }, now).text)
      .toBe(`skipped ${slot.toLocaleDateString([], { day: 'numeric', month: 'short' })}`);
  });
  it('keeps the weekday for a slot six calendar days ago', () => {
    const slot = new Date(2026, 9, 8, 7, 40);
    expect(skippedLastRunLabel({ slotAt: at(slot) }, now).text)
      .toBe(`skipped ${slot.toLocaleDateString([], { weekday: 'short' })} ${time(slot)}`);
  });
  it('words the overlap title for a Squad', () => {
    const slot = new Date(2026, 9, 14, 7, 40);
    expect(skippedLastRunLabel({ slotAt: at(slot), reason: 'overlap' }, now, true).title)
      .toBe(`Skipped the ${time(slot)} run. The previous Squad run was still running, so this run didn't start.`);
  });
  it('uses the reason hint for any other known reason', () => {
    const slot = new Date(2026, 9, 14, 7, 40);
    const label = skippedLastRunLabel({ slotAt: at(slot), reason: 'concurrency-cap' }, now);
    expect(label.text).toBe(`skipped ${time(slot)} · Limit reached`);
    expect(label.title).toBe(`Skipped the ${time(slot)} run. ${reasonHint('concurrency-cap')} Press Run now to run it.`);
    expect(label.title.endsWith(' Press Run now to run it.')).toBe(true);
  });
  it('says nothing was recorded when there is no reason', () => {
    const slot = new Date(2026, 9, 14, 7, 40);
    const label = skippedLastRunLabel({ slotAt: at(slot) }, now);
    expect(label.text).toBe(`skipped ${time(slot)}`);
    expect(label.title).toBe(`Skipped the ${time(slot)} run. No run was recorded for this time. Press Run now to run it.`);
  });
});

describe('skippedLastRunPill', () => {
  const now = new Date(2026, 9, 14, 12, 0).getTime();
  const slot = new Date(2026, 9, 14, 7, 40).toISOString();
  const task = (over: Partial<ScheduledTask> = {}, result: 'skipped' | 'success' = 'skipped') => ({
    id: 't1', name: 'Digest', enabled: true, projectId: 'p1', profile: 'claude',
    schedule: { every: '24h' }, overlap: 'skip', history: { retain: 10 },
    status: { runCount: 1, lastRunAt: slot, runs: [{ at: slot, result, reasonCode: result === 'skipped' ? 'overlap' : undefined }] },
    createdAt: new Date(2026, 9, 1).toISOString(), updatedAt: new Date(2026, 9, 1).toISOString(),
    ...over
  }) as ScheduledTask;

  it('labels a schedule whose last run was skipped, as skippedLastRunLabel does', () => {
    expect(skippedLastRunPill(task(), now)).toEqual(skippedLastRunLabel({ slotAt: slot, reason: 'overlap' }, now));
  });
  it('words the overlap for a Squad schedule', () => {
    expect(skippedLastRunPill(task({ kind: 'team' }), now)?.title).toContain('The previous Squad run was still running');
  });
  it('is null for a /loop row and for a schedule that ran', () => {
    expect(skippedLastRunPill(task({ external: { kind: 'claude-loop' } } as Partial<ScheduledTask>), now)).toBeNull();
    expect(skippedLastRunPill(task({}, 'success'), now)).toBeNull();
  });
});
