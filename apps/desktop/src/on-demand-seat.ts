/**
 * Squad seats that start on demand (#580).
 *
 * A seat marked `startOnDemand` is recorded at launch (authorized, no session) and started by the
 * engine when it has a first unit for it. This module holds the pure parts: which seats are
 * deferred, the fail-closed message, and the per-run spawner registry with its once-only fence.
 */

import { isClaimedDeferredWorker, type TeamWorkerProcessState } from '@zana-ai/zcc-server/services/launch/team-lifecycle-store';

export type DeferredSpawnResult = { ok: true; sessionId: string } | { ok: false; message: string; retryable?: true };

interface SeatLike { slotId: string; personaId: string; label?: string; role: 'worker' | 'orchestrator' }
interface TeamLike { transport?: string; slots?: ReadonlyArray<{ startOnDemand?: boolean }> }

/** Row index of an expanded worker slot id (`<row>:<persona>:<n>`), or -1. */
function rowOf(slotId: string): number {
  const colon = slotId.indexOf(':');
  const row = colon > 0 ? Number(slotId.slice(0, colon)) : Number.NaN;
  return Number.isInteger(row) ? row : -1;
}

/** Expanded worker seats whose Team row asks to start on demand. */
export function deferredSeatsOf<T extends SeatLike>(team: TeamLike, seats: readonly T[]): T[] {
  return seats.filter((seat) => seat.role === 'worker' && team.slots?.[rowOf(seat.slotId)]?.startOnDemand === true);
}

/** Plain refusal for a launch that cannot honour on-demand seats, or undefined when it can. */
export function onDemandLaunchProblem(
  team: TeamLike,
  deferred: readonly SeatLike[],
  launch: { durable: boolean; structured: boolean; preauthorized?: boolean }
): string | undefined {
  if (deferred.length === 0) return undefined;
  const names = deferred.map((seat) => seat.label || seat.personaId).join(', ');
  // Fail closed: a pre-authorized plan fixes who may start, and when, at launch. A seat that starts on demand
  // would need a new authorization minted hours later, outside that approval, so the launch is refused instead.
  if (launch.preauthorized) {
    return `Start on demand can't be used with a pre-authorized plan, because those seats would start without the approval given at launch; turn it off for: ${names}`;
  }
  if (team.transport === 'MODERN') return `Start on demand isn't available for Modern squads yet; turn it off for: ${names}`;
  if (!launch.durable || !launch.structured) {
    return `Start on demand only works for plan-driven Squads; turn it off for: ${names}`;
  }
  return undefined;
}


export interface DeferredSeatHooks {
  /** Atomically move a never-started seat to spawning; false when another caller already did. */
  claim(slotId: string): Promise<boolean>;
  /** Session of a seat that has started, if any. */
  sessionOf(slotId: string): Promise<string | undefined>;
  /** Whether a seat is still waiting on a start nobody holds (claimed, no session). */
  isStuck(slotId: string): Promise<boolean>;
  /** Start the seat's session. */
  start(slotId: string): Promise<DeferredSpawnResult>;
  /** Close a session that started after its run had ended. */
  close(sessionId: string): Promise<void>;
  /** Record a seat that did not start and cannot be retried. */
  markFailed(slotId: string): Promise<void>;
  /**
   * Put a claimed seat back to waiting after a refusal that may pass. Returns false when the run is
   * no longer active, so the caller can finish the seat instead.
   */
  reopen(slotId: string): Promise<boolean>;
}

export interface DeferredSeatRegistryOptions {
  /** Report a problem with its run and seat; the registry never throws into the engine. */
  log?: (message: string, error?: unknown) => void;
  /** A start was requested for a run with no spawner (after a restart, or once the run ended). */
  onOrphan?: (recordId: string, slotId: string) => Promise<void>;
}

