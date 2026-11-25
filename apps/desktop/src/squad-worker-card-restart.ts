import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import type { SquadWorkerRestartResult } from './squad-worker-restart.js';

/**
 * Why a card Restart on a Squad worker was refused. `not-squad-worker` tells the renderer to keep its
 * ordinary restart path; every other refusal is final (no lookalike plain terminal is created).
 */
export type SquadWorkerCardRestartResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'not-squad-worker'
        | 'worker-exited'
        | 'run-closing'
        | 'run-finished'
        | Extract<SquadWorkerRestartResult, { ok: false }>['reason'];
      message?: string;
    };

interface LifecycleWorkerSlice {
  sessionId?: string;
  process?: string;
  slotId: string;
  cohortId: string;
  projectId: string;
}
interface LifecycleRecordSlice {
  id: string;
  state?: string;
  callerPrincipalId?: string;
  launchRequestId?: string;
  workers: LifecycleWorkerSlice[];
}

export interface SquadWorkerCardRestartDeps {
  getSession(sessionId: string): Pick<TerminalSession, 'id' | 'projectId' | 'status' | 'cohort'> | null | undefined;
  listLifecycleRecords(): Promise<LifecycleRecordSlice[]>;
  /** The durable closing fence (`launchIsClosing`): true when the launch is gone or no longer active. */
  launchIsClosing(recordId: string): Promise<boolean>;
  /** The execution slice main owns: state plus the launch identity that ties it to its lifecycle record. */
  getExecution(projectId: string, executionId: string): Promise<
    { state: string; callerPrincipalId?: string; teamLaunchRequestId?: string } | undefined
  >;
  isTerminalExecutionState(state: string): boolean;
  /**
   * Respawn of a worker whose session is over, through the same path as the coordinator's `execution.worker.respawn`
   * (lifecycle fences, deferred-seat spawn, launch-time snapshot), without its per-slot budget: a person asked.
   */
  respawnExited(recordId: string, slotId: string): Promise<{ ok: true } | { ok: false; message: string }>;
  /** `maySpawn` is the launch fence the restarter rechecks right before and right after it relaunches. */
  restart(sessionId: string, opts: { maySpawn: () => Promise<boolean> }): Promise<SquadWorkerRestartResult>;
}

const TERMINAL_SLOT_PROCESSES: ReadonlySet<string> = new Set(['exited', 'spawn-failed', 'canceled']);

/** Restart failures can carry paths and long error text; the renderer gets neither. */
export function safeMessage(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/(?:[A-Za-z]:)?[\\/](?:[^\s\\/]+[\\/])+([^\s\\/]*)/g, '$1')
    .slice(0, 200);
}

/**
 * Restarts a Squad worker for its card. Everything is derived from main-owned state: the session
 * record, its cohort, the lifecycle slot bound to that very session and the execution record. The
 * renderer supplies only the session id.
 */
export async function restartSquadWorkerCard(
  deps: SquadWorkerCardRestartDeps,
  sessionId: unknown
): Promise<SquadWorkerCardRestartResult> {
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 256) {
    return { ok: false, reason: 'not-found' };
  }
  const session = deps.getSession(sessionId);
  if (!session) return { ok: false, reason: 'not-found' };
  const cohort = session.cohort;
  if (cohort?.role !== 'worker' || !cohort.executionId || !cohort.slotId) {
    return { ok: false, reason: 'not-squad-worker' };
  }
  // Exactly one ACTIVE lifecycle record must bind this very session to this slot.
  const records = await deps.listLifecycleRecords();
  const matches = records.filter((candidate) => candidate.workers.some((worker) =>
    worker.sessionId === session.id && worker.slotId === cohort.slotId
    && worker.cohortId === cohort.cohortId && worker.projectId === session.projectId));
  if (matches.length !== 1) return { ok: false, reason: 'not-a-worker' };
  const record = matches[0];
  if (record.state !== 'active') return { ok: false, reason: 'run-closing', message: 'the Squad run is closing' };
  const slot = record.workers.find((worker) => worker.sessionId === session.id && worker.slotId === cohort.slotId)!;
  if (slot.process !== undefined && TERMINAL_SLOT_PROCESSES.has(slot.process) && session.status !== 'exited') {
    return { ok: false, reason: 'not-a-worker', message: 'the worker slot is no longer running' };
  }
  const execution = await deps.getExecution(session.projectId, cohort.executionId);
  if (!execution) return { ok: false, reason: 'not-a-worker' };
  // The execution must be the run this lifecycle record launched, not just any id the cohort names.
  if (execution.callerPrincipalId !== record.callerPrincipalId || execution.teamLaunchRequestId !== record.launchRequestId) {
    return { ok: false, reason: 'not-a-worker' };
  }
  if (deps.isTerminalExecutionState(execution.state)) {
    return { ok: false, reason: 'run-finished', message: 'the Squad run has already finished' };
  }
  if (await deps.launchIsClosing(record.id)) {
    return { ok: false, reason: 'run-closing', message: 'the Squad run is closing' };
  }
  if (session.status === 'exited') {
    // An exited seat has no live session to relaunch: it is given a new one through the respawn path.
    const respawned = await deps.respawnExited(record.id, cohort.slotId).catch((error: unknown) => {
      console.error(`[main] squad worker card restart: respawn of exited slot ${cohort.slotId} (record ${record.id}) failed`, error);
      return { ok: false as const, message: 'the worker could not be restarted' };
    });
    return respawned.ok ? { ok: true } : { ok: false, reason: 'worker-exited', message: safeMessage(respawned.message) };
  }
  const result = await deps.restart(session.id, { maySpawn: async () => !await deps.launchIsClosing(record.id) });
  return result.ok ? result : { ...result, ...(result.message ? { message: safeMessage(result.message) } : {}) };
}

