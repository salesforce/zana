/**
 * Squad seats that start on demand (#580).
 *
 * A seat marked `startOnDemand` is recorded at launch (authorized, no session) and started by the
 * engine when it has a first unit for it. This module holds the pure parts: which seats are
 * deferred, the fail-closed message, and the per-run spawner registry with its once-only fence.
 */

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
  launch: { durable: boolean; structured: boolean }
): string | undefined {
  if (deferred.length === 0) return undefined;
  const names = deferred.map((seat) => seat.label || seat.personaId).join(', ');
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
  /** Start the seat's session. */
  start(slotId: string): Promise<DeferredSpawnResult>;
  /** Record a seat that did not start and cannot be retried. */
  markFailed(slotId: string): Promise<void>;
  /** Put a claimed seat back to waiting after a refusal that may pass (busy provider, capacity). */
  reopen(slotId: string): Promise<void>;
}

export interface DeferredSeatRegistryOptions {
  /** Report a problem with its run and seat; the registry never throws into the engine. */
  log?: (message: string, error?: unknown) => void;
  /** A start was requested for a run with no spawner (after a restart, or once the run ended). */
  onOrphan?: (recordId: string, slotId: string) => Promise<void>;
}

/** Spawners for runs that still have seats waiting; empty for a team without on-demand seats. */
export function createDeferredSeatRegistry(options: DeferredSeatRegistryOptions = {}) {
  type Entry = { hooks: DeferredSeatHooks; inflight: Map<string, Promise<DeferredSpawnResult>> };
  const runs = new Map<string, Entry>();
  const log = options.log ?? (() => undefined);

  /** Run a recording step; one retry, then report. */
  async function record(label: string, recordId: string, slotId: string, step: () => Promise<void>): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { await step(); return; } catch (error) {
        if (attempt === 1) log(`on-demand seat ${label} failed for ${recordId}/${slotId}`, error);
      }
    }
  }

  async function run(recordId: string, slotId: string, entry: Entry): Promise<DeferredSpawnResult> {
    try {
      if (!await entry.hooks.claim(slotId)) {
        const sessionId = await entry.hooks.sessionOf(slotId);
        if (sessionId) return { ok: true, sessionId };
        // Claimed earlier but never bound and nobody in this process is starting it: do not leave it stuck.
        await record('settle', recordId, slotId, () => entry.hooks.markFailed(slotId));
        return { ok: false, message: 'the seat is not waiting to start' };
      }
    } catch (error) {
      log(`on-demand seat claim failed for ${recordId}/${slotId}`, error);
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    // The run may have ended while the claim was pending: a released run starts nothing.
    if (runs.get(recordId) !== entry) {
      await record('settle', recordId, slotId, () => entry.hooks.markFailed(slotId));
      return { ok: false, message: 'the run ended before the seat could start' };
    }
    let result: DeferredSpawnResult;
    try {
      result = await entry.hooks.start(slotId);
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    if (result.ok) return { ok: true, sessionId: result.sessionId };
    log(`on-demand seat ${slotId} of ${recordId} did not start: ${result.message}`);
    await record('settle', recordId, slotId, () => result.ok === false && result.retryable ? entry.hooks.reopen(slotId) : entry.hooks.markFailed(slotId));
    return result.retryable ? { ok: false, message: result.message, retryable: true } : { ok: false, message: result.message };
  }

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
      const started = run(recordId, slotId, entry);
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

/** Refusals that may pass on a later try: another Squad is cold-starting the provider, or the machine is at its session limit. */
export function isTransientSeatRefusal(code: string | undefined): boolean {
  return code === 'CANCEL_PENDING' || code === 'RESOURCE_LIMIT' || code === 'CAPACITY';
}
