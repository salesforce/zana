import { describe, expect, it } from 'vitest';
import type { ScheduleRun, ScheduledTask } from './product.js';
import { SKIPPED_GRACE_MS, lastRunSkipped } from './schedule-skipped.js';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const MIN = 60_000;
const H = 3_600_000;
const DAY = 24 * H;
/** The newest daily 09:00 UTC slot at NOW. */
const SLOT_9 = '2026-10-14T09:00:00.000Z';

const run = (over: Partial<ScheduleRun>): ScheduleRun => ({ at: iso(H), result: 'success', ...over });
const skip = (over: Partial<ScheduleRun> = {}): ScheduleRun => run({ result: 'skipped', ...over });

function task(runs: ScheduleRun[], over: Partial<ScheduledTask> = {}, status: Partial<ScheduledTask['status']> = {}): ScheduledTask {
  return {
    id: 't1', name: 'Task', enabled: true, projectId: 'p1', profile: 'claude',
    schedule: { cron: '0 9 * * *', tz: 'UTC' }, overlap: 'skip', history: { retain: 10 },
    status: { runCount: runs.length, runs, ...status }, createdAt: iso(99 * H), updatedAt: iso(99 * H),
    ...over
  } as ScheduledTask;
}

const every = (e: string, runs: ScheduleRun[] = [], status: Partial<ScheduledTask['status']> = {}, over: Partial<ScheduledTask> = {}) =>
  task(runs, { schedule: { every: e }, ...over }, status);

describe('lastRunSkipped: not applicable', () => {
  const overlap = skip({ reasonCode: 'overlap' });
  it('is null for a disabled schedule', () => {
    expect(lastRunSkipped(task([overlap], { enabled: false }), NOW)).toBeNull();
  });
  it('is null for an external row', () => {
    expect(lastRunSkipped(task([overlap], { external: true } as Partial<ScheduledTask>), NOW)).toBeNull();
  });
  it('is null while a run is queued', () => {
    expect(lastRunSkipped(task([overlap], {}, { queuedAt: iso(MIN) }), NOW)).toBeNull();
  });
  it('is null while a retry is pending', () => {
    expect(lastRunSkipped(task([overlap], {}, { pendingRetry: { rootRunId: 'r', attempt: 2, dueAt: iso(-MIN) } }), NOW)).toBeNull();
  });
  it('is null while a launch is pending', () => {
    expect(lastRunSkipped(task([overlap, run({ launchState: 'pending', at: iso(2 * H) })]), NOW)).toBeNull();
  });
});

