/**
 * Squad seats that start on demand (#580).
 *
 * A seat marked `startOnDemand` is recorded at launch (authorized, no session) and started by the
 * engine when it has a first unit for it. This module holds the pure parts: which seats are
 * deferred, the refusal message, how long a waiting seat's launch approval lasts, and the per-run
 * spawner registry with its once-only fence.
 *
 * Approval: in a pre-authorized plan, every seat is approved at launch, including the seats that wait.
 * A waiting seat keeps that approval (it is not revoked at launch) with an expiry that covers the run
 * (`ON_DEMAND_SEAT_APPROVAL_MS`) and no launch deadline, and it starts under it later. Nothing mints a
 * new approval for it. When the approval has expired or was revoked (the run stopped), the seat does not
 * start and the engine takes it out of rotation: its unit goes to another seat or to a person.
 */

import { isClaimedDeferredWorker, MAX_TEAM_LAUNCH_DEADLINE_MS, type TeamWorkerProcessState } from '@zana-ai/zcc-server/services/launch/team-lifecycle-store';

export type DeferredSpawnResult = { ok: true; sessionId: string } | { ok: false; message: string; retryable?: true };

interface SeatLike { slotId: string; personaId: string; label?: string; role: 'worker' | 'orchestrator' }
interface TeamLike { transport?: string; slots?: ReadonlyArray<{ startOnDemand?: boolean; freshContextPerUnit?: boolean }> }

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

/** Expanded worker seats whose Team row asks for a fresh session per unit (#579). */
export function freshContextSeatsOf<T extends SeatLike>(team: TeamLike, seats: readonly T[]): T[] {
  void team;
  void seats;
  throw new Error('not implemented: freshContextSeatsOf');
}

/** What a seat's next launch looks like: a first or late start, or a respawn that must not resume the old conversation. */
export type SeatLaunchMode = 'start' | 'lateSeat' | 'respawn';

export interface RespawnLaunchShape {
  /** Whether the launch uses the approval minted by `authorizeRespawn` rather than one from launch. */
  usesRespawnApproval: boolean;
  /** Whether the old conversation id and recovery prompt are dropped. */
  dropsRecovery: boolean;
}

/** The decision for one launch mode, kept pure so host.ts stays branch-free (#579). */
export function respawnLaunchShape(mode: SeatLaunchMode): RespawnLaunchShape {
  void mode;
  throw new Error('not implemented: respawnLaunchShape');
}

/** What the engine knows about a seat when it is about to deliver a unit to it. */
export interface RecycleFacts {
  deliveredUnitCount: number;
  hasBlockedUnit: boolean;
  hasOpenBlockerDelivery: boolean;
  queuedInInjector: number;
}

/** Whether to recycle before delivering, or why not (the skip reason is logged with the run and slot id). */
export function recycleGuard(facts: RecycleFacts): { recycle: true } | { recycle: false; reason: string } {
  void facts;
  throw new Error('not implemented: recycleGuard');
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

/**
 * How long a waiting seat's launch approval lasts: the longest no-progress window a Squad run can be given
 * (24 hours). A run still going after that with a seat that never started gets the unit back to a person
 * rather than a seat starting on an approval that old.
 */
export const ON_DEMAND_SEAT_APPROVAL_MS = MAX_TEAM_LAUNCH_DEADLINE_MS;

/**
 * Expiry and launch deadline of one seat's approval, minted at launch. A waiting seat gets the run-length expiry
 * and no launch deadline (it starts after the launch call has returned); every other seat keeps the launch ones.
 */
export function seatApprovalWindow(
  waiting: boolean,
  authorizedAt: number,
  launch: { expiresAt: number; deadlineAt?: number }
): { expiresAt: number; deadlineAt?: number } {
  return waiting ? { expiresAt: authorizedAt + ON_DEMAND_SEAT_APPROVAL_MS } : launch;
}

/**
 * Whether a pre-issued approval's launch deadline is the one the plan's policy gives it. A waiting seat's approval
 * carries no launch deadline (it starts after launch); every other seat's is `authorizedAt + deadlineMs`, where
 * authorizedAt is recovered from the standard approval lifetime.
 */
export function preissuedDeadlineMatches(
  waiting: boolean,
  binding: { expiresAt?: number; deadlineAt?: number },
  deadlineMs: number | undefined,
  approvalTtlMs: number
): boolean {
  if (waiting || deadlineMs === undefined) return binding.deadlineAt === undefined;
  return binding.expiresAt !== undefined && binding.deadlineAt === binding.expiresAt - approvalTtlMs + deadlineMs;
}

/** Why a waiting seat cannot start under the approval it got at launch, or undefined when it can. */
export function lateSeatApprovalProblem(
  approval: { state: string; expiresAt?: number } | undefined,
  now: number
): string | undefined {
  if (!approval) return 'This seat was not started: its approval from launch is gone (the run was stopped or the app restarted).';
  if (approval.state !== 'authorized') return `This seat was not started: its approval from launch is ${approval.state}.`;
  if (approval.expiresAt !== undefined && approval.expiresAt <= now) return 'This seat was not started: its approval from launch has expired.';
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
  /** The run let go of its waiting seats: withdraw the approvals they still hold. */
  release?(): void;
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
    /** Run ended, stopped, dismissed or failed to launch: forget the spawner and withdraw the waiting seats' approvals. */
    release(recordId: string): void {
      const entry = runs.get(recordId);
      runs.delete(recordId);
      try { entry?.hooks.release?.(); } catch (error) { log(`on-demand seat approvals of ${recordId} could not be withdrawn`, error); }
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
  /** Withdraw the launch approvals of seats that never started. */
  revokeWaiting?(): void;
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
    reopen: (slotId) => deps.lifecycle.reopenDeferredSpawn(deps.recordId, slotId),
    release: () => deps.revokeWaiting?.()
  };
}
