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

import { REST_STATES } from '@zana-ai/zcc-server/services/execution/idle-gated-injector';
import type { LaunchAuthorizationBinding } from '@zana-ai/zcc-server/services/launch/types';
import type { RosterEntry } from './team-coordinator-prompt.js';
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
  return seats.filter((seat) => seat.role === 'worker' && team.slots?.[rowOf(seat.slotId)]?.freshContextPerUnit === true);
}

/** Plain refusal for a launch that cannot honour a fresh session per unit, or undefined when it can (#579). */
export function freshContextLaunchProblem(
  team: TeamLike,
  fresh: readonly SeatLike[],
  launch: { durable: boolean; structured: boolean }
): string | undefined {
  if (fresh.length === 0) return undefined;
  const names = fresh.map((seat) => seat.label || seat.personaId).join(', ');
  if (team.transport === 'MODERN') return `Fresh session per unit isn't available for Modern squads yet; turn it off for: ${names}`;
  if (!launch.durable || !launch.structured) return `Fresh session per unit only works for plan-driven Squads; turn it off for: ${names}`;
  return undefined;
}

/** What a seat's next launch looks like: a first or late start, or a respawn that must not resume the old conversation. */
export type SeatLaunchMode = 'start' | 'lateSeat' | 'respawn';

export interface RespawnLaunchShape {
  /** Whether the old conversation id and recovery prompt are dropped. */
  dropsRecovery: boolean;
}

/** The decision for one launch mode, kept pure so host.ts stays branch-free (#579). */
export function respawnLaunchShape(mode: SeatLaunchMode): RespawnLaunchShape {
  const respawn = mode === 'respawn';
  return { dropsRecovery: respawn };
}

export type { RecycleFacts } from '@zana-ai/zcc-server/services/execution/idle-gated-injector';

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

// --- A fresh session between two units (#579) ---

/** How long a seat may take to come to rest before it is closed anyway: well inside the 5 minute claim lease. */
export const SEAT_REST_WAIT_MS = 90_000;
/** How long a closed session may take to exit before the respawn goes ahead. */
export const SEAT_EXIT_WAIT_MS = 20_000;

