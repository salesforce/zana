/**
 * Squad seats that start on demand (#580).
 *
 * A seat marked `startOnDemand` is recorded at launch (authorized, no session) and started by the
 * engine when it has a first unit for it. This module holds the pure parts: which seats are
 * deferred, the fail-closed message, and the per-run spawner registry with its once-only fence.
 */

export type DeferredSpawnResult = { ok: true; sessionId: string } | { ok: false; message: string };

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
  /** Record a seat that did not start. */
  markFailed(slotId: string): Promise<void>;
}

/** Spawners for runs that still have seats waiting; empty for a team without on-demand seats. */
export function createDeferredSeatRegistry() {
  const runs = new Map<string, { hooks: DeferredSeatHooks; inflight: Map<string, Promise<DeferredSpawnResult>> }>();

  async function run(recordId: string, slotId: string): Promise<DeferredSpawnResult> {
    const entry = runs.get(recordId);
    if (!entry) return { ok: false, message: 'no seat is waiting to start for this run' };
    if (!await entry.hooks.claim(slotId)) {
      const sessionId = await entry.hooks.sessionOf(slotId);
      return sessionId ? { ok: true, sessionId } : { ok: false, message: 'the seat is not waiting to start' };
    }
    let result: DeferredSpawnResult;
    try {
      result = await entry.hooks.start(slotId);
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    if (!result.ok) await entry.hooks.markFailed(slotId).catch(() => undefined);
    return result.ok ? { ok: true, sessionId: result.sessionId } : { ok: false, message: result.message };
  }

  return {
    register(recordId: string, slotIds: readonly string[], hooks: DeferredSeatHooks): void {
      if (slotIds.length > 0) runs.set(recordId, { hooks, inflight: new Map() });
    },
    /** Callers for one seat share one start; the loser gets the winner's result. */
    spawn(recordId: string, slotId: string): Promise<DeferredSpawnResult> {
      const entry = runs.get(recordId);
      const shared = entry?.inflight.get(slotId);
      if (shared) return shared;
      const started = run(recordId, slotId);
      if (entry) {
        entry.inflight.set(slotId, started);
        void started.finally(() => entry.inflight.delete(slotId));
      }
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

/** Roster line for an on-demand seat (not running yet, so no session id). */
export function lifecycleSeatId(recordId: string, slotId: string): string {
  return `deferred:${recordId}:${slotId}`;
}