describe('lastRunSkipped: record signal', () => {
  it('flags a newest overlap skip with its reason and time', () => {
    expect(lastRunSkipped(task([skip({ reasonCode: 'overlap', at: iso(H) })]), NOW))
      .toEqual({ slotAt: iso(H), reason: 'overlap' });
  });
  it('takes the slot time from slotAt, then missed.to, then at', () => {
    const slotAt = iso(5 * H);
    const to = iso(4 * H);
    expect(lastRunSkipped(task([skip({ reasonCode: 'overlap', slotAt, missed: { count: 1, from: to, to } })]), NOW)?.slotAt).toBe(slotAt);
    expect(lastRunSkipped(task([skip({ reasonCode: 'overlap', missed: { count: 1, from: to, to } })]), NOW)?.slotAt).toBe(to);
    expect(lastRunSkipped(task([skip({ reasonCode: 'overlap' })]), NOW)?.slotAt).toBe(iso(H));
  });
  it('falls through an unparsable slotAt', () => {
    const to = iso(4 * H);
    expect(lastRunSkipped(task([skip({ reasonCode: 'overlap', slotAt: 'nonsense', missed: { count: 1, from: to, to } })]), NOW)?.slotAt).toBe(to);
    expect(lastRunSkipped(task([skip({ reasonCode: 'overlap', slotAt: 'nonsense' })]), NOW)?.slotAt).toBe(iso(H));
  });
  it('flags an unresolved missed-app-closed marker', () => {
    expect(lastRunSkipped(task([skip({ marker: true, reasonCode: 'missed-app-closed' })]), NOW))
      .toEqual({ slotAt: iso(H), reason: 'missed-app-closed' });
  });
  it('flags concurrency-cap and queue-full skips', () => {
    expect(lastRunSkipped(task([skip({ reasonCode: 'concurrency-cap' })]), NOW)?.reason).toBe('concurrency-cap');
    expect(lastRunSkipped(task([skip({ reasonCode: 'queue-full' })]), NOW)?.reason).toBe('queue-full');
  });
  it('infers overlap from the legacy message', () => {
    expect(lastRunSkipped(task([skip({ message: 'previous run still active' })]), NOW)?.reason).toBe('overlap');
  });
  it('leaves out the reason when the record has none', () => {
    const found = lastRunSkipped(task([skip({})]), NOW);
    expect(found).toEqual({ slotAt: iso(H) });
    expect(found && 'reason' in found).toBe(false);
  });
  it('still flags an overlap skip that is running with a session but no execution', () => {
    expect(lastRunSkipped(task([skip({ reasonCode: 'overlap', launchState: 'running', sessionId: 's1' })]), NOW)?.reason).toBe('overlap');
  });
  it('gives a merged overlap skip the due time at the skip, not the live run\'s older slotAt', () => {
    // An on-time overlap skip is merged into the live catch-up run's record, which keeps yesterday's slotAt.
    const merged = skip({ reasonCode: 'overlap', launchState: 'running', sessionId: 's1', at: '2026-10-14T09:00:00.200Z', slotAt: '2026-10-13T09:00:00.000Z' });
    expect(lastRunSkipped(task([merged]), NOW)).toEqual({ slotAt: SLOT_9, reason: 'overlap' });
    expect(lastRunSkipped(every('6h', [merged]), NOW)).toEqual({ slotAt: '2026-10-14T09:00:00.200Z', reason: 'overlap' });
    // Interval: the skip's own time wins over an older slotAt. Cron: a slotAt newer than the due slot is kept.
    const late = skip({ reasonCode: 'overlap', sessionId: 's1', at: '2026-10-14T09:00:00.200Z', slotAt: '2026-10-14T09:00:00.100Z' });
    expect(lastRunSkipped(every('6h', [late]), NOW)?.slotAt).toBe('2026-10-14T09:00:00.200Z');
    expect(lastRunSkipped(task([late]), NOW)?.slotAt).toBe('2026-10-14T09:00:00.100Z');
  });
  it('reads records stored oldest first as newest first', () => {
    expect(lastRunSkipped(task([run({ at: iso(5 * H) }), skip({ reasonCode: 'overlap', at: iso(H) })]), NOW)?.reason).toBe('overlap');
    expect(lastRunSkipped(task([skip({ reasonCode: 'overlap', at: iso(5 * H) }), run({ at: iso(H) })]), NOW)).toBeNull();
  });
  it('ignores records without a parsable time', () => {
    expect(lastRunSkipped(task([skip({ reasonCode: 'overlap', at: 'never' }), run({ at: iso(H) })]), NOW)).toBeNull();
  });
});

describe('lastRunSkipped: cleared or excluded', () => {
  it('is cleared by a success after the skip', () => {
    expect(lastRunSkipped(task([run({ at: iso(30 * MIN) }), skip({ reasonCode: 'overlap', at: iso(2 * H) })]), NOW)).toBeNull();
  });
  it('is cleared by a manual run after the skip', () => {
    expect(lastRunSkipped(task([run({ at: iso(30 * MIN), trigger: 'manual' }), skip({ reasonCode: 'overlap', at: iso(2 * H) })]), NOW)).toBeNull();
  });
  it('drops a resolved marker, even when its catch-up run shares the millisecond', () => {
    const at = iso(30 * MIN);
    const marker = skip({ at, marker: true, reasonCode: 'missed-app-closed', resolvedBy: 'r1' });
    expect(lastRunSkipped(task([run({ at, id: 'r1' }), marker]), NOW)).toBeNull();
    expect(lastRunSkipped(task([run({ at, id: 'r1' }), { ...marker, resolvedBy: undefined }]), NOW)).toBeNull();
    expect(lastRunSkipped(task([{ ...marker, resolvedBy: undefined }]), NOW)?.reason).toBe('missed-app-closed');
  });
  it('lets an in-flight skip fall through to the gap check', () => {
    expect(lastRunSkipped(task([skip({ reasonCode: 'in-flight', at: iso(30 * MIN) })]), NOW)).toBeNull();
    expect(lastRunSkipped(task([skip({ reasonCode: 'in-flight', at: iso(5 * H) })]), NOW)).toEqual({ slotAt: SLOT_9 });
  });
  it('treats a recovered Squad record as a started run', () => {
    const recovered = skip({ at: iso(30 * MIN), launchState: 'running', executionId: 'e1' });
    expect(lastRunSkipped(task([recovered]), NOW)).toBeNull();
    expect(lastRunSkipped(task([{ ...recovered, at: iso(5 * H) }]), NOW)).toEqual({ slotAt: SLOT_9 });
  });
});