export interface SeatRecyclerDeps {
  /** Current agent state of a session. */
  stateOf(sessionId: string): string | undefined;
  /** The seat's current session, or undefined when it has none. */
  sessionOf(recordId: string, slotId: string): Promise<string | undefined>;
  /** Final usage sample of a session, attributed to its slot even once the seat is detached. */
  sampleUsage(executionId: string, sessionId: string, slotId: string): Promise<void>;
  /** Detach the session from the seat (lifecycle and session tracking) BEFORE it is closed; false when there is nothing to detach. */
  detach(recordId: string, slotId: string): Promise<boolean>;
  /** Forget the seat's recovery snapshot so a restart never resumes the session being closed. */
  clearRecovery(executionId: string, slotId: string): Promise<void>;
  /** Close a session. */
  close(sessionId: string): Promise<unknown>;
  /** Messages queued for a session; a session with some is never closed. */
  queuedFor?(sessionId: string): number;
  log(message: string, error?: unknown): void;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

/** What one run lends the recycler: its execution and the way to start one of its seats again. */
export interface SeatRecycleRun {
  /** Absent for a launch that is not an execution: there is then no usage to sample and no snapshot to clear. */
  executionId?: string;
  respawn(slotId: string): Promise<DeferredSpawnResult>;
}

interface Waiter { recordId: string; sessionId: string; settle(): void; timer: unknown }

export function createSeatRecycler(deps: SeatRecyclerDeps) {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));
  const restWaiters = new Set<Waiter>();
  const exitWaiters = new Set<Waiter>();
  const runs = new Map<string, SeatRecycleRun>();

  /** Resolve true when the waiter is settled by a feed or release, false when `ms` ran out first. */
  const waitFor = (set: Set<Waiter>, recordId: string, sessionId: string, ms: number): Promise<boolean> => new Promise((resolve) => {
    let fed = true;
    const waiter: Waiter = { recordId, sessionId, timer: undefined, settle: () => { clearTimer(waiter.timer); set.delete(waiter); resolve(fed); } };
    waiter.timer = setTimer(() => { fed = false; waiter.settle(); }, ms);
    set.add(waiter);
  });

  const settleFor = (set: Set<Waiter>, sessionId: string) => {
    for (const waiter of [...set]) if (waiter.sessionId === sessionId) waiter.settle();
  };

  /**
   * A session with no agent state at all can never be proven at rest: waiting for it would only stall the unit.
   * 'unknown' is different: the tracker reports it before its debounced first transition, so that one still waits.
   */
  const reportsState = (sessionId: string) => deps.stateOf(sessionId) !== undefined;

  /**
   * Close the seat's old session in the fixed order. Returns `released` when the run was released on the way
   * (nothing more is started for it), `declined` when the session is still in a turn, has queued messages, reports
   * no state or could not be detached (it is left open and keeps the unit), `retry` when the seat is detached but
   * its new session cannot start yet (the old one is slow to exit, or its recovery snapshot is still there), else `closed`.
   */
  async function retire(run: SeatRecycleRun, recordId: string, slotId: string, sessionId: string): Promise<'closed' | 'released' | 'declined' | 'retry'> {
    const stillRuns = () => runs.get(recordId) === run;
    const atRest = () => REST_STATES.has(deps.stateOf(sessionId) ?? '');
    const safeToClose = () => atRest() && (deps.queuedFor?.(sessionId) ?? 0) === 0;
    if (!reportsState(sessionId)) {
      deps.log(`fresh session for ${recordId}/${slotId} skipped: the session reports no agent state`);
      return 'declined';
    }
    if (!atRest()) await waitFor(restWaiters, recordId, sessionId, SEAT_REST_WAIT_MS);
    if (!stillRuns()) return 'released';
    if (!safeToClose()) return 'declined';
    if (run.executionId !== undefined) await deps.sampleUsage(run.executionId, sessionId, slotId).catch((error) => deps.log(`usage sample of ${recordId}/${slotId} failed before a fresh session`, error));
    // The sample took time: the run may have ended, or the session picked up work, meanwhile.
    if (!stillRuns()) return 'released';
    if (!safeToClose()) return 'declined';
    let detached: boolean;
    try { detached = await deps.detach(recordId, slotId); } catch (error) {
      deps.log(`seat ${recordId}/${slotId} could not be detached for a fresh session`, error);
      return 'declined';
    }
    if (!detached) return stillRuns() ? 'closed' : 'released';
    // The detach was asynchronous: the session may have started a turn or taken a message since the last check.
    if (stillRuns() && !safeToClose()) {
      await waitFor(restWaiters, recordId, sessionId, SEAT_REST_WAIT_MS);
      if (stillRuns() && !safeToClose()) {
        deps.log(`old session of ${recordId}/${slotId} is busy again after it was detached; it is left open`);
        return 'retry';
      }
    }
    if (!stillRuns()) { await deps.close(sessionId).catch((error) => deps.log(`old session of ${recordId}/${slotId} could not be closed`, error)); return 'released'; }
    const exited = waitFor(exitWaiters, recordId, sessionId, SEAT_EXIT_WAIT_MS);
    await deps.close(sessionId).catch((error) => deps.log(`old session of ${recordId}/${slotId} could not be closed`, error));
    if (!await exited && stillRuns()) {
      deps.log(`old session of ${recordId}/${slotId} did not exit in time; the fresh session waits for the next unit`);
      return 'retry';
    }
    return stillRuns() ? 'closed' : 'released';
  }

  /** Forget the seat's recovery snapshot so a restart never resumes the closed session; false (logged) when that failed. */
  async function clearSnapshot(run: SeatRecycleRun, recordId: string, slotId: string): Promise<boolean> {
    if (run.executionId === undefined) return true;
    try { await deps.clearRecovery(run.executionId, slotId); return true; } catch (error) {
      deps.log(`recovery snapshot of ${recordId}/${slotId} not cleared; no fresh session is started`, error);
      return false;
    }
  }

  /** Start a seat's fresh session. Resolves with its session id, or with none (`final` for a seat that will never start). */
  async function recycle(recordId: string, slotId: string): Promise<{ sessionId?: string; final?: true; declined?: true }> {
    const run = runs.get(recordId);
    // No run to start a seat for (after a restart, or once the run ended): the unit stays with the current session.
    if (!run) return { declined: true };
    let old: string | undefined;
    try { old = await deps.sessionOf(recordId, slotId); } catch (error) {
      deps.log(`seat ${recordId}/${slotId} could not be read for a fresh session`, error);
      return { declined: true };
    }
    if (runs.get(recordId) !== run) return { final: true };
    if (old !== undefined) {
      const retired = await retire(run, recordId, slotId, old);
      if (retired === 'declined') return { declined: true };
      if (retired === 'released') return { final: true };
      if (retired === 'retry') return {};
    }
    // Only after the old session is gone, so a late status write of it cannot bring the snapshot back. Also on a retry
    // of a seat that is already detached, whose earlier clear may have failed.
    if (!await clearSnapshot(run, recordId, slotId)) return {};
    if (runs.get(recordId) !== run) return { final: true };
    const started = await run.respawn(slotId);
    if (!started.ok) return started.retryable === true ? {} : { final: true };
    if (runs.get(recordId) !== run) {
      // The run ended while the new session was starting: close it rather than hand it work.
      await deps.close(started.sessionId).catch((error) => deps.log(`fresh session of ${recordId}/${slotId} could not be closed after the run ended`, error));
      return { final: true };
    }
    return { sessionId: started.sessionId };
  }

  return {
    /** Let a run's seats recycle; a run with no such seat is not kept. */
    register(recordId: string, slotIds: readonly string[], run: SeatRecycleRun): void { if (slotIds.length > 0) runs.set(recordId, run); },
    recycle,
    /** Feed every agent state change; releases a waiter whose session came to rest. */
    onState(sessionId: string, state: string): void { if (REST_STATES.has(state)) settleFor(restWaiters, sessionId); },
    /** Feed every session exit. */
    onExit(sessionId: string): void { settleFor(exitWaiters, sessionId); },
    /** The run ended, was stopped or dismissed: forget it and release its waiters and timers. */
    release(recordId: string): void {
      runs.delete(recordId);
      for (const waiter of [...restWaiters, ...exitWaiters]) if (waiter.recordId === recordId) waiter.settle();
    },
    has(recordId: string): boolean { return runs.has(recordId); }
  };
}

