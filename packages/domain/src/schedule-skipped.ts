/**
 * Pure helper that decides whether a schedule skipped its last due time: either
 * a skipped record is the newest thing in its history (an overlap, a cap, a
 * missed gap), or the newest due slot passed and nothing was recorded for it.
 * Kept apart from schedule-health so that module (bundled by the CLI) never
 * pulls in croner. Total: malformed input returns null, never a throw.
 */
import type { ScheduleRun, ScheduleRunReasonCode, ScheduledTask } from './product.js';
import { parseEvery } from './parse-every.js';
import { isRecoveryMode, runReason } from './schedule-health.js';
import { isCronCadence, nextRunMsFrom, previousCronSlots } from './schedule-spec.js';

/** A due time this recent may still be starting, so the gap signal waits. */
export const SKIPPED_GRACE_MS = 2 * 60 * 1000;

/** A record may sit this close before its slot and still count as handling it. */
const SLOT_TOLERANCE_MS = 1000;

export interface SkippedLastRun {
  /** ISO time of the due slot that did not start a run. */
  slotAt: string;
  /** Why, when a record says so; absent when nothing was recorded for the slot. */
  reason?: ScheduleRunReasonCode;
}

function parseMs(value: unknown): number {
  return typeof value === 'string' ? Date.parse(value) : NaN;
}

/** The largest finite value, or undefined when none is. */
function maxFinite(values: number[]): number | undefined {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : undefined;
}

/** The records that carry a parsable `at`, newest first (ties keep stored order), minus resolved markers. */
function newestFirst(runs: ScheduleRun[]): ScheduleRun[] {
  return runs
    .filter((r) => r && typeof r === 'object' && Number.isFinite(parseMs(r.at)))
    .map((r, index) => ({ r, index, ms: Date.parse(r.at) }))
    .sort((a, b) => b.ms - a.ms || a.index - b.index)
    .map(({ r }) => r)
    .filter((r) => !(r.marker && r.resolvedBy));
}

/** The newest due slot at or before `limit`, by the schedule's own cadence. */
function newestDueSlot(task: ScheduledTask, nowMs: number, limit: number): number | undefined {
  const status = task.status;
  if (isCronCadence(task.schedule)) {
    const slot = previousCronSlots(task.schedule.cron!, task.schedule.tz, limit, 1)[0];
    if (slot === undefined) return undefined;
    // A catch-up is armed (the timer fires before the next slot after now), so the overdue slot is about to run.
    const nextMs = parseMs(status?.nextRunAt);
    if (Number.isFinite(nextMs) && nextMs > nowMs) {
      const following = nextRunMsFrom(task.schedule, new Date(nowMs));
      if (following !== null && nextMs < following) return undefined;
    }
    return slot;
  }
  const intervalMs = parseEvery(task.schedule.every ?? '');
  if (!intervalMs) return undefined;
  const anchor = maxFinite(
    [status?.lastRunAt, status?.slotCursorAt, status?.missedFloorAt]
      .map(parseMs)
      .filter((ms) => ms <= nowMs)
  );
  if (anchor === undefined) return undefined;
  const nextMs = parseMs(status?.nextRunAt);
  const armed = Number.isFinite(nextMs) && nextMs > nowMs;
  // Recovery replays an overdue grid time at once: a timer armed before the next grid time after now is that catch-up.
  if (armed && isRecoveryMode(task) && nextMs < anchor + (Math.floor((nowMs - anchor) / intervalMs) + 1) * intervalMs) return undefined;
  // After Zana was closed, Classic re-armed the timer off the old grid, so grid times past that re-arm were never due.
  const cap = armed ? Math.min(limit, nextMs - intervalMs) : limit;
  if (anchor + intervalMs > cap) return undefined;
  return anchor + Math.floor((cap - anchor) / intervalMs) * intervalMs;
}

export function lastRunSkipped(task: ScheduledTask, nowMs: number): SkippedLastRun | null {
  try {
    if (!task || task.external || !task.enabled) return null;
    const status = task.status;
    if (status?.queuedAt || status?.pendingRetry) return null;
    const runs = Array.isArray(status?.runs) ? status.runs : [];
    if (runs.some((r) => r?.launchState === 'pending')) return null;

    const newest = newestFirst(runs)[0];

    // Record signal: the newest record is a skip. A Squad run recovered after a restart is stored as
    // skipped + running + executionId, but it started; a plain running skip with a sessionId is a real overlap.
    if (
      newest && newest.result === 'skipped' && runReason(newest) !== 'in-flight'
      && !(newest.launchState === 'running' && newest.executionId)
    ) {
      let slotMs = [parseMs(newest.slotAt), parseMs(newest.missed?.to), parseMs(newest.at)].find(Number.isFinite)!;
      // An on-time overlap skip is merged into the live run's record (matched by its session), which keeps that
      // run's own older slotAt: the skipped time is the due time at the skip itself.
      if (newest.sessionId) {
        const atMs = parseMs(newest.at);
        const due = isCronCadence(task.schedule) ? previousCronSlots(task.schedule.cron!, task.schedule.tz, atMs, 1)[0] : atMs;
        if (due !== undefined && due > slotMs) slotMs = due;
      }
      const reason = runReason(newest);
      return reason ? { slotAt: new Date(slotMs).toISOString(), reason } : { slotAt: new Date(slotMs).toISOString() };
    }

    // Gap signal: the newest due slot passed the grace and nothing was recorded for it.
    const limit = nowMs - SKIPPED_GRACE_MS;
    const slot = newestDueSlot(task, nowMs, limit);
    if (slot === undefined || !Number.isFinite(slot)) return null;
    const floor = maxFinite([parseMs(task.createdAt), parseMs(status?.missedFloorAt), parseMs(status?.slotCursorAt)]);
    if (floor !== undefined && slot <= floor) return null;
    const handled = maxFinite([parseMs(newest?.at), parseMs(status?.lastRunAt)]);
    if (handled !== undefined && handled >= slot - SLOT_TOLERANCE_MS) return null;
    return { slotAt: new Date(slot).toISOString() };
  } catch {
    return null;
  }
}