describe('lastRunSkipped: gap signal, cron', () => {
  it('flags a newest slot nothing was recorded for, with no reason', () => {
    const found = lastRunSkipped(task([run({ at: iso(DAY + 3 * H) })]), NOW);
    expect(found).toEqual({ slotAt: SLOT_9 });
    expect(found && 'reason' in found).toBe(false);
  });
  it('flags a schedule that has no runs and was created before the slot', () => {
    expect(lastRunSkipped(task([]), NOW)).toEqual({ slotAt: SLOT_9 });
  });
  it('is null when a run covers the slot, within a second of it', () => {
    expect(lastRunSkipped(task([run({ at: iso(3 * H) })]), NOW)).toBeNull();
    expect(lastRunSkipped(task([run({ at: iso(3 * H + 500) })]), NOW)).toBeNull();
    expect(lastRunSkipped(task([run({ at: iso(3 * H + 2000) })]), NOW)).not.toBeNull();
  });
  it('is null when lastRunAt covers the slot', () => {
    expect(lastRunSkipped(task([], {}, { lastRunAt: iso(2 * H) }), NOW)).toBeNull();
  });
  it('waits for the grace period', () => {
    const slot = Date.parse(SLOT_9);
    const base = task([run({ at: iso(DAY + 5 * H) })]);
    expect(SKIPPED_GRACE_MS).toBe(2 * MIN);
    expect(lastRunSkipped(base, slot + MIN)).toEqual({ slotAt: '2026-10-13T09:00:00.000Z' });
    expect(lastRunSkipped(task([run({ at: '2026-10-13T09:00:00.000Z' })]), slot + MIN)).toBeNull();
    expect(lastRunSkipped(task([run({ at: '2026-10-13T09:00:00.000Z' })]), slot + SKIPPED_GRACE_MS)).toEqual({ slotAt: SLOT_9 });
  });
  it('is null when the slot is at or before createdAt, missedFloorAt or slotCursorAt', () => {
    expect(lastRunSkipped(task([], { createdAt: iso(2 * H) }), NOW)).toBeNull();
    expect(lastRunSkipped(task([], { createdAt: SLOT_9 }), NOW)).toBeNull();
    expect(lastRunSkipped(task([], {}, { missedFloorAt: iso(2 * H) }), NOW)).toBeNull();
    expect(lastRunSkipped(task([], {}, { slotCursorAt: SLOT_9 }), NOW)).toBeNull();
    expect(lastRunSkipped(task([], {}, { slotCursorAt: iso(4 * H) }), NOW)).toEqual({ slotAt: SLOT_9 });
  });
});

describe('lastRunSkipped: gap signal, cron catch-up armed', () => {
  it('is null while the catch-up for the overdue slot is armed', () => {
    const armed = task([run({ at: iso(DAY + 3 * H) })], {}, { lastRunAt: iso(DAY + 3 * H), nextRunAt: new Date(NOW + 5000).toISOString() });
    expect(lastRunSkipped(armed, NOW)).toBeNull();
  });
  it.each([
    ['*/5 * * * *', '2026-10-14T10:01:00Z'],
    ['0 * * * *', '2026-10-14T10:01:30Z'],
    ['0 9 * * *', '2026-10-15T09:01:00Z']
  ])('is null for %s opened %s, inside the grace of a slot with two or more missed', (cron, openedAt) => {
    const now = Date.parse(openedAt);
    const lastRunAt = '2026-10-14T08:00:00.200Z';
    const armed = task([run({ at: lastRunAt })], { schedule: { cron, tz: 'UTC' } }, { lastRunAt, nextRunAt: new Date(now + 5000).toISOString() });
    expect(lastRunSkipped(armed, now)).toBeNull();
  });
  it('still flags the slot when nextRunAt is the slot after it', () => {
    const steady = task([run({ at: iso(DAY + 3 * H) })], {}, { nextRunAt: '2026-10-15T09:00:00.000Z' });
    expect(lastRunSkipped(steady, NOW)).toEqual({ slotAt: SLOT_9 });
  });
  it('ignores a nextRunAt in the past', () => {
    const stale = task([run({ at: iso(DAY + 3 * H) })], {}, { nextRunAt: iso(H) });
    expect(lastRunSkipped(stale, NOW)).toEqual({ slotAt: SLOT_9 });
  });
});