type Entry = { hooks: DeferredSeatHooks; inflight: Map<string, Promise<DeferredSpawnResult>> };
type Log = (message: string, error?: unknown) => void;
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Run a recording step; one retry, then report with the run and seat. */
async function settle(log: Log, recordId: string, slotId: string, step: () => Promise<unknown>): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { await step(); return; } catch (error) {
      if (attempt === 1) log(`on-demand seat settle failed for ${recordId}/${slotId}`, error);
    }
  }
}

/** Start one seat: claim it, start it, and settle it whichever way that ends. */
async function startSeat(log: Log, runs: Map<string, Entry>, recordId: string, slotId: string, entry: Entry): Promise<DeferredSpawnResult> {
  const { hooks } = entry;
  try {
    if (!await hooks.claim(slotId)) {
      const sessionId = await hooks.sessionOf(slotId);
      if (sessionId) return { ok: true, sessionId };
      // Only a seat that is claimed but has no session and nobody starting it needs settling; a seat that already ended does not.
      if (await hooks.isStuck(slotId)) await settle(log, recordId, slotId, () => hooks.markFailed(slotId));
      return { ok: false, message: 'the seat is not waiting to start' };
    }
  } catch (error) {
    log(`on-demand seat claim failed for ${recordId}/${slotId}`, error);
    return { ok: false, message: messageOf(error) };
  }
  // The run may have ended while the claim was pending: a released run starts nothing.
  if (runs.get(recordId) !== entry) {
    await settle(log, recordId, slotId, () => hooks.markFailed(slotId));
    return { ok: false, message: 'the run ended before the seat could start' };
  }
  let result: DeferredSpawnResult;
  try { result = await hooks.start(slotId); } catch (error) { result = { ok: false, message: messageOf(error) }; }
  if (result.ok) {
    // The run may also end while the session is starting: close it rather than hand it work.
    if (runs.get(recordId) === entry) return { ok: true, sessionId: result.sessionId };
    await settle(log, recordId, slotId, () => hooks.close(result.ok ? result.sessionId : ''));
    return { ok: false, message: 'the run ended while the seat was starting' };
  }
  log(`on-demand seat ${slotId} of ${recordId} did not start: ${result.message}`);
  const retryable = result.retryable === true;
  // A refusal that may pass keeps the seat waiting, but only while the run is still active.
  const reopened = retryable ? await reopenOrFinish(log, recordId, slotId, hooks) : false;
  if (!retryable) await settle(log, recordId, slotId, () => hooks.markFailed(slotId));
  return reopened ? { ok: false, message: result.message, retryable: true } : { ok: false, message: result.message };
}

/** Put a seat back to waiting; when the run is no longer active, finish it so the run can close. */
async function reopenOrFinish(log: Log, recordId: string, slotId: string, hooks: DeferredSeatHooks): Promise<boolean> {
  let reopened = false;
  await settle(log, recordId, slotId, async () => { reopened = await hooks.reopen(slotId); });
  if (!reopened) await settle(log, recordId, slotId, () => hooks.markFailed(slotId));
  return reopened;
}

/** Spawners for runs that still have seats waiting; empty for a team without on-demand seats. */
export function createDeferredSeatRegistry(options: DeferredSeatRegistryOptions = {}) {
  const runs = new Map<string, Entry>();
  const log = options.log ?? (() => undefined);
  return {
    register(recordId: string, slotIds: readonly string[], hooks: DeferredSeatHooks): void {
      if (slotIds.length > 0) runs.set(recordId, { hooks, inflight: new Map() });
    },
    /** Callers for one seat share one start; the loser gets the winner's result. */
    async spawn(recordId: string, slotId: string): Promise<DeferredSpawnResult> {
      const entry = runs.get(recordId);
      if (!entry) {
        try { await options.onOrphan?.(recordId, slotId); } catch (error) { log(`on-demand seat ${slotId} of ${recordId} could not be settled`, error); }
        return { ok: false, message: 'no seat is waiting to start for this run' };
      }
      const shared = entry.inflight.get(slotId);
      if (shared) return shared;
      const started = startSeat(log, runs, recordId, slotId, entry);
      entry.inflight.set(slotId, started);
      started.then(() => entry.inflight.delete(slotId), () => entry.inflight.delete(slotId));
      return started;
    },
    /** Run ended, stopped, dismissed or failed to launch: forget the spawner. */
    release(recordId: string): void {
      runs.delete(recordId);
    },
    has(recordId: string): boolean {
      return runs.has(recordId);
    }
  };
}