/** The approval id a seat's launch runs under: the respawn approval when there is one, else the one from launch. */
export function seatApprovalId(respawnApprovalId: string | undefined, launchApprovalId: string | undefined): string | undefined {
  return respawnApprovalId ?? launchApprovalId;
}

/** The mode a seat's next launch runs in. */
export function seatLaunchMode(lateSeat: boolean, respawnApprovalId: string | undefined): SeatLaunchMode {
  if (respawnApprovalId !== undefined) return 'respawn';
  return lateSeat ? 'lateSeat' : 'start';
}

/** Extra fields for a seat's lifecycle record: an in-place rebind for a respawn, a delivered-unit count for a fresh-context seat. */
export function seatBindExtras(respawn: boolean, fresh: boolean): { replace?: true; deliveredUnitCount?: number } {
  return { ...(respawn ? { replace: true as const } : {}), ...(fresh ? { deliveredUnitCount: 0 } : {}) };
}

/** A respawn starts a new conversation: drop the resumed session id, extra args and recovery prompt. */
export function seatRecovery<R extends { configuredProfile: string; profile: string; resumeSessionId?: string; extraArgs?: string[]; recoveryResume?: boolean }>(
  recovery: R, dropsRecovery: boolean
): R {
  if (!dropsRecovery) return recovery;
  const { resumeSessionId: _resume, extraArgs: _args, ...rest } = recovery;
  return { ...rest, profile: recovery.configuredProfile, recoveryResume: false } as R;
}

/** The coordinator roster entry for a seat: running with a session, waiting to start, or a new session for each unit. */
export function seatRosterEntry(seat: { slotId: string; label: string }, state: { sessionId?: string; fresh: boolean }): RosterEntry {
  if (state.fresh) return { ...seat, startsWhenNeeded: true, freshSessionPerUnit: true };
  if (state.sessionId === undefined) return { ...seat, startsWhenNeeded: true };
  return { ...seat, sessionId: state.sessionId };
}

/**
 * The first refusal among the seat kinds that need a plan-driven launch, or undefined. A fresh session per unit also
 * needs pre-authorized seats: the new session runs under an approval minted from the one the human gave.
 */
export function seatLaunchProblem(
  team: TeamLike, seats: readonly SeatLike[], launch: { durable: boolean; structured: boolean }, preauthorized: boolean
): string | undefined {
  return onDemandLaunchProblem(team, deferredSeatsOf(team, seats), launch)
    ?? freshContextLaunchProblem(team, freshContextSeatsOf(team, seats), { durable: launch.durable, structured: launch.structured && preauthorized });
}

