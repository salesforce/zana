/**
 * Visibility notices for a live Squad run (idle capacity, stale heartbeat, a human blocker that waits).
 * Pure state and helpers: the execution service owns the sweep and posts through its run-warning path.
 * Nothing here holds a timer; the state is dropped for every run that is no longer active.
 */
import type { ExecutionRecord } from './store.js';

/** A `READY` unit with an idle seat for this long raises one notice. */
export const IDLE_CAPACITY_NOTICE_MS = 3 * 60_000;
/** A `CLAIMED` unit with no output progress for this long raises one notice. */
export const HEARTBEAT_WARN_MS = 5 * 60_000;
/** Default wait before a human blocker is surfaced again (AppConfig.executionBlockerReminderMs, 0 disables). */
export const DEFAULT_BLOCKER_REMINDER_MS = 30 * 60_000;
/** Hard cap on notices tracked per run, so a huge plan cannot grow the state without limit. */
const MAX_TRACKED_PER_RUN = 512;

interface UnitNotice { since: number; noticed: boolean }
interface RunVisibility { units: Map<string, UnitNotice>; reminded: Set<string> }

/** Wall time in words: whole minutes from one minute up, seconds below. */
export function formatWait(ms: number): string {
  if (ms >= 60_000) { const minutes = Math.round(ms / 60_000); return `${minutes} minute${minutes === 1 ? '' : 's'}`; }
  const seconds = Math.max(1, Math.round(ms / 1_000));
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

/**
 * The name the Agents board shows for a worker seat: the slot's label, else its persona's name, else the slot id.
 * Notices use it so the text matches the card the person opens.
 */
export function workerNoticeLabel(record: ExecutionRecord, slotId: string, personaName?: (personaId: string) => string | undefined): string {
  const route = record.request.resolvedModels?.find((model) => model.slotId === slotId);
  return route?.label?.trim() || (route?.personaId ? personaName?.(route.personaId)?.trim() : undefined) || slotId;
}

/**
 * Who is waiting on a blocker: the worker seat that raised it, or "The Squad" when Zana raised it itself
 * (its slot is the internal `engine` marker, which is no seat and means nothing to a person).
 */
export function blockerWaiter(record: ExecutionRecord, slotId: string, personaName?: (personaId: string) => string | undefined): string {
  return record.request.resolvedModels?.some((model) => model.slotId === slotId) ? workerNoticeLabel(record, slotId, personaName) : 'The Squad';
}

/** A unit as a person knows it: `"r4: Read step 4"`, with the bare plan id as the fallback. */
export function unitNoticeName(unit: { id: string; title?: string }): string {
  const title = unit.title?.trim();
  return title ? `"${unit.id}: ${title}"` : unit.id;
}

/** Reminder window from config: undefined means the default, a non-positive value disables. */
export function resolveBlockerReminderMs(configured: number | undefined): number {
  if (configured === undefined || !Number.isFinite(configured)) return DEFAULT_BLOCKER_REMINDER_MS;
  return configured > 0 ? configured : 0;
}

/** When the wait for a human answer started: an escalated coordinator blocker waits from its escalation. */
export function blockerWaitStart(blocker: NonNullable<ExecutionRecord['blockers']>[number]): number {
  return blocker.escalatedAt ?? blocker.createdAt;
}

/** Per-run dedupe state for visibility notices. */
export class VisibilityNoticeState {
  private readonly runs = new Map<string, RunVisibility>();

  private run(executionId: string): RunVisibility {
    let state = this.runs.get(executionId);
    if (!state) { state = { units: new Map(), reminded: new Set() }; this.runs.set(executionId, state); }
    return state;
  }

  /** The tracked entry for `key`, created on first sight (the idle clock starts then). */
  observe(executionId: string, key: string, now: number): UnitNotice | undefined {
    const state = this.run(executionId);
    const existing = state.units.get(key);
    if (existing) return existing;
    if (state.units.size >= MAX_TRACKED_PER_RUN) return undefined;
    const created = { since: now, noticed: false };
    state.units.set(key, created);
    return created;
  }

  /** Forget every unit key of the run that is no longer live (reclaimed, claimed, completed). Re-arms a later claim. */
  retainOnly(executionId: string, liveKeys: ReadonlySet<string>): void {
    const state = this.runs.get(executionId);
    if (!state) return;
    for (const key of state.units.keys()) if (!liveKeys.has(key)) state.units.delete(key);
  }

  /** True once per blocker; false for a blocker already reminded or when the per-run cap is reached. */
  markReminded(executionId: string, blockerId: string): boolean {
    const state = this.run(executionId);
    if (state.reminded.has(blockerId) || state.reminded.size >= MAX_TRACKED_PER_RUN) return false;
    state.reminded.add(blockerId);
    return true;
  }

  /** Release a reminder mark whose delivery failed, so the next sweep can try again. */
  unmarkReminded(executionId: string, blockerId: string): void {
    this.runs.get(executionId)?.reminded.delete(blockerId);
  }

  /** Reminded blockers that were answered, retried or removed no longer need their mark. */
  retainReminded(executionId: string, openBlockerIds: ReadonlySet<string>): void {
    const state = this.runs.get(executionId);
    if (!state) return;
    for (const id of state.reminded) if (!openBlockerIds.has(id)) state.reminded.delete(id);
  }

  /** Drop state for every run that is not in `activeIds` (run ended, stopped or dismissed). */
  retainRuns(activeIds: ReadonlySet<string>): void {
    for (const id of this.runs.keys()) if (!activeIds.has(id)) this.runs.delete(id);
  }

  clear(): void { this.runs.clear(); }

  /** Test seam: how many runs hold state. */
  get size(): number { return this.runs.size; }
}