/** A cold-start wait is canceled when the launch is no longer active; a late seat outlives the launch call. */
export function coldStartCanceled(
  current: { state: string; outcome: { status: string } } | undefined,
  lateSeat: boolean
): boolean {
  return current?.state !== 'active' || (!lateSeat && current.outcome.status !== 'in-progress');
}

/**
 * Refusals that may pass on a later try: another Squad is cold-starting the provider account (CANCEL_PENDING),
 * the machine is at its live-session limit (RESOURCE_LIMIT, or STALE_PREFLIGHT "launch capacity changed"),
 * or the run's own concurrent limit is reached (DENIED "concurrent launch limit"). Anything else is final.
 */
export function isTransientSeatRefusal(code: string | undefined, message = ''): boolean {
  if (code === 'CANCEL_PENDING' || code === 'RESOURCE_LIMIT') return true;
  if (code === 'STALE_PREFLIGHT') return /capacity changed/i.test(message);
  if (code === 'DENIED') return /concurrent launch limit/i.test(message);
  return false;
}

interface LifecycleSeat { slotId: string; process: TeamWorkerProcessState; sessionId?: string; onDemand?: true }
interface HooksDeps<R> {
  recordId: string;
  lifecycle: {
    get(recordId: string): Promise<{ workers: readonly LifecycleSeat[] } | undefined>;
    claimDeferredSpawn(recordId: string, slotId: string): Promise<boolean>;
    reopenDeferredSpawn(recordId: string, slotId: string): Promise<boolean>;
    failDeferredSeat(recordId: string, slotId: string, reason: string): Promise<R | undefined>;
  };
  /** Open the seat's session (the launch path for one worker). */
  startSeat(slotId: string): Promise<{ ok: true; value: { id: string } } | { ok: false; code?: string; message: string }>;
  closeSession(sessionId: string): Promise<unknown>;
  /** Called with the lifecycle record after a seat is failed. */
  track(record: R): void;
  /** Called with the session id of a seat that started. */
  onStarted(sessionId: string): void;
}

/** Why a seat that did not start is recorded as failed. */
export const SEAT_NOT_STARTED_REASON = 'This seat could not be started.';

/** The registry hooks for one run, over the lifecycle store and the launch path for one seat. */
export function createDeferredSeatHooks<R>(deps: HooksDeps<R>): DeferredSeatHooks {
  const seatOf = async (slotId: string) => (await deps.lifecycle.get(deps.recordId))?.workers.find((worker) => worker.slotId === slotId);
  return {
    claim: (slotId) => deps.lifecycle.claimDeferredSpawn(deps.recordId, slotId),
    sessionOf: async (slotId) => (await seatOf(slotId))?.sessionId,
    isStuck: async (slotId) => {
      const seat = await seatOf(slotId);
      return isClaimedDeferredWorker(seat);
    },
    close: async (sessionId) => { await deps.closeSession(sessionId); },
    start: async (slotId) => {
      const started = await deps.startSeat(slotId);
      if (started.ok) deps.onStarted(started.value.id);
      return started.ok ? { ok: true, sessionId: started.value.id }
        : { ok: false, message: started.message, ...(isTransientSeatRefusal(started.code, started.message) ? { retryable: true as const } : {}) };
    },
    markFailed: async (slotId) => {
      const failed = await deps.lifecycle.failDeferredSeat(deps.recordId, slotId, SEAT_NOT_STARTED_REASON);
      if (failed) deps.track(failed);
    },
    reopen: (slotId) => deps.lifecycle.reopenDeferredSpawn(deps.recordId, slotId)
  };
}