describe('lastRunSkipped: gap signal, interval', () => {
  it('flags the newest grid time after lastRunAt', () => {
    expect(lastRunSkipped(every('1h', [], { lastRunAt: iso(3 * H) }), NOW)).toEqual({ slotAt: iso(H) });
  });
  it('is null when the next grid time is not yet due', () => {
    expect(lastRunSkipped(every('1h', [], { lastRunAt: iso(H) }), NOW)).toBeNull();
    expect(lastRunSkipped(every('1h', [], { lastRunAt: iso(H + MIN) }), NOW)).toBeNull();
    expect(lastRunSkipped(every('1h', [], { lastRunAt: iso(H + 3 * MIN) }), NOW)).not.toBeNull();
  });
  it('uses slotCursorAt as the anchor when it is newer', () => {
    expect(lastRunSkipped(every('1h', [], { lastRunAt: iso(10 * H), slotCursorAt: iso(3 * H) }), NOW)).toEqual({ slotAt: iso(H) });
  });
  it('ignores a future lastRunAt, and has no anchor without one', () => {
    expect(lastRunSkipped(every('1h', [], { lastRunAt: iso(-H) }), NOW)).toBeNull();
    expect(lastRunSkipped(every('1h'), NOW)).toBeNull();
  });
  it('does not flag a Classic daily schedule turned back on before its first fire', () => {
    const next9 = Date.parse('2026-10-15T09:30:00Z');
    const turnedOn = every('24h', [], { lastRunAt: '2026-10-13T09:00:00.000Z', missedFloorAt: '2026-10-14T15:00:00.000Z' });
    expect(lastRunSkipped(turnedOn, next9)).toBeNull();
  });
  it('flags the old grid time before the re-arm after Zana was closed, not one after it', () => {
    // App started 11:30, so Classic re-armed at 11:30 tomorrow, off the old 12:00 grid.
    const closed = every('24h', [], { lastRunAt: iso(2 * DAY), nextRunAt: '2026-10-15T11:30:00.000Z' });
    expect(lastRunSkipped(closed, NOW)).toEqual({ slotAt: '2026-10-13T12:00:00.000Z' });
    // Ten minutes later the 12:00 grid time is due, but the re-arm still hides it.
    const later = NOW + 10 * MIN;
    expect(lastRunSkipped(closed, later)).toEqual({ slotAt: '2026-10-13T12:00:00.000Z' });
    expect(lastRunSkipped(every('24h', [], { lastRunAt: iso(2 * DAY) }), later)).toEqual({ slotAt: '2026-10-14T12:00:00.000Z' });
  });
  it('ignores a nextRunAt in the past', () => {
    expect(lastRunSkipped(every('1h', [], { lastRunAt: iso(3 * H), nextRunAt: iso(2 * H) }), NOW)).toEqual({ slotAt: iso(H) });
  });
  it('is null while a Recovery catch-up for an overdue grid time is armed, and flags it in steady state', () => {
    // Opened two and a half intervals late: Recovery arms the catch-up at now + 5 s.
    const now = NOW + 30 * MIN;
    const recovery = { catchUp: { mode: 'once' as const } };
    expect(lastRunSkipped(every('1h', [], { lastRunAt: iso(3 * H), nextRunAt: new Date(now + 5_000).toISOString() }, recovery), now)).toBeNull();
    // The timer sits on the next grid time after now: nothing is about to run, so the missed time shows.
    expect(lastRunSkipped(every('1h', [], { lastRunAt: iso(3 * H), nextRunAt: new Date(NOW + H).toISOString() }, recovery), now))
      .toEqual({ slotAt: new Date(NOW).toISOString() });
    // A Classic schedule with the same armed timer keeps the re-arm cap instead.
    expect(lastRunSkipped(every('1h', [], { lastRunAt: iso(3 * H), nextRunAt: new Date(now + 5_000).toISOString() }), now))
      .toEqual({ slotAt: iso(H) });
  });
  it('is null when a newer run already covers the grid time', () => {
    expect(lastRunSkipped(every('1h', [run({ at: iso(H) })], { lastRunAt: iso(3 * H) }), NOW)).toBeNull();
  });
});

describe('lastRunSkipped: malformed input', () => {
  it('returns null without throwing', () => {
    expect(lastRunSkipped(null as unknown as ScheduledTask, NOW)).toBeNull();
    expect(lastRunSkipped(task([], {}, { runs: 'x' as unknown as ScheduleRun[] }), NOW)).toEqual({ slotAt: SLOT_9 });
    expect(lastRunSkipped(task([], { schedule: { cron: 'not a cron', tz: 'UTC' } }), NOW)).toBeNull();
    expect(lastRunSkipped(every('soon', [], { lastRunAt: iso(3 * H) }), NOW)).toBeNull();
    expect(lastRunSkipped(task([], { schedule: undefined } as unknown as Partial<ScheduledTask>), NOW)).toBeNull();
    expect(lastRunSkipped(task([], { status: undefined } as unknown as Partial<ScheduledTask>), NOW)).toEqual({ slotAt: SLOT_9 });
  });
  it('skips junk entries in runs', () => {
    expect(lastRunSkipped(task([null, 'x', skip({ reasonCode: 'overlap' })] as unknown as ScheduleRun[]), NOW)?.reason).toBe('overlap');
  });
});