export interface SquadWorkerOwnerRestartDeps extends SquadWorkerCardRestartDeps {
  /** The lifecycle slot (main-owned) for a launch record, or undefined when the record or slot is gone. */
  getWorker(recordId: string, slotId: string): Promise<{ sessionId?: string; process?: string } | undefined>;
  /** Respawn a seat whose session record is gone (same path as the coordinator's `execution.worker.respawn`, minus its budget). */
  respawnSeat(recordId: string, slotId: string): Promise<{ ok: true; sessionId: string } | { ok: false; message: string }>;
}

export type SquadWorkerOwnerRestartResult =
  | { ok: true; sessionId: string; mode: 'respawned' | 'restarted' }
  | { ok: false; reason: string; message: string };

/**
 * Owner-agent restart (`execution_slot_restart`): the card Restart path ({@link restartSquadWorkerCard}) driven by the lifecycle
 * slot instead of a renderer-supplied session id, so it keeps every fence the card has. When the slot's session record is
 * already gone (a dead worker with no terminal session), the seat is respawned directly. The caller (the engine) has already
 * verified that the owner owns the run and that the slot belongs to it, and applies the owner rate limit.
 */
export async function restartSquadWorkerForOwner(
  deps: SquadWorkerOwnerRestartDeps,
  recordId: string,
  slotId: string
): Promise<SquadWorkerOwnerRestartResult> {
  const worker = await deps.getWorker(recordId, slotId);
  if (!worker) return { ok: false, reason: 'not-found', message: 'the worker slot was not found' };
  const dead = worker.process !== undefined && TERMINAL_SLOT_PROCESSES.has(worker.process);
  const card = worker.sessionId
    ? await restartSquadWorkerCard(deps, worker.sessionId)
    : { ok: false as const, reason: 'not-found' as const, message: undefined };
  if (card.ok) {
    const after = await deps.getWorker(recordId, slotId);
    const sessionId = after?.sessionId ?? worker.sessionId!;
    return { ok: true, sessionId, mode: sessionId !== worker.sessionId ? 'respawned' : 'restarted' };
  }
  if ((card.reason === 'not-found' || card.reason === 'not-squad-worker' || card.reason === 'not-a-worker') && dead) {
    if (await deps.launchIsClosing(recordId)) return { ok: false, reason: 'run-closing', message: 'the Squad run is closing' };
    const respawned = await deps.respawnSeat(recordId, slotId).catch((error: unknown) => {
      console.error(`[main] squad owner restart: respawn of slot ${slotId} (record ${recordId}) failed`, error);
      return { ok: false as const, message: 'the worker could not be restarted' };
    });
    return respawned.ok ? { ok: true, sessionId: respawned.sessionId, mode: 'respawned' } : { ok: false, reason: 'worker-exited', message: safeMessage(respawned.message) };
  }
  return { ok: false, reason: card.reason, message: card.message ?? `restart refused: ${card.reason}` };
}