type SeatIdentity = { principal: { kind: 'team'; id: string }; projectId: string; binding: LaunchAuthorizationBinding };

/** What was approved for each seat at its first spawn; a respawn is checked against it. */
export function createSeatApprovals(wanted: ReadonlySet<string>) {
  const bySlot = new Map<string, SeatIdentity>();
  return {
    remember(slotId: string, approval: { principal: { kind: string; id: string }; projectId: string; binding: LaunchAuthorizationBinding } | undefined): void {
      if (!wanted.has(slotId) || approval?.binding.consumerKind !== 'team-slot' || approval.principal.kind !== 'team') return;
      bySlot.set(slotId, { principal: { kind: 'team', id: approval.principal.id }, projectId: approval.projectId, binding: approval.binding });
    },
    expectedFor(slotId: string): SeatIdentity | undefined { return bySlot.get(slotId); }
  };
}

/** The single-use approval for a seat's next session, or why there is none. */
export function respawnApproval(
  service: { authorizeRespawn(prior: string, expected: SeatIdentity): { ok: true; authorization: { id: string } } | { ok: false; reason: string } },
  priorApprovalId: string | undefined,
  expected: SeatIdentity | undefined
): { ok: true; id: string } | { ok: false; message: string } {
  if (priorApprovalId === undefined || expected === undefined) return { ok: false, message: 'This seat has no earlier session to start a new one from.' };
  const minted = service.authorizeRespawn(priorApprovalId, expected);
  return minted.ok ? { ok: true, id: minted.authorization.id } : { ok: false, message: minted.reason };
}

export interface SeatStarterDeps<F extends { ok: false; code?: string; message: string }> {
  /** Whether the seat has had a session before, so its next start is a respawn. */
  hasStarted(slotId: string): Promise<boolean>;
  /** Mint the respawn approval for a seat, or say why not. */
  mintApproval(slotId: string): Promise<{ ok: true; id: string } | { ok: false; message: string }>;
  /** Open the seat's session, under the respawn approval when given. */
  start(slotId: string, respawnApprovalId?: string): Promise<{ ok: true; value: { id: string } } | F>;
}

/**
 * The start function the deferred-seat registry uses. A seat that has had a session before is started under its own
 * respawn approval; every other start is a late seat under its approval from launch, as before.
 */
export function createSeatStarter<F extends { ok: false; code?: string; message: string }>(deps: SeatStarterDeps<F>) {
  return async (slotId: string): Promise<{ ok: true; value: { id: string } } | F | { ok: false; code: string; message: string }> => {
    if (!await deps.hasStarted(slotId)) return deps.start(slotId);
    const approval = await deps.mintApproval(slotId);
    return approval.ok ? deps.start(slotId, approval.id) : { ok: false, code: 'DENIED', message: approval.message };
  };
}

/** Lifecycle reads and the detach of a recycle, keeping the lifecycle record tracked after the detach. */
export function lifecycleRecycleOps<R extends { workers: ReadonlyArray<{ slotId: string; sessionId?: string; authorizationId: string; deliveredUnitCount?: number }> }>(
  lifecycle: {
    get(recordId: string): Promise<R | undefined>;
    detachWorkerForRecycle(recordId: string, slotId: string): Promise<{ record: R } | undefined>;
    recordUnitDelivered(recordId: string, slotId: string): Promise<R | undefined>;
  },
  track: (record: R) => void
) {
  const seatOf = async (recordId: string, slotId: string) => (await lifecycle.get(recordId))?.workers.find((worker) => worker.slotId === slotId);
  return {
    sessionOf: async (recordId: string, slotId: string) => (await seatOf(recordId, slotId))?.sessionId,
    priorApprovalOf: async (recordId: string, slotId: string) => (await seatOf(recordId, slotId))?.authorizationId,
    /** A seat that counts delivered units and has had a session: its next session is a respawn. */
    hadSession: async (recordId: string, slotId: string) => (await seatOf(recordId, slotId))?.deliveredUnitCount !== undefined,
    detach: async (recordId: string, slotId: string) => {
      const detached = await lifecycle.detachWorkerForRecycle(recordId, slotId);
      if (detached) track(detached.record);
      return detached !== undefined;
    },
    recordDelivered: async (recordId: string, slotId: string): Promise<void> => {
      const updated = await lifecycle.recordUnitDelivered(recordId, slotId);
      if (updated) track(updated);
    }
  };
}
