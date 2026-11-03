import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  atomicDurableWrite,
  createSerializedTransactionQueue,
  hashBytes,
  readRawFile
} from '../harness-routing/storage.js';
import { launchDigest, taskDigest } from './digest.js';
import type { LaunchPrincipal } from './types.js';

export const MAX_TEAM_LAUNCH_REQUEST_ID_LENGTH = 256;
export const MAX_TEAM_INITIAL_TASK_BYTES = 64 * 1_024;
export const MAX_TEAM_LAUNCH_DEADLINE_MS = 24 * 60 * 60 * 1_000;

export interface TeamLaunchRequestSlot {
  slotId: string;
  authorizationId: string;
  authorizationBinding?: string;
  initialTask: string;
}

export interface TeamLaunchPolicy {
  deadlineMs?: number;
}

export interface TeamLaunchRequest {
  teamId: string;
  projectId: string;
  callerPrincipalId: string;
  launchRequestId: string;
  slots: TeamLaunchRequestSlot[];
  policy: TeamLaunchPolicy;
}

export type TeamWorkerProcessState = 'authorized' | 'spawning' | 'running' | 'exited' | 'spawn-failed' | 'canceled';
export type TeamWorkerAttentionState = 'active' | 'blocked';
export type TeamWorkerTaskState = 'unknown' | 'caller-reported-complete' | 'caller-reported-failed';
export type TeamWorkerDeliveryState = 'bound-at-spawn' | 'delivery-attempted' | 'adapter-acknowledged';
export type TeamWorkerTransport = 'CLI' | 'MODERN';
export type TeamWorkerBindingState = 'RESERVED' | 'CREATING' | 'RESUMING' | 'BOUND' | 'UNCERTAIN' | 'TERMINAL';

export interface TeamLaunchedWorker {
  sessionId: string;
  cohortId: string;
  slotId: string;
  personaId: string;
  projectId: string;
  authorizationId: string;
}

export interface TeamFailedWorkerSlot {
  slotId: string;
  personaId: string;
  reason: string;
}

export interface TeamLaunchResult {
  launchRequestId: string;
  launched: number;
  cohortId: string;
  workers: TeamLaunchedWorker[];
  failedSlots: TeamFailedWorkerSlot[];
  orchestratorSessionId?: string;
  workerSessionIds?: string[];
}

export interface TeamLifecycleWorker extends Omit<TeamLaunchedWorker, 'sessionId'> {
  /**
   * Absent only for a seat that starts on demand and has not started yet
   * (`process: 'authorized'`, CLI transport). Every other worker has one.
   */
  sessionId?: string;
  /** Marks a seat that started on demand, so only it may spawn after the launch call has returned. */
  onDemand?: true;
  process: TeamWorkerProcessState;
  attention: TeamWorkerAttentionState;
  task: TeamWorkerTaskState;
  delivery: TeamWorkerDeliveryState;
  capacityReleased: boolean;
  /** Omitted records predate transport bindings and remain CLI workers. */
  transport?: TeamWorkerTransport;
  /** Modern ACP thread identity, persisted before/after creation as appropriate. */
  threadId?: string;
  /** Monotonic binding generation; guards late create acknowledgements. */
  generation?: number;
  bindingState?: TeamWorkerBindingState;
  /** Main-resolved authority context for a Modern ACP member binding. */
  modernContext?: TeamModernBindingContext;
  /**
   * Process exit detail captured at the PTY `exit` event when a slot dies.
   * Historically dropped (onSessionExit took only the sessionId), which made
   * every Team failure surface as an identical detail-less "All Team slots
   * exited without completion". Persisting these lets reconcile build a
   * self-diagnosing per-slot FAILED detail.
   */
  exitCode?: number;
  exitSignal?: number;
  exitReason?: string;
}

export interface TeamModernBindingContext {
  teamId: string;
  cohortId: string;
  role: 'worker' | 'orchestrator';
  projectId: string;
  hostId: string;
  workspaceEnvironmentId?: string;
  providerId: string;
  personaSnapshot: {
    id: string;
    profile: string;
    model?: string;
    reasoningLevel?: string;
    permissionMode?: string;
    systemPrompt?: string;
  };
  executionId?: string;
  /** Realpath of the execution worktree, not a renderer-supplied cwd. */
  worktreePath: string;
}

export interface TeamLifecycleRecord {
  id: string;
  callerPrincipalId: string;
  launchRequestId: string;
  payloadDigest: string;
  /** Launch-time Team setting; later Team edits do not change this record. */
  retainOrchestrator?: boolean;
  capacity?: TeamRunCapacity;
  launchResult: TeamLaunchResult;
  outcome:
    | { status: 'in-progress' }
    | { status: 'completed'; result: TeamLaunchOperationResult };
  workers: TeamLifecycleWorker[];
  state: 'active' | 'cancel-pending' | 'canceled';
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface TeamLifecycleClaim {
  callerPrincipalId: string;
  launchRequestId: string;
  payloadDigest: string;
  retainOrchestrator?: boolean;
  capacity?: TeamRunCapacity;
  launchResult: TeamLaunchResult;
  workers: Array<Omit<TeamLifecycleWorker, 'capacityReleased'>>;
}

export type TeamLifecycleClaimInput = Pick<TeamLifecycleClaim, 'callerPrincipalId' | 'launchRequestId' | 'payloadDigest'>
  & Partial<Pick<TeamLifecycleClaim, 'launchResult' | 'workers' | 'capacity' | 'retainOrchestrator'>>;

export interface TeamRunCapacity {
  principal: Extract<LaunchPrincipal, { kind: 'team' }>;
  launched: number;
}

export type TeamLaunchOperationResult =
  | { ok: true; value: TeamLaunchResult }
  | { ok: false; code: string; message: string };

export type TeamLifecycleClaimResult =
  | { outcome: 'claimed'; record: TeamLifecycleRecord }
  | { outcome: 'in-progress'; record: TeamLifecycleRecord }
  | { outcome: 'replay'; record: TeamLifecycleRecord }
  | { outcome: 'conflict'; record: TeamLifecycleRecord };

/** PTY exit detail forwarded from the `exit` event into onSessionExit. */
export interface TeamWorkerExitDetail {
  exitCode?: number;
  signal?: number;
  reason?: string;
}

export interface TeamWorkerUpdate {
  process?: TeamWorkerProcessState;
  attention?: TeamWorkerAttentionState;
  task?: TeamWorkerTaskState;
  delivery?: TeamWorkerDeliveryState;
  exitCode?: number;
  exitSignal?: number;
  exitReason?: string;
}

export interface TeamModernWorkerReservation {
  record: TeamLifecycleRecord;
  worker: TeamLifecycleWorker;
  generation: number;
  threadId: string;
  /** Only the transaction that first persists intent may start creation. */
  mayCreate: boolean;
  /** Only the transaction that first persists RESUMING intent may start the Modern resume. */
  mayResume?: boolean;
}

/** Existing Modern binding to resume instead of creating a new thread. */
export interface TeamModernResumeTarget {
  threadId: string;
  /** Generation captured in the native-recovery snapshot; the resume runs at +1. */
  snapshotGeneration: number;
}

export interface TeamModernWorkerReference {
  recordId: string;
  slotId: string;
  generation: number;
  threadId: string;
}

/** Runtime must attest the exact binding and generation, never generic liveness. */
export interface TeamModernWorkerObservation extends TeamModernWorkerReference {
  state: 'bound' | 'terminal' | 'unknown';
}

export interface TeamModernReconcileResult extends TeamLifecycleReconcileResult {
  releasedAuthorizationIds: string[];
}

export interface TeamModernWorkerBinding {
  recordId: string;
  worker: TeamLifecycleWorker;
  generation: number;
}

export interface TeamLifecycleCancelResult extends TeamLifecycleRecord {
  releasedSlotIds: string[];
}

export interface TeamLifecycleReconcileResult {
  records: TeamLifecycleRecord[];
  releasedSlotIds: string[];
}

export interface TeamLifecycleStoreOptions {
  filePath: string;
  maxRecords?: number;
  now?: () => number;
  id?: () => string;
  durableWrite?: typeof atomicDurableWrite;
}

interface TeamLifecycleStateFile { version: 1; revision: number; records: TeamLifecycleRecord[] }

const MAX_STRING_LENGTH = 2_048;
const MAX_WORKERS = 100;
const MAX_FAILED_SLOTS = 100;
const MAX_RECORDS = 2_000;
const terminalProcesses = new Set<TeamWorkerProcessState>(['exited', 'spawn-failed', 'canceled']);
const modernBindingStates = new Set<TeamWorkerBindingState>(['RESERVED', 'CREATING', 'RESUMING', 'BOUND', 'UNCERTAIN', 'TERMINAL']);
const processTransitions: Readonly<Record<TeamWorkerProcessState, ReadonlySet<TeamWorkerProcessState>>> = {
  authorized: new Set(['spawning', 'spawn-failed', 'canceled']),
  spawning: new Set(['running', 'spawn-failed', 'canceled']),
  running: new Set(['exited', 'canceled']),
  exited: new Set(),
  'spawn-failed': new Set(),
  canceled: new Set()
};
const taskTransitions: Readonly<Record<TeamWorkerTaskState, ReadonlySet<TeamWorkerTaskState>>> = {
  unknown: new Set(['caller-reported-complete', 'caller-reported-failed']),
  'caller-reported-complete': new Set(),
  'caller-reported-failed': new Set()
};
const deliveryTransitions: Readonly<Record<TeamWorkerDeliveryState, ReadonlySet<TeamWorkerDeliveryState>>> = {
  'bound-at-spawn': new Set(),
  'delivery-attempted': new Set(['adapter-acknowledged']),
  'adapter-acknowledged': new Set()
};
const lifecycleTransactionQueue = createSerializedTransactionQueue();

export function boundTeamLaunchRequest(input: unknown): TeamLaunchRequest {
  if (!input || typeof input !== 'object') throw new Error('invalid team launch request');
  const request = input as Partial<TeamLaunchRequest>;
  if (!Array.isArray(request.slots) || request.slots.length === 0 || request.slots.length > MAX_WORKERS) {
    throw new Error('invalid team launch slots');
  }
  return {
    teamId: boundedString(request.teamId, 'team id'),
    projectId: boundedString(request.projectId, 'project id'),
    callerPrincipalId: boundedString(request.callerPrincipalId, 'caller principal id'),
    launchRequestId: boundedLaunchRequestId(request.launchRequestId),
    slots: request.slots.map(boundedRequestSlot),
    policy: boundedLaunchPolicy(request.policy)
  };
}

export function teamLaunchPayloadDigest(input: unknown): string {
  const request = boundTeamLaunchRequest(input);
  return launchDigest({
    teamId: request.teamId,
    projectId: request.projectId,
    callerPrincipalId: request.callerPrincipalId,
    launchRequestId: request.launchRequestId,
    slots: request.slots.map(({ slotId, authorizationBinding, initialTask }) => ({
      slotId,
      authorizationBinding,
      initialTask,
      initialTaskDigest: taskDigest(initialTask)
    })),
    policy: request.policy
  });
}

export function createTeamLifecycleStore(opts: TeamLifecycleStoreOptions) {
  if (opts.maxRecords !== undefined && (!Number.isInteger(opts.maxRecords) || opts.maxRecords < 1)) {
    throw new Error('invalid team lifecycle max records');
  }
  const maxRecords = Math.min(opts.maxRecords ?? MAX_RECORDS, MAX_RECORDS);
  const now = opts.now ?? (() => Date.now());
  const id = opts.id ?? randomUUID;
  const durableWrite = opts.durableWrite ?? atomicDurableWrite;
  const runExclusive = <T>(task: () => Promise<T>): Promise<T> => lifecycleTransactionQueue.run(task);
  // Record ids the CURRENT process is actively launching (claimed, not yet
  // finalized). reconcileStartup must never finalize these: crash recovery is
  // about orphans persisted by a PRIOR process, and a fresh process starts with
  // an empty set, so a genuine orphan (loaded from disk) is still reconciled
  // while an in-flight launch of the live process is left alone. Without this,
  // the boot reconcile (armed behind a grace timer, running while the UI can
  // already start jobs) races a new launch and flips its in-progress record to
  // completed=INTERRUPTED between claim and complete -> "already finalized".
  const inFlightLaunches = new Set<string>();

  function readState(): { state: TeamLifecycleStateFile; hash: string | null } {
    const bytes = readRawFile(opts.filePath);
    if (bytes === null) return { state: { version: 1, revision: 0, records: [] }, hash: null };
    try {
      const parsed = mergeDeferredSeats(JSON.parse(bytes.toString('utf8')) as unknown);
      if (!isState(parsed)) throw new Error('invalid shape');
      return { state: parsed, hash: hashBytes(bytes) };
    } catch (error) {
      throw new Error(`corrupt team lifecycle store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function persist(state: TeamLifecycleStateFile, expectedHash: string | null): void {
    mkdirSync(dirname(opts.filePath), { recursive: true });
    const active = state.records.filter(isActiveRecord);
    const terminal = state.records.filter((record) => !isActiveRecord(record)).slice(-maxRecords);
    state.records = state.records.filter((record) => active.includes(record) || terminal.includes(record));
    state.revision += 1;
    durableWrite(opts.filePath, Buffer.from(JSON.stringify(splitDeferredSeats(state))), { expectedHash });
  }

  async function claim(input: TeamLifecycleClaimInput): Promise<TeamLifecycleClaimResult> {
    const bounded = boundedClaim(input);
    return runExclusive(async () => {
      const snapshot = readState();
      const existing = snapshot.state.records.find((record) =>
        record.callerPrincipalId === bounded.callerPrincipalId && record.launchRequestId === bounded.launchRequestId
      );
       if (existing) return existing.payloadDigest === bounded.payloadDigest
        ? { outcome: existing.outcome.status === 'completed' ? 'replay' : 'in-progress', record: clone(existing) }
        : { outcome: 'conflict', record: clone(existing) };
      const timestamp = now();
      const record: TeamLifecycleRecord = {
        id: boundedString(id(), 'record id'),
        ...bounded,
        outcome: { status: 'in-progress' },
        workers: bounded.workers.map((worker) => ({ ...worker, capacityReleased: terminalProcesses.has(worker.process) })),
        state: 'active', revision: 0, createdAt: timestamp, updatedAt: timestamp
      };
      for (const worker of record.workers) assertUniqueModernThread({ ...snapshot.state, records: [...snapshot.state.records, record] }, worker);
      snapshot.state.records.push(record);
      persist(snapshot.state, snapshot.hash);
      inFlightLaunches.add(record.id);
      return { outcome: 'claimed', record: clone(record) };
    });
  }

  async function updateWorker(
    recordId: string,
    slotId: string,
    update: TeamWorkerUpdate
  ): Promise<{ record: TeamLifecycleRecord; worker: TeamLifecycleWorker; capacityReleasedNow: boolean }> {
    const safeRecordId = boundedString(recordId, 'record id');
    const safeSlotId = boundedString(slotId, 'slot id');
    validateUpdate(update);
    return runExclusive(async () => {
      const snapshot = readState();
      const record = snapshot.state.records.find((candidate) => candidate.id === safeRecordId);
      if (!record) throw new Error(`unknown team lifecycle record "${safeRecordId}"`);
      const worker = record.workers.find((candidate) => candidate.slotId === safeSlotId);
      if (!worker) throw new Error(`unknown team lifecycle worker "${safeSlotId}"`);
      if (worker.transport === 'MODERN' && update.process !== undefined && update.process !== worker.process) {
        throw new Error('modern worker process changes require generation-fenced reconciliation');
      }
      const changed = update.process !== undefined && update.process !== worker.process
        || update.attention !== undefined && update.attention !== worker.attention
        || update.task !== undefined && update.task !== worker.task
        || update.delivery !== undefined && update.delivery !== worker.delivery
        || update.exitCode !== undefined && update.exitCode !== worker.exitCode
        || update.exitSignal !== undefined && update.exitSignal !== worker.exitSignal
        || update.exitReason !== undefined && update.exitReason !== worker.exitReason;

      if (update.exitCode !== undefined) worker.exitCode = update.exitCode;
      if (update.exitSignal !== undefined) worker.exitSignal = update.exitSignal;
      if (update.exitReason !== undefined) worker.exitReason = update.exitReason;
      if (update.process !== undefined && update.process !== worker.process) {
        if (!processTransitions[worker.process].has(update.process)) {
          throw new Error(`invalid worker process transition ${worker.process} -> ${update.process}`);
        }
        worker.process = update.process;
      }
      if (update.attention !== undefined) worker.attention = update.attention;
      if (update.task !== undefined && update.task !== worker.task) {
        if (!taskTransitions[worker.task].has(update.task)) {
          throw new Error(`invalid worker task transition ${worker.task} -> ${update.task}`);
        }
        worker.task = update.task;
      }
      if (update.delivery !== undefined && update.delivery !== worker.delivery) {
        if (!deliveryTransitions[worker.delivery].has(update.delivery)) {
          throw new Error(`invalid worker delivery transition ${worker.delivery} -> ${update.delivery}`);
        }
        worker.delivery = update.delivery;
      }
      const capacityReleasedNow = terminalProcesses.has(worker.process) && !worker.capacityReleased;
      if (capacityReleasedNow) worker.capacityReleased = true;
      if (record.state === 'cancel-pending' && record.workers.every((candidate) => terminalProcesses.has(candidate.process))) {
        record.state = 'canceled';
      }
      if (!changed && !capacityReleasedNow) {
        return { record: clone(record), worker: clone(worker), capacityReleasedNow: false };
      }
      record.revision += 1;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return { record: clone(record), worker: clone(worker), capacityReleasedNow };
    });
  }

  async function setLaunchResult(recordId: string, launchResult: TeamLaunchResult): Promise<TeamLifecycleRecord> {
    const safeRecordId = boundedString(recordId, 'record id');
    const bounded = boundedLaunchResult(launchResult);
    return runExclusive(async () => {
      const snapshot = readState();
      const record = snapshot.state.records.find((candidate) => candidate.id === safeRecordId);
      if (!record) throw new Error(`unknown team lifecycle record "${safeRecordId}"`);
      if (record.workers.length > 0 || record.launchResult.workers.length > 0) {
        throw new Error('team lifecycle launch result already finalized');
      }
      record.launchResult = bounded;
      record.workers = bounded.workers.map((worker) => ({
        ...worker, process: 'running', attention: 'active', task: 'unknown',
        delivery: 'bound-at-spawn', capacityReleased: false
      }));
      record.revision += 1;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /**
   * Record a seat that starts on demand: authorized, no session yet. It takes no capacity and is
   * not part of the launch result until {@link bindDeferredWorker} gives it a session.
   */
  async function addDeferredWorker(
    recordId: string,
    worker: Omit<TeamLifecycleWorker, 'capacityReleased' | 'sessionId' | 'process' | 'transport'>
  ): Promise<TeamLifecycleRecord> {
    const safeRecordId = boundedString(recordId, 'record id');
    const bounded = boundedWorker({ ...worker, onDemand: true, process: 'authorized' });
    return runExclusive(async () => {
      const snapshot = readState();
      const record = snapshot.state.records.find((candidate) => candidate.id === safeRecordId);
      if (!record) throw new Error(`unknown team lifecycle record "${safeRecordId}"`);
      if (record.outcome.status !== 'in-progress' || record.state !== 'active') {
        throw new Error('team lifecycle launch is not active');
      }
      if (record.workers.some((candidate) => candidate.slotId === bounded.slotId
        || candidate.authorizationId === bounded.authorizationId)) {
        throw new Error('duplicate team lifecycle worker');
      }
      record.workers.push({ ...bounded, onDemand: true, capacityReleased: false });
      record.revision += 1;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /** Atomic once-only fence: the single caller that moves a never-started seat to `spawning` may spawn it. */
  async function claimDeferredSpawn(recordId: string, slotId: string): Promise<boolean> {
    const safeRecordId = boundedString(recordId, 'record id');
    const safeSlotId = boundedString(slotId, 'slot id');
    return runExclusive(async () => {
      const snapshot = readState();
      const record = snapshot.state.records.find((candidate) => candidate.id === safeRecordId);
      const worker = record?.workers.find((candidate) => candidate.slotId === safeSlotId);
      if (record?.state !== 'active' || !isDeferredWorker(worker)) return false;
      worker.process = 'spawning';
      record.revision += 1;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return true;
    });
  }

  /** Put a claimed seat that did not start back to waiting (a refusal that may pass). */
  async function reopenDeferredSpawn(recordId: string, slotId: string): Promise<boolean> {
    const safeRecordId = boundedString(recordId, 'record id');
    const safeSlotId = boundedString(slotId, 'slot id');
    return runExclusive(async () => {
      const snapshot = readState();
      const record = snapshot.state.records.find((candidate) => candidate.id === safeRecordId);
      const worker = record?.workers.find((candidate) => candidate.slotId === safeSlotId);
      if (record?.state !== 'active' || worker?.onDemand !== true || worker.process !== 'spawning' || worker.sessionId !== undefined) return false;
      worker.process = 'authorized';
      record.revision += 1;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return true;
    });
  }

  /** A seat nobody can start any more (no spawner after a restart): fail it once so its units are not re-offered. */
  async function failDeferredSeat(recordId: string, slotId: string, reason: string): Promise<TeamLifecycleRecord | undefined> {
    const safeRecordId = boundedString(recordId, 'record id');
    const safeSlotId = boundedString(slotId, 'slot id');
    return runExclusive(async () => {
      const snapshot = readState();
      const record = snapshot.state.records.find((candidate) => candidate.id === safeRecordId);
      const worker = record?.workers.find((candidate) => candidate.slotId === safeSlotId);
      if (!record || worker?.onDemand !== true || worker.sessionId !== undefined || terminalProcesses.has(worker.process)) return undefined;
      worker.process = 'spawn-failed';
      worker.capacityReleased = true;
      worker.exitReason = boundedString(reason, 'exit reason');
      record.revision += 1;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /** Give a claimed seat its session: it joins the launch result and takes one launch of capacity. */
  async function bindDeferredWorker(
    recordId: string,
    slotId: string,
    binding: { sessionId: string; authorizationId: string; delivery: TeamWorkerDeliveryState }
  ): Promise<TeamLifecycleRecord> {
    const safeRecordId = boundedString(recordId, 'record id');
    const safeSlotId = boundedString(slotId, 'slot id');
    const sessionId = boundedString(binding.sessionId, 'session id');
    const authorizationId = boundedString(binding.authorizationId, 'authorization id');
    if (!(binding.delivery in deliveryTransitions)) throw new Error('invalid worker delivery state');
    return runExclusive(async () => {
      const snapshot = readState();
      const record = snapshot.state.records.find((candidate) => candidate.id === safeRecordId);
      if (!record) throw new Error(`unknown team lifecycle record "${safeRecordId}"`);
      const worker = record.workers.find((candidate) => candidate.slotId === safeSlotId);
      if (record.state !== 'active' || worker?.process !== 'spawning' || worker.sessionId !== undefined || worker.transport === 'MODERN') {
        throw new Error('team lifecycle seat is not waiting for a session');
      }
      if (record.workers.some((candidate) => candidate !== worker
        && (candidate.sessionId === sessionId || candidate.authorizationId === authorizationId))) {
        throw new Error('duplicate team lifecycle worker');
      }
      worker.sessionId = sessionId;
      worker.authorizationId = authorizationId;
      worker.delivery = binding.delivery;
      if (record.capacity) record.capacity.launched += 1;
      record.launchResult.workers.push(boundedIdentity(worker));
      record.launchResult.launched = record.launchResult.workers.length;
      record.revision += 1;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function addWorker(
    recordId: string,
    worker: Omit<TeamLifecycleWorker, 'capacityReleased'>
  ): Promise<TeamLifecycleRecord> {
    const safeRecordId = boundedString(recordId, 'record id');
    const bounded = boundedWorker(worker);
    return runExclusive(async () => {
      const snapshot = readState();
      const record = snapshot.state.records.find((candidate) => candidate.id === safeRecordId);
      if (!record) throw new Error(`unknown team lifecycle record "${safeRecordId}"`);
      if (record.outcome.status !== 'in-progress' || record.state !== 'active') {
        throw new Error('team lifecycle launch is not active');
      }
      if (record.workers.some((candidate) => candidate.slotId === bounded.slotId
        || candidate.sessionId === bounded.sessionId || candidate.authorizationId === bounded.authorizationId)) {
        throw new Error('duplicate team lifecycle worker');
      }
      if (bounded.transport === 'MODERN' && (record.workers.length >= MAX_WORKERS
        || record.capacity && (record.capacity.launched >= record.capacity.principal.maxLaunchesPerRun
          || record.workers.filter((candidate) => !candidate.capacityReleased).length >= record.capacity.principal.maxConcurrent))) {
        throw new Error('team lifecycle modern worker capacity exhausted');
      }
      assertUniqueModernThread(snapshot.state, bounded);
      record.workers.push({ ...bounded, capacityReleased: terminalProcesses.has(bounded.process) });
      if (record.capacity) record.capacity.launched += 1;
      record.launchResult.workers.push(boundedIdentity(bounded));
      record.launchResult.launched = record.launchResult.workers.length;
      if (record.launchResult.cohortId === 'pending') record.launchResult.cohortId = bounded.cohortId;
      record.revision += 1;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function complete(
    recordId: string,
    result: TeamLaunchOperationResult,
    failedLaunchResult?: TeamLaunchResult
  ): Promise<TeamLifecycleRecord> {
    const safeRecordId = boundedString(recordId, 'record id');
    const boundedResult = boundedOperationResult(result);
    const launchResult = boundedResult.ok ? boundedResult.value
      : failedLaunchResult ? boundedLaunchResult(failedLaunchResult) : undefined;
    return runExclusive(async () => {
      const snapshot = readState();
      const record = snapshot.state.records.find((candidate) => candidate.id === safeRecordId);
      if (!record) throw new Error(`unknown team lifecycle record "${safeRecordId}"`);
      if (record.outcome.status === 'completed') throw new Error('team lifecycle launch result already finalized');
      if (launchResult) {
        if (record.workers.some((worker) => worker.transport === 'MODERN'
          && launchResult.workers.some((candidate) => candidate.slotId === worker.slotId && identityKey(candidate) !== identityKey(worker)))) {
          throw new Error('modern worker launch identity mismatch');
        }
        record.launchResult = launchResult;
        const existingByIdentity = new Map(record.workers.map((worker) => [identityKey(worker), worker]));
        const resultWorkers: TeamLifecycleWorker[] = launchResult.workers.map((worker) => existingByIdentity.get(identityKey(worker)) ?? ({
          ...worker, process: 'running', attention: 'active', task: 'unknown',
          delivery: 'bound-at-spawn', capacityReleased: false
        }));
        const deferredSeats = record.workers.filter(isDeferredWorker);
        record.workers = record.state === 'cancel-pending' || record.workers.some((worker) => worker.transport === 'MODERN')
          ? [...resultWorkers, ...record.workers.filter((worker) =>
              (worker.transport === 'MODERN' || !terminalProcesses.has(worker.process))
              && !launchResult.workers.some((candidate) => identityKey(candidate) === identityKey(worker)))]
          : [...resultWorkers, ...deferredSeats];
      }
      record.outcome = { status: 'completed', result: boundedResult };
      record.revision += 1;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      inFlightLaunches.delete(safeRecordId);
      return clone(record);
    });
  }

  async function cancel(recordId: string): Promise<TeamLifecycleCancelResult> {
    const safeRecordId = boundedString(recordId, 'record id');
    return runExclusive(async () => {
      const snapshot = readState();
      const record = snapshot.state.records.find((candidate) => candidate.id === safeRecordId);
      if (!record) throw new Error(`unknown team lifecycle record "${safeRecordId}"`);
      if (record.state !== 'active') return { ...clone(record), releasedSlotIds: [] };
      const releasedSlotIds: string[] = [];
      for (const worker of record.workers) {
        if (isDeferredWorker(worker) || worker.onDemand === true && worker.sessionId === undefined && worker.process === 'spawning') {
          worker.process = 'canceled';
          worker.capacityReleased = true;
          releasedSlotIds.push(worker.slotId);
        }
        if (worker.transport === 'MODERN' && worker.bindingState === 'RESERVED') {
          worker.bindingState = 'TERMINAL';
          worker.process = 'canceled';
          worker.capacityReleased = true;
          releasedSlotIds.push(worker.slotId);
        }
        if (worker.transport === 'MODERN' && (worker.bindingState === 'CREATING' || worker.bindingState === 'RESUMING')) worker.bindingState = 'UNCERTAIN';
      }
      record.state = record.workers.every((worker) => terminalProcesses.has(worker.process)) ? 'canceled' : 'cancel-pending';
      record.revision += 1;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return { ...clone(record), releasedSlotIds };
    });
  }

  async function workerMaySpawn(recordId: string, slotId: string): Promise<boolean> {
    const safeRecordId = boundedString(recordId, 'record id');
    const safeSlotId = boundedString(slotId, 'slot id');
    return runExclusive(async () => {
      const record = readState().state.records.find((candidate) => candidate.id === safeRecordId);
      const worker = record?.workers.find((candidate) => candidate.slotId === safeSlotId);
      return record?.state === 'active' && worker !== undefined && launchAllowsSpawn(record, worker)
        && worker.process === 'spawning' && worker.transport !== 'MODERN';
    });
  }

  async function claimWorkerRunning(recordId: string, slotId: string): Promise<boolean> {
    const safeRecordId = boundedString(recordId, 'record id');
    const safeSlotId = boundedString(slotId, 'slot id');
    return runExclusive(async () => {
      const snapshot = readState();
      const record = snapshot.state.records.find((candidate) => candidate.id === safeRecordId);
      const worker = record?.workers.find((candidate) => candidate.slotId === safeSlotId);
      if (record?.state !== 'active' || !worker || !launchAllowsSpawn(record, worker)
        || worker.process !== 'spawning' || worker.transport === 'MODERN') return false;
      worker.process = 'running';
      record.revision += 1;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return true;
    });
  }

  /**
   * Persist Modern-thread intent before the ACP thread exists. This is the
   * crash boundary: callers must reserve before asking ACP to create a thread.
   */
  async function reserveModernWorker(recordId: string, slotId: string, resume?: TeamModernResumeTarget): Promise<TeamModernWorkerReservation | undefined> {
    const safeRecordId = boundedString(recordId, 'record id');
    const safeSlotId = boundedString(slotId, 'slot id');
    return runExclusive(async () => {
      const snapshot = readState();
      const record = snapshot.state.records.find((candidate) => candidate.id === safeRecordId);
      const worker = record?.workers.find((candidate) => candidate.slotId === safeSlotId);
      if (!record || !worker || record.state !== 'active' || record.outcome.status !== 'in-progress') return undefined;
      if (worker.transport !== 'MODERN' || terminalProcesses.has(worker.process)) return undefined;
      if (worker.bindingState !== 'RESERVED') {
        return { record: clone(record), worker: clone(worker), generation: worker.generation!, threadId: worker.threadId!, mayCreate: false };
      }
      if (resume) {
        // Reuse the snapshot binding; the runtime op validates stored generation/provider thread.
        const threadId = boundedModernThreadId(resume.threadId);
        validateModernGeneration(resume.snapshotGeneration);
        worker.threadId = threadId;
        // A Modern member's session id is its thread id; the launch result reports the resumed binding.
        worker.sessionId = threadId;
        worker.generation = resume.snapshotGeneration + 1;
        worker.bindingState = 'RESUMING';
        worker.process = 'spawning';
        assertUniqueModernThread(snapshot.state, worker);
        record.revision += 1;
        record.updatedAt = now();
        persist(snapshot.state, snapshot.hash);
        return { record: clone(record), worker: clone(worker), generation: worker.generation, threadId, mayCreate: false, mayResume: true };
      }
      const generation = 1;
      worker.threadId = isModernThreadId(worker.sessionId) ? worker.sessionId : randomUUID();
      worker.generation = generation;
      worker.bindingState = 'CREATING';
      worker.process = 'spawning';
      assertUniqueModernThread(snapshot.state, worker);
      record.revision += 1;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return { record: clone(record), worker: clone(worker), generation, threadId: worker.threadId, mayCreate: true };
    });
  }

  /** Bind a created Modern thread only when its reservation generation still owns the slot. */
  async function acknowledgeModernWorker(
    recordId: string,
    slotId: string,
    generation: number,
    threadId: string
  ): Promise<boolean> {
    const safeRecordId = boundedString(recordId, 'record id');
    const safeSlotId = boundedString(slotId, 'slot id');
    const safeThreadId = boundedModernThreadId(threadId);
    validateModernGeneration(generation);
    return runExclusive(async () => {
      const snapshot = readState();
      const record = snapshot.state.records.find((candidate) => candidate.id === safeRecordId);
      const worker = record?.workers.find((candidate) => candidate.slotId === safeSlotId);
      if (!record || !worker || record.state !== 'active'
        || worker.transport !== 'MODERN' || worker.generation !== generation || worker.threadId !== safeThreadId
        || terminalProcesses.has(worker.process)) return false;
      if (worker.bindingState === 'BOUND') return true;
      if (worker.bindingState !== 'CREATING' && worker.bindingState !== 'RESUMING' && worker.bindingState !== 'UNCERTAIN') return false;
      worker.bindingState = 'BOUND';
      worker.process = 'running';
      record.revision += 1;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return true;
    });
  }

  async function markModernWorkerUncertain(recordId: string, slotId: string, generation: number, threadId: string): Promise<boolean> {
    const reference = boundedModernReference({ recordId, slotId, generation, threadId });
    return runExclusive(async () => {
      const snapshot = readState();
      const record = snapshot.state.records.find((candidate) => candidate.id === reference.recordId);
      const worker = record?.workers.find((candidate) => candidate.slotId === reference.slotId);
      if (!record || !matchesModernReference(worker, reference)) return false;
      if (worker.bindingState === 'UNCERTAIN') return true;
      if (worker.bindingState !== 'CREATING' && worker.bindingState !== 'RESUMING' && worker.bindingState !== 'BOUND') return false;
      worker.bindingState = 'UNCERTAIN';
      record.revision += 1;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return true;
    });
  }

  /** Cancellation fences authority before external close; runtime must also check this generation. */
  async function modernWorkerMayClose(recordId: string, slotId: string, generation: number, threadId: string): Promise<boolean> {
    const reference = boundedModernReference({ recordId, slotId, generation, threadId });
    return runExclusive(async () => {
      const record = readState().state.records.find((candidate) => candidate.id === reference.recordId);
      const worker = record?.workers.find((candidate) => candidate.slotId === reference.slotId);
      return record?.state === 'cancel-pending' && matchesModernReference(worker, reference);
    });
  }

  /** Bounded, explicit runtime evidence. Absence/unavailable runtime is unknown, not terminal. */
  async function reconcileModernWorkers(observations: readonly TeamModernWorkerObservation[]): Promise<TeamModernReconcileResult> {
    if (!Array.isArray(observations) || observations.length > MAX_WORKERS) throw new Error('invalid modern reconciliation batch');
    const bounded = observations.map((observation) => {
      if (!observation || !['bound', 'terminal', 'unknown'].includes(observation.state)) throw new Error('invalid modern observation');
      return { ...boundedModernReference(observation), state: observation.state };
    });
    return runExclusive(async () => {
      const snapshot = readState();
      const changed = new Set<TeamLifecycleRecord>();
      const releasedSlotIds: string[] = [];
      const releasedAuthorizationIds: string[] = [];
      for (const observation of bounded) {
        const record = snapshot.state.records.find((candidate) => candidate.id === observation.recordId);
        const worker = record?.workers.find((candidate) => candidate.slotId === observation.slotId);
        if (!record || !matchesModernReference(worker, observation)) continue;
        if (observation.state === 'terminal') {
          worker.bindingState = 'TERMINAL';
          worker.process = record.state !== 'active' ? 'canceled' : worker.process === 'spawning' ? 'spawn-failed' : 'exited';
          worker.capacityReleased = true;
          releasedSlotIds.push(worker.slotId);
          releasedAuthorizationIds.push(worker.authorizationId);
          if (record.state === 'cancel-pending' && record.workers.every((candidate) => terminalProcesses.has(candidate.process))) record.state = 'canceled';
        } else if (observation.state === 'bound') {
          if (record.state !== 'active' || worker.bindingState === 'BOUND') continue;
          worker.bindingState = 'BOUND';
          worker.process = 'running';
        } else {
          if (worker.bindingState === 'UNCERTAIN') continue;
          worker.bindingState = 'UNCERTAIN';
        }
        changed.add(record);
      }
      for (const record of changed) {
        record.revision += 1;
        record.updatedAt = now();
      }
      if (changed.size > 0) persist(snapshot.state, snapshot.hash);
      return { records: [...changed].map(clone), releasedSlotIds, releasedAuthorizationIds };
    });
  }

  async function reconcileStartup(recoveredSessionIds: ReadonlySet<string>): Promise<TeamLifecycleReconcileResult> {
    return runExclusive(async () => {
      const snapshot = readState();
      const records: TeamLifecycleRecord[] = [];
      const releasedSlotIds: string[] = [];
      for (const record of snapshot.state.records) {
        // Never reconcile a launch the live process is mid-flight on (claim not
        // yet completed) — only crash orphans persisted by a prior process.
        if (inFlightLaunches.has(record.id)) continue;
        let changed = false;
        for (const worker of record.workers) {
          // ACP threads survive process restart independently of PTYs. Their
          // durable intent keeps capacity until generation-attested terminal evidence.
          if ((worker.transport ?? 'CLI') === 'MODERN') {
            if (worker.bindingState === 'CREATING' || worker.bindingState === 'RESUMING' || worker.bindingState === 'BOUND') {
              worker.bindingState = 'UNCERTAIN';
              changed = true;
            }
            continue;
          }
          if (worker.sessionId !== undefined && recoveredSessionIds.has(worker.sessionId)) continue;
          if (worker.onDemand === true && worker.sessionId === undefined && worker.process === 'spawning') {
            // Mid-start at the crash: back to waiting while the run is live; on a run being canceled it is finished.
            worker.process = record.state === 'active' ? 'authorized' : 'canceled';
            if (worker.process === 'canceled') worker.capacityReleased = true;
            changed = true;
            continue;
          }
          const reconciledProcess = worker.process === 'spawning' ? 'spawn-failed'
            : worker.process === 'running' ? 'exited'
              : undefined;
          if (reconciledProcess === undefined) continue;
          worker.process = reconciledProcess;
          if (!worker.capacityReleased) {
            worker.capacityReleased = true;
            releasedSlotIds.push(worker.slotId);
          }
          changed = true;
        }
        // A Modern reservation has no PTY recovery signal. Keep its launch
        // claim in progress so restart cannot convert durable thread intent
        // into an interrupted launch while ACP may still create or own it.
        const hasNonTerminalModernWorker = record.workers.some((worker) =>
          (worker.transport ?? 'CLI') === 'MODERN' && worker.bindingState !== 'TERMINAL');
        if (record.outcome.status === 'in-progress' && !hasNonTerminalModernWorker) {
          record.outcome = {
            status: 'completed',
            result: { ok: false, code: 'INTERRUPTED', message: 'team launch interrupted by application restart' }
          };
          changed = true;
        }
        if (!changed) continue;
        record.revision += 1;
        record.updatedAt = now();
        records.push(clone(record));
      }
      if (records.length > 0) persist(snapshot.state, snapshot.hash);
      return { records, releasedSlotIds };
    });
  }

  /** Slots of a run whose on-demand seat never got a session. Synchronous read for callers that cannot await. */
  let neverStartedMemo: { hash: string; records: TeamLifecycleRecord[] } | undefined;
  let neverStartedReported = false;
  function neverStartedSlotsSync(callerPrincipalId: string, launchRequestId: string): string[] {
    try {
      const bytes = readRawFile(opts.filePath);
      if (bytes === null) return [];
      const hash = hashBytes(bytes);
      if (neverStartedMemo?.hash !== hash) neverStartedMemo = { hash, records: readState().state.records };
      const record = neverStartedMemo.records.find((candidate) =>
        candidate.callerPrincipalId === callerPrincipalId && candidate.launchRequestId === launchRequestId);
      return (record?.workers ?? []).filter((worker) => worker.onDemand === true && worker.sessionId === undefined).map((worker) => worker.slotId);
    } catch (error) {
      // Fail safe: every on-demand seat then counts as started, so Resume is not offered on a guess. Say so once.
      if (!neverStartedReported) {
        neverStartedReported = true;
        console.error('[team-lifecycle] could not read never-started seats', error);
      }
      return [];
    }
  }

  async function list(): Promise<TeamLifecycleRecord[]> {
    return runExclusive(async () => clone(readState().state.records));
  }

  async function get(recordId: string): Promise<TeamLifecycleRecord | undefined> {
    const safeRecordId = boundedString(recordId, 'record id');
    return (await list()).find((record) => record.id === safeRecordId);
  }

  async function findRequest(
    callerPrincipalId: string,
    launchRequestId: string
  ): Promise<TeamLifecycleRecord | undefined> {
    const safePrincipalId = boundedString(callerPrincipalId, 'caller principal id');
    const safeRequestId = boundedLaunchRequestId(launchRequestId);
    return (await list()).find((record) =>
      record.callerPrincipalId === safePrincipalId && record.launchRequestId === safeRequestId
    );
  }

  /**
   * Resolve only an acknowledged, generation-fenced Modern participant. Generic
   * conversation liveness is intentionally insufficient for execution authority.
   */
  async function findModernWorkerBinding(
    threadId: string,
    projectId: string
  ): Promise<TeamModernWorkerBinding | undefined> {
    const safeThreadId = boundedString(threadId, 'modern thread id');
    const safeProjectId = boundedString(projectId, 'modern project id');
    return runExclusive(async () => {
      for (const record of readState().state.records) {
        if (record.state !== 'active') continue;
        const worker = record.workers.find((candidate) =>
          candidate.transport === 'MODERN'
          && candidate.bindingState === 'BOUND'
          && candidate.threadId === safeThreadId
          && candidate.projectId === safeProjectId
          && candidate.process === 'running'
          && !candidate.capacityReleased
          && candidate.generation !== undefined
          && candidate.modernContext !== undefined
        );
        if (worker) return { recordId: record.id, worker: clone(worker), generation: worker.generation! };
      }
      return undefined;
    });
  }

  return { claim, complete, setLaunchResult, addWorker, addDeferredWorker, neverStartedSlotsSync, claimDeferredSpawn, reopenDeferredSpawn, failDeferredSeat, bindDeferredWorker, updateWorker, workerMaySpawn, claimWorkerRunning,
    reserveModernWorker, acknowledgeModernWorker, markModernWorkerUncertain, modernWorkerMayClose, reconcileModernWorkers,
    fenceCancel: cancel, cancel, reconcileStartup, list, get, findRequest, findModernWorkerBinding };
}

export type TeamLifecycleStore = ReturnType<typeof createTeamLifecycleStore>;

export interface TeamLifecycleIntegrationOptions {
  store: TeamLifecycleStore;
  isLiveSession: (sessionId: string) => boolean;
  closeSession: (sessionId: string) => Promise<boolean>;
  releaseCapacity: (authorizationId: string) => void;
  restoreCapacity?: (capacity: TeamRunCapacity, activeAuthorizationIds: readonly string[]) => void;
  /** False is not termination evidence. Undefined means runtime unavailable. */
  isLiveModernThread?: (threadId: string, projectId: string, generation: number) => boolean | undefined | Promise<boolean | undefined>;
  /** Runtime must validate binding metadata + generation before closing. True only requests close. */
  closeModernThread?: (threadId: string, projectId: string, generation: number) => Promise<boolean | undefined>;
}

interface TrackedTeamWorker {
  recordId: string;
  slotId: string;
  authorizationId: string;
  process: TeamWorkerProcessState;
  transport: TeamWorkerTransport;
  threadId?: string;
  generation?: number;
  projectId?: string;
  slotRole?: 'worker' | 'orchestrator';
  executionId?: string;
}

export function createTeamLifecycleIntegration(opts: TeamLifecycleIntegrationOptions) {
  const bySession = new Map<string, TrackedTeamWorker>();
  const trackedRevisions = new Map<string, number>();
  const closeRequested = new Set<string>();
  let pending = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const result = pending.then(task, task);
    pending = result.then(() => undefined, () => undefined);
    return result;
  };
  const track = (record: TeamLifecycleRecord): void => {
    if ((trackedRevisions.get(record.id) ?? -1) > record.revision) return;
    trackedRevisions.set(record.id, record.revision);
    for (const [key, tracked] of bySession) {
      if (tracked.recordId === record.id) bySession.delete(key);
    }
    for (const worker of record.workers) {
      if (!terminalProcesses.has(worker.process) && (worker.transport !== 'MODERN'
        || record.state === 'active' && worker.bindingState === 'BOUND' && worker.process === 'running' && !worker.capacityReleased)) {
        const tracked: TrackedTeamWorker = {
          recordId: record.id,
          slotId: worker.slotId,
          authorizationId: worker.authorizationId,
          process: worker.process,
          transport: worker.transport ?? 'CLI',
           ...(worker.threadId === undefined ? {} : { threadId: worker.threadId }),
          ...(worker.generation === undefined ? {} : { generation: worker.generation }),
          ...(worker.modernContext ? {
            projectId: worker.projectId,
            slotRole: worker.modernContext.role,
            ...(worker.modernContext.executionId ? { executionId: worker.modernContext.executionId } : {})
          } : {})
        };
        if (worker.sessionId !== undefined) bySession.set(worker.sessionId, tracked);
        // Main routes ACP DynamicTool calls by conversation thread id. Preserve
        // the opaque reservation key too for cancellation while creation races.
        if (worker.transport === 'MODERN' && worker.threadId) bySession.set(worker.threadId, tracked);
      } else {
        if (worker.sessionId !== undefined) bySession.delete(worker.sessionId);
        if (worker.transport === 'MODERN' && worker.threadId) bySession.delete(worker.threadId);
      }
    }
  };
  return {
    track,
    isTracked(sessionId: string): boolean {
      return bySession.has(sessionId);
    },
    async resolveModernBinding(threadId: string, projectId: string): Promise<{
      executionId: string; slotId: string; role: 'worker' | 'orchestrator'; authorizationId: string; generation: number;
    } | undefined> {
      const binding = await opts.store.findModernWorkerBinding(threadId, projectId);
      const worker = binding?.worker;
      if (!binding || !worker?.modernContext?.executionId) return undefined;
      return {
        executionId: worker.modernContext.executionId, slotId: worker.slotId, role: worker.modernContext.role,
        authorizationId: worker.authorizationId, generation: binding.generation
      };
    },
    onSessionExit(sessionId: string, exit?: TeamWorkerExitDetail): Promise<void> {
      return serialize(async () => {
        const tracked = bySession.get(sessionId);
        if (!tracked || tracked.transport === 'MODERN') return;
        bySession.delete(sessionId);
        closeRequested.delete(sessionId);
        if (terminalProcesses.has(tracked.process)) return;
        const record = await opts.store.get(tracked.recordId);
        const process = record?.state === 'cancel-pending' || record?.state === 'canceled' ? 'canceled' : 'exited';
        // Capture the PTY exit detail alongside the process transition so a
        // FAILED reconcile can report per-slot cause instead of a generic line.
        const update: TeamWorkerUpdate = { process };
        if (exit) {
          if (Number.isInteger(exit.exitCode)) update.exitCode = exit.exitCode;
          if (Number.isInteger(exit.signal)) update.exitSignal = exit.signal;
          if (typeof exit.reason === 'string' && exit.reason.length > 0) {
            update.exitReason = exit.reason.slice(0, MAX_STRING_LENGTH);
          }
        }
        const updated = await opts.store.updateWorker(tracked.recordId, tracked.slotId, update);
        if (updated.capacityReleasedNow) opts.releaseCapacity(tracked.authorizationId);
      });
    },
    onAgentStatus(sessionId: string, state: string): Promise<void> {
      return serialize(async () => {
        const tracked = bySession.get(sessionId);
        if (!tracked || terminalProcesses.has(tracked.process)) return;
        await opts.store.updateWorker(tracked.recordId, tracked.slotId, {
          attention: state === 'blocked' ? 'blocked' : 'active'
        });
      });
    },
    cancelTeamLaunch(
      callerPrincipalId: string,
      launchRequestId: string,
      cancelOpts?: { retainOrchestrator?: boolean }
    ) {
      return serialize(async () => {
        const record = (await opts.store.list()).find((candidate) =>
          candidate.callerPrincipalId === callerPrincipalId && candidate.launchRequestId === launchRequestId
        );
        if (!record) return { ok: false as const, code: 'NOT_FOUND' as const };
        if (record.state === 'canceled') {
          return {
            ok: true as const,
            canceledSessionIds: [],
            pendingSessionIds: [],
            lifecycleState: 'canceled' as const
          };
        }
        const canceled = await opts.store.fenceCancel(record.id);
        track(canceled);
        const orchestratorSessionId = canceled.launchResult.orchestratorSessionId;
        const retainOrchestrator = cancelOpts?.retainOrchestrator === true;
        if (retainOrchestrator && orchestratorSessionId === undefined) {
          console.warn('[team-lifecycle] retainOrchestrator requested without an orchestrator session; closing all sessions');
        }
        for (const worker of canceled.workers) {
          if (canceled.releasedSlotIds.includes(worker.slotId)) opts.releaseCapacity(worker.authorizationId);
        }
        const canceledSessionIds: string[] = [];
        const pendingSessionIds: string[] = [];
        for (const worker of canceled.workers) {
          if (terminalProcesses.has(worker.process)) continue;
          if (worker.sessionId === undefined) continue;
          if (retainOrchestrator && worker.sessionId === orchestratorSessionId) continue;
          if (closeRequested.has(worker.sessionId)) continue;
          const isModern = (worker.transport ?? 'CLI') === 'MODERN';
          if (isModern) {
            if (!worker.threadId || worker.generation === undefined
              || !await opts.store.modernWorkerMayClose(record.id, worker.slotId, worker.generation, worker.threadId)) {
              pendingSessionIds.push(worker.sessionId);
              continue;
            }
            // Close is generation-attested in runtime. Neither false liveness nor
            // a close acknowledgement proves a late create can no longer run.
            let closed: boolean | undefined;
            try { closed = await opts.closeModernThread?.(worker.threadId, worker.projectId, worker.generation); }
            catch { closed = undefined; }
            if (closed === true) {
              closeRequested.add(worker.sessionId);
              canceledSessionIds.push(worker.sessionId);
            } else pendingSessionIds.push(worker.sessionId);
            continue;
          }
          const isLive = opts.isLiveSession(worker.sessionId);
          const closed = isLive === true && await opts.closeSession(worker.sessionId);
          if (isLive === true && closed) {
            closeRequested.add(worker.sessionId);
            canceledSessionIds.push(worker.sessionId);
          } else if (isLive !== false) {
            pendingSessionIds.push(worker.sessionId);
          } else {
            const updated = await opts.store.updateWorker(record.id, worker.slotId, {
              process: worker.process === 'spawning' ? 'spawn-failed' : 'exited'
            });
            if (updated.capacityReleasedNow) opts.releaseCapacity(worker.authorizationId);
            track(updated.record);
          }
        }
        const current = await opts.store.get(record.id);
        return {
          ok: true as const,
          canceledSessionIds,
          pendingSessionIds,
          lifecycleState: current?.state === 'canceled' ? 'canceled' as const : 'cancel-pending' as const
        };
      });
    },
    reconcileModernWorkers(observations: readonly TeamModernWorkerObservation[]): Promise<TeamModernReconcileResult> {
      return serialize(async () => {
        const reconciled = await opts.store.reconcileModernWorkers(observations);
        for (const record of reconciled.records) track(record);
        for (const authorizationId of reconciled.releasedAuthorizationIds) opts.releaseCapacity(authorizationId);
        return reconciled;
      });
    },
    getTeamLaunch(callerPrincipalId: string, launchRequestId: string) {
      return serialize(async () => {
        const record = await opts.store.findRequest(callerPrincipalId, launchRequestId);
        return record ? { ok: true as const, record } : { ok: false as const, code: 'NOT_FOUND' as const };
      });
    },
    reportTeamTask(
      callerPrincipalId: string,
      launchRequestId: string,
      slotId: string,
      outcome: 'complete' | 'failed'
    ) {
      return serialize(async () => {
        const record = await opts.store.findRequest(callerPrincipalId, launchRequestId);
        if (!record || !record.workers.some((worker) => worker.slotId === slotId)) {
          return { ok: false as const, code: 'NOT_FOUND' as const };
        }
        const updated = await opts.store.updateWorker(record.id, slotId, {
          task: outcome === 'complete' ? 'caller-reported-complete' : 'caller-reported-failed'
        });
        return { ok: true as const, record: updated.record };
      });
    },
    reportWorkerTask(
      workerSessionId: string,
      launchRequestId: string,
      slotId: string,
      outcome: 'complete' | 'failed'
    ) {
      return serialize(async () => {
        const record = (await opts.store.list()).find((candidate) => candidate.launchRequestId === launchRequestId || candidate.id === launchRequestId);
        const worker = record?.workers.find((candidate) => candidate.slotId === slotId && candidate.sessionId === workerSessionId);
        if (!record || !worker) return { ok: false as const, code: 'NOT_FOUND' as const };
        const updated = await opts.store.updateWorker(record.id, slotId, {
          task: outcome === 'complete' ? 'caller-reported-complete' : 'caller-reported-failed'
        });
        return { ok: true as const, record: updated.record };
      });
    },
    reconcileStartup(recoveredSessionIds: readonly string[]): Promise<void> {
      return serialize(async () => {
        const recovered = new Set(recoveredSessionIds);
        const before = await opts.store.list();
        const releasable = new Map(before.flatMap((record) => record.workers
          .filter((worker) => (worker.transport ?? 'CLI') !== 'MODERN' && (worker.sessionId === undefined || !recovered.has(worker.sessionId))
            && (worker.process === 'spawning' || worker.process === 'running')
            && !worker.capacityReleased)
          .map((worker) => [`${record.id}\u0000${worker.slotId}`, worker.authorizationId] as const)));
        const reconciled = await opts.store.reconcileStartup(recovered);
        for (const record of reconciled.records) {
          for (const worker of record.workers) {
            const authorizationId = releasable.get(`${record.id}\u0000${worker.slotId}`);
            if (authorizationId && worker.capacityReleased) opts.releaseCapacity(authorizationId);
          }
        }
        for (const record of await opts.store.list()) {
          if (record.capacity) {
            opts.restoreCapacity?.(record.capacity, record.workers
              .filter((worker) => !worker.capacityReleased && worker.sessionId !== undefined)
              .map((worker) => worker.authorizationId));
          }
          track(record);
        }
      });
    }
  };
}

function boundedClaim(input: TeamLifecycleClaimInput): TeamLifecycleClaim {
  if (!input || typeof input !== 'object') throw new Error('invalid team lifecycle claim');
  if (input.workers !== undefined && (!Array.isArray(input.workers) || input.workers.length > MAX_WORKERS)) throw new Error('invalid team lifecycle workers');
  const launchRequestId = boundedString(input.launchRequestId, 'launch request id');
  const launchResult = input.launchResult ? boundedLaunchResult(input.launchResult) : emptyLaunchResult(launchRequestId);
  if (launchResult.launchRequestId !== launchRequestId) throw new Error('launch result request id mismatch');
  const workers = (input.workers ?? []).map(boundedWorker);
  validateClaimWorkers(launchResult, workers);
  if (workers.some((worker) => worker.transport === 'MODERN') && input.capacity
    && (input.capacity.launched < workers.length
      || workers.filter((worker) => !terminalProcesses.has(worker.process)).length > input.capacity.principal.maxConcurrent)) {
    throw new Error('team lifecycle modern worker capacity exhausted');
  }
  return {
    callerPrincipalId: boundedString(input.callerPrincipalId, 'caller principal id'),
    launchRequestId,
    payloadDigest: boundedString(input.payloadDigest, 'payload digest'),
    ...(input.retainOrchestrator === undefined ? {} : { retainOrchestrator: input.retainOrchestrator }),
    ...(input.capacity ? { capacity: boundedCapacity(input.capacity) } : {}),
    launchResult,
    workers
  };
}

function boundedCapacity(value: TeamRunCapacity): TeamRunCapacity {
  if (!value || typeof value !== 'object' || value.principal?.kind !== 'team'
    || !Number.isInteger(value.launched) || value.launched < 0
    || !Number.isInteger(value.principal.maxConcurrent) || value.principal.maxConcurrent < 1
    || !Number.isInteger(value.principal.maxLaunchesPerRun) || value.principal.maxLaunchesPerRun < 1
    || value.launched > value.principal.maxLaunchesPerRun
    || !Array.isArray(value.principal.allowedProjectIds) || !Array.isArray(value.principal.allowedTeamIds)) {
    throw new Error('invalid team run capacity');
  }
  return clone(value);
}

function boundedLaunchRequestId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEAM_LAUNCH_REQUEST_ID_LENGTH) {
    throw new Error('invalid launch request id');
  }
  return value;
}

function boundedRequestSlot(value: unknown): TeamLaunchRequestSlot {
  if (!value || typeof value !== 'object') throw new Error('invalid team launch slot');
  const slot = value as Partial<TeamLaunchRequestSlot>;
  return {
    slotId: boundedString(slot.slotId, 'slot id'),
    authorizationId: boundedString(slot.authorizationId, 'authorization id'),
    ...(slot.authorizationBinding === undefined ? {} : { authorizationBinding: boundedString(slot.authorizationBinding, 'authorization binding') }),
    initialTask: boundedInitialTask(slot.initialTask)
  };
}

function boundedInitialTask(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > MAX_TEAM_INITIAL_TASK_BYTES) {
    throw new Error('invalid initial task');
  }
  return value;
}

function boundedLaunchPolicy(value: unknown): TeamLaunchPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid team launch policy');
  const policy = value as Record<string, unknown>;
  if (Object.keys(policy).some((key) => key !== 'deadlineMs')) throw new Error('invalid team launch policy');
  if (policy.deadlineMs === undefined) return {};
  if (!Number.isInteger(policy.deadlineMs) || Number(policy.deadlineMs) < 1
    || Number(policy.deadlineMs) > MAX_TEAM_LAUNCH_DEADLINE_MS) {
    throw new Error('invalid team launch deadline');
  }
  return { deadlineMs: Number(policy.deadlineMs) };
}

function validateClaimWorkers(
  launchResult: TeamLaunchResult,
  workers: Array<Omit<TeamLifecycleWorker, 'capacityReleased'>>
): void {
  if (launchResult.launched !== launchResult.workers.length || workers.length !== launchResult.workers.length) {
    throw new Error('team lifecycle workers do not match launch result');
  }
  const launchKeys = new Set<string>();
  const workerKeys = new Set<string>();
  const launchSlotIds = new Set<string>();
  const launchSessionIds = new Set<string>();
  const launchAuthorizationIds = new Set<string>();
  const workerSlotIds = new Set<string>();
  const workerSessionIds = new Set<string>();
  const workerAuthorizationIds = new Set<string>();
  for (const worker of launchResult.workers) {
    const key = identityKey(worker);
    if (worker.cohortId !== launchResult.cohortId
      || hasOrAdd(launchSlotIds, worker.slotId)
      || hasOrAdd(launchSessionIds, worker.sessionId)
      || hasOrAdd(launchAuthorizationIds, worker.authorizationId)) {
      throw new Error('duplicate team lifecycle worker');
    }
    launchKeys.add(key);
  }
  for (const worker of workers) {
    const key = identityKey(worker);
    if (worker.cohortId !== launchResult.cohortId
      || hasOrAdd(workerSlotIds, worker.slotId)
      || (worker.sessionId !== undefined && hasOrAdd(workerSessionIds, worker.sessionId))
      || hasOrAdd(workerAuthorizationIds, worker.authorizationId)) {
      throw new Error('duplicate team lifecycle worker');
    }
    workerKeys.add(key);
  }
  if ([...launchKeys].some((key) => !workerKeys.has(key))) {
    throw new Error('team lifecycle workers do not match launch result');
  }
}

function identityKey(worker: Omit<TeamLaunchedWorker, 'sessionId'> & { sessionId?: string }): string {
  return [worker.slotId, worker.sessionId ?? '', worker.cohortId, worker.personaId, worker.projectId, worker.authorizationId].join('\u0000');
}

function hasOrAdd(values: Set<string>, value: string): boolean {
  if (values.has(value)) return true;
  values.add(value);
  return false;
}

function isActiveRecord(record: TeamLifecycleRecord): boolean {
  return record.outcome.status === 'in-progress'
    || record.workers.some((worker) => !terminalProcesses.has(worker.process));
}

function boundedLaunchResult(result: TeamLaunchResult): TeamLaunchResult {
  if (!result || typeof result !== 'object' || !Number.isInteger(result.launched) || result.launched < 0
    || !Array.isArray(result.workers) || result.workers.length > MAX_WORKERS
    || !Array.isArray(result.failedSlots) || result.failedSlots.length > MAX_FAILED_SLOTS) {
    throw new Error('invalid team launch result');
  }
  return {
    launchRequestId: boundedString(result.launchRequestId, 'result launch request id'),
    launched: result.launched,
    cohortId: boundedString(result.cohortId, 'cohort id'),
    workers: result.workers.map(boundedIdentity),
    failedSlots: result.failedSlots.map((slot) => ({
      slotId: boundedString(slot.slotId, 'failed slot id'),
      personaId: boundedString(slot.personaId, 'failed persona id'),
      reason: boundedString(slot.reason, 'failure reason')
    })),
    ...(result.orchestratorSessionId === undefined ? {} : {
      orchestratorSessionId: boundedString(result.orchestratorSessionId, 'orchestrator session id')
    }),
    ...(result.workerSessionIds === undefined ? {} : {
      workerSessionIds: result.workerSessionIds.map((sessionId) => boundedString(sessionId, 'worker session id'))
    })
  };
}

function emptyLaunchResult(launchRequestId: string): TeamLaunchResult {
  return { launchRequestId, launched: 0, cohortId: 'pending', workers: [], failedSlots: [] };
}

function boundedOperationResult(result: TeamLaunchOperationResult): TeamLaunchOperationResult {
  if (!result || typeof result !== 'object') throw new Error('invalid team launch operation result');
  if (result.ok === true) return { ok: true, value: boundedLaunchResult(result.value) };
  if (result.ok === false) return {
    ok: false,
    code: boundedString(result.code, 'team launch error code'),
    message: boundedString(result.message, 'team launch error message')
  };
  throw new Error('invalid team launch operation result');
}

function boundedIdentity(worker: Omit<TeamLaunchedWorker, 'sessionId'> & { sessionId?: string }): TeamLaunchedWorker {
  if (!worker || typeof worker !== 'object') throw new Error('invalid team worker identity');
  return {
    sessionId: boundedString(worker.sessionId, 'session id'),
    cohortId: boundedString(worker.cohortId, 'worker cohort id'),
    slotId: boundedString(worker.slotId, 'slot id'),
    personaId: boundedString(worker.personaId, 'persona id'),
    projectId: boundedString(worker.projectId, 'project id'),
    authorizationId: boundedString(worker.authorizationId, 'authorization id')
  };
}

function boundedWorker(worker: Omit<TeamLifecycleWorker, 'capacityReleased'>): Omit<TeamLifecycleWorker, 'capacityReleased'> {
  const deferred = worker.process === 'authorized' && worker.sessionId === undefined && worker.transport !== 'MODERN' && worker.onDemand === true;
  const identity = boundedIdentity(deferred ? { ...worker, sessionId: 'deferred' } : worker);
  if (!(worker.process in processTransitions) || (worker.attention !== 'active' && worker.attention !== 'blocked')
    || !(worker.task in taskTransitions) || !(worker.delivery in deliveryTransitions)
    || worker.transport !== undefined && worker.transport !== 'CLI' && worker.transport !== 'MODERN'
    || worker.threadId !== undefined && !isBoundedString(worker.threadId)
    || worker.generation !== undefined && (!Number.isInteger(worker.generation) || worker.generation < 0)
    || worker.bindingState !== undefined && !modernBindingStates.has(worker.bindingState)
    || worker.modernContext !== undefined && !isModernContext(worker.modernContext)
    || worker.transport === 'MODERN' && !isModernWorkerState(worker)
    || worker.transport !== 'MODERN' && (worker.threadId !== undefined || worker.generation !== undefined || worker.bindingState !== undefined || worker.modernContext !== undefined)) {
    throw new Error('invalid team worker lifecycle state');
  }
  const { sessionId: boundSession, ...identityRest } = identity;
  return {
    ...identityRest, ...(deferred ? {} : { sessionId: boundSession }), ...(worker.onDemand === true ? { onDemand: true as const } : {}), process: worker.process, attention: worker.attention, task: worker.task, delivery: worker.delivery,
    ...(worker.transport === undefined ? {} : { transport: worker.transport }),
    ...(worker.threadId === undefined ? {} : { threadId: worker.threadId }),
    ...(worker.generation === undefined ? {} : { generation: worker.generation }),
    ...(worker.bindingState === undefined ? {} : { bindingState: worker.bindingState }),
    ...(worker.modernContext === undefined ? {} : { modernContext: boundedModernContext(worker.modernContext) })
  };
}

function boundedModernContext(context: TeamModernBindingContext): TeamModernBindingContext {
  if (!isModernContext(context)) throw new Error('invalid modern team binding context');
  return clone(context);
}

function isModernContext(value: unknown): value is TeamModernBindingContext {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<TeamModernBindingContext>;
  return isBoundedString(context.teamId)
    && isBoundedString(context.cohortId)
    && (context.role === 'worker' || context.role === 'orchestrator')
    && isBoundedString(context.projectId) && isBoundedString(context.hostId) && isBoundedString(context.providerId)
    && (context.workspaceEnvironmentId === undefined || isBoundedString(context.workspaceEnvironmentId))
    && isBoundedString(context.worktreePath)
    && !!context.personaSnapshot && isBoundedString(context.personaSnapshot.id) && isBoundedString(context.personaSnapshot.profile)
    && [context.personaSnapshot.model, context.personaSnapshot.reasoningLevel, context.personaSnapshot.permissionMode]
      .every((field) => field === undefined || isBoundedString(field))
    && (context.personaSnapshot.systemPrompt === undefined || typeof context.personaSnapshot.systemPrompt === 'string'
      && Buffer.byteLength(context.personaSnapshot.systemPrompt, 'utf8') <= MAX_TEAM_INITIAL_TASK_BYTES)
    && (context.executionId === undefined || isBoundedString(context.executionId))
    && Object.keys(context).every((key) => ['teamId', 'cohortId', 'role', 'projectId', 'hostId', 'providerId',
      'workspaceEnvironmentId', 'worktreePath', 'personaSnapshot', 'executionId'].includes(key))
    && Object.keys(context.personaSnapshot).every((key) => ['id', 'profile', 'model', 'reasoningLevel', 'permissionMode', 'systemPrompt'].includes(key));
}

function isModernWorkerState(worker: Partial<TeamLifecycleWorker>): boolean {
  if (!isModernContext(worker.modernContext) || worker.modernContext.projectId !== worker.projectId
    || worker.modernContext.cohortId !== worker.cohortId || worker.modernContext.personaSnapshot.id !== worker.personaId
    || !Number.isSafeInteger(worker.generation) || !worker.bindingState) return false;
  if (worker.bindingState === 'RESERVED') return worker.generation === 0 && worker.threadId === undefined && worker.process === 'authorized';
  if (worker.bindingState === 'TERMINAL' && worker.generation === 0) return worker.threadId === undefined && terminalProcesses.has(worker.process!);
  if (Number(worker.generation) < 1 || !isModernThreadId(worker.threadId)) return false;
  return worker.bindingState === 'CREATING' || worker.bindingState === 'RESUMING' ? worker.process === 'spawning'
    : worker.bindingState === 'BOUND' ? worker.process === 'running'
      : worker.bindingState === 'UNCERTAIN' ? worker.process === 'spawning' || worker.process === 'running'
        : worker.bindingState === 'TERMINAL' && terminalProcesses.has(worker.process!);
}

function isModernThreadId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function boundedModernThreadId(value: unknown): string {
  if (!isModernThreadId(value)) throw new Error('invalid modern thread id');
  return value;
}

function validateModernGeneration(generation: number): void {
  if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('invalid modern worker generation');
}

function boundedModernReference(reference: TeamModernWorkerReference): TeamModernWorkerReference {
  validateModernGeneration(reference.generation);
  return { recordId: boundedString(reference.recordId, 'record id'), slotId: boundedString(reference.slotId, 'slot id'),
    generation: reference.generation, threadId: boundedModernThreadId(reference.threadId) };
}

function matchesModernReference(worker: TeamLifecycleWorker | undefined, reference: TeamModernWorkerReference): worker is TeamLifecycleWorker {
  return worker?.transport === 'MODERN' && worker.generation === reference.generation && worker.threadId === reference.threadId
    && !worker.capacityReleased && !terminalProcesses.has(worker.process);
}

function assertUniqueModernThread(state: TeamLifecycleStateFile, worker: Omit<TeamLifecycleWorker, 'capacityReleased'>): void {
  // A resumed binding reuses the thread of prior, fully retired workers for the SAME
  // team/project/slot at any lower generation (repeat resumes leave gen 1, 2, ... all TERMINAL); every other holder collides.
  const retired = (candidate: Omit<TeamLifecycleWorker, 'capacityReleased'>) => worker.bindingState === 'RESUMING'
    && candidate.bindingState === 'TERMINAL' && terminalProcesses.has(candidate.process)
    && candidate.modernContext !== undefined && worker.modernContext !== undefined
    && candidate.modernContext.teamId === worker.modernContext.teamId
    && candidate.modernContext.projectId === worker.modernContext.projectId
    && candidate.slotId === worker.slotId
    && typeof worker.generation === 'number' && typeof candidate.generation === 'number' && candidate.generation < worker.generation;
  if (worker.transport === 'MODERN' && worker.threadId && state.records.some((record) => record.workers.some((candidate) =>
    candidate !== worker && !retired(candidate) && (candidate.threadId === worker.threadId || candidate.sessionId === worker.threadId)))) {
    throw new Error('duplicate modern thread identity');
  }
}

function validateUpdate(update: TeamWorkerUpdate): void {
  if (!update || typeof update !== 'object' || Object.keys(update).length === 0
    || Object.keys(update).some((key) => !['process', 'attention', 'task', 'delivery', 'exitCode', 'exitSignal', 'exitReason'].includes(key))
    || update.process !== undefined && !(update.process in processTransitions)
    || update.attention !== undefined && update.attention !== 'active' && update.attention !== 'blocked'
    || update.task !== undefined && !(update.task in taskTransitions)
    || update.delivery !== undefined && !(update.delivery in deliveryTransitions)
    || update.exitCode !== undefined && !Number.isInteger(update.exitCode)
    || update.exitSignal !== undefined && !Number.isInteger(update.exitSignal)
    || update.exitReason !== undefined && !isBoundedString(update.exitReason)) {
    throw new Error('invalid team worker update');
  }
}

function boundedString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_STRING_LENGTH) {
    throw new Error(`invalid ${field}`);
  }
  return value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * A seat that has not started has no session id, and an older app rejects the whole file for a
 * worker without one. Keep such seats under their own record key, which an older loader ignores,
 * and put them back among the workers when the file is read.
 */
function splitDeferredSeats(state: TeamLifecycleStateFile): unknown {
  return {
    ...state,
    records: state.records.map((record) => {
      const seats = record.workers.filter((worker) => worker.sessionId === undefined);
      if (seats.length === 0) return record;
      return { ...record, workers: record.workers.filter((worker) => worker.sessionId !== undefined), deferredSeats: seats };
    })
  };
}

function mergeDeferredSeats(value: unknown): unknown {
  const state = value as { records?: unknown };
  if (!state || typeof state !== 'object' || !Array.isArray(state.records)) return value;
  return {
    ...state,
    records: state.records.map((record: unknown) => {
      const entry = record as { workers?: unknown; deferredSeats?: unknown };
      if (!entry || typeof entry !== 'object' || entry.deferredSeats === undefined) return record;
      const { deferredSeats, ...rest } = entry;
      return { ...rest, workers: [...(Array.isArray(entry.workers) ? entry.workers : []), ...(Array.isArray(deferredSeats) ? deferredSeats : [])] };
    })
  };
}

function isState(value: unknown): value is TeamLifecycleStateFile {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<TeamLifecycleStateFile>;
  return state.version === 1 && Number.isInteger(state.revision) && Array.isArray(state.records)
    && state.records.every(isRecord);
}

function isRecord(value: unknown): value is TeamLifecycleRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<TeamLifecycleRecord>;
  return isBoundedString(record.id) && isBoundedString(record.callerPrincipalId)
    && isBoundedString(record.launchRequestId) && isBoundedString(record.payloadDigest)
    && (record.retainOrchestrator === undefined || typeof record.retainOrchestrator === 'boolean')
    && isOutcome(record.outcome) && (record.capacity === undefined || isCapacity(record.capacity))
    && (record.state === 'active' || record.state === 'cancel-pending' || record.state === 'canceled')
    && Number.isInteger(record.revision) && typeof record.createdAt === 'number' && typeof record.updatedAt === 'number'
    && isLaunchResult(record.launchResult) && Array.isArray(record.workers)
    && record.workers.length <= MAX_WORKERS && record.workers.every(isWorker);
}

function isCapacity(value: unknown): value is TeamRunCapacity {
  if (!value || typeof value !== 'object') return false;
  const capacity = value as Partial<TeamRunCapacity>;
  const principal = capacity.principal;
  return principal?.kind === 'team' && isBoundedString(principal.id)
    && Array.isArray(principal.allowedProjectIds) && principal.allowedProjectIds.every(isBoundedString)
    && Array.isArray(principal.allowedTeamIds) && principal.allowedTeamIds.every(isBoundedString)
    && Number.isInteger(principal.maxConcurrent) && Number(principal.maxConcurrent) > 0
    && Number.isInteger(principal.maxLaunchesPerRun) && Number(principal.maxLaunchesPerRun) > 0
    && Number.isInteger(capacity.launched) && Number(capacity.launched) >= 0
    && Number(capacity.launched) <= Number(principal.maxLaunchesPerRun);
}

function isOutcome(value: unknown): value is TeamLifecycleRecord['outcome'] {
  if (!value || typeof value !== 'object') return false;
  const outcome = value as { status?: unknown; result?: unknown };
  if (outcome.status === 'in-progress') return true;
  if (outcome.status !== 'completed' || !outcome.result || typeof outcome.result !== 'object') return false;
  const result = outcome.result as Partial<TeamLaunchOperationResult>;
  return result.ok === true ? isLaunchResult(result.value)
    : result.ok === false && isBoundedString(result.code) && isBoundedString(result.message);
}

function isLaunchResult(value: unknown): value is TeamLaunchResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<TeamLaunchResult>;
  return isBoundedString(result.launchRequestId) && Number.isInteger(result.launched) && Number(result.launched) >= 0
    && isBoundedString(result.cohortId) && Array.isArray(result.workers) && result.workers.length <= MAX_WORKERS
    && result.workers.every(isIdentity) && Array.isArray(result.failedSlots) && result.failedSlots.length <= MAX_FAILED_SLOTS
    && (result.orchestratorSessionId === undefined || isBoundedString(result.orchestratorSessionId))
    && (result.workerSessionIds === undefined || Array.isArray(result.workerSessionIds) && result.workerSessionIds.every(isBoundedString))
    && result.failedSlots.every((slot) => !!slot && typeof slot === 'object'
      && isBoundedString((slot as Partial<TeamFailedWorkerSlot>).slotId)
      && isBoundedString((slot as Partial<TeamFailedWorkerSlot>).personaId)
      && isBoundedString((slot as Partial<TeamFailedWorkerSlot>).reason));
}

function isIdentity(value: unknown): value is TeamLaunchedWorker {
  if (!value || typeof value !== 'object') return false;
  const worker = value as Partial<TeamLaunchedWorker>;
  return isBoundedString(worker.sessionId) && isBoundedString(worker.cohortId) && isBoundedString(worker.slotId)
    && isBoundedString(worker.personaId) && isBoundedString(worker.projectId) && isBoundedString(worker.authorizationId);
}

/** A seat that starts on demand and has not started: authorized, CLI, no session. */
function isDeferredWorker(worker: TeamLifecycleWorker | undefined): worker is TeamLifecycleWorker & { sessionId: undefined } {
  return worker?.process === 'authorized' && worker.sessionId === undefined && worker.transport !== 'MODERN' && worker.onDemand === true;
}

/** Workers spawn while the launch is in progress, or later for a seat that starts on demand. */
function launchAllowsSpawn(record: TeamLifecycleRecord, worker: TeamLifecycleWorker): boolean {
  return record.outcome.status === 'in-progress'
    || worker.onDemand === true && record.outcome.status === 'completed' && record.outcome.result.ok === true;
}

function isWorker(value: unknown): value is TeamLifecycleWorker {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TeamLifecycleWorker>;
  // A seat that starts on demand has no session until it starts, and none if it never does.
  const deferred = candidate.sessionId === undefined && candidate.transport !== 'MODERN' && candidate.onDemand === true
    && (candidate.process === 'authorized' || candidate.process === 'spawning'
      || candidate.process === 'spawn-failed' || candidate.process === 'canceled');
  if (candidate.onDemand !== undefined && candidate.onDemand !== true) return false;
  if (!deferred && !isIdentity(value)) return false;
  if (deferred && !isIdentity({ ...value, sessionId: 'deferred' })) return false;
  const worker = value as Partial<TeamLifecycleWorker>;
  const transport = worker.transport ?? 'CLI';
  return typeof worker.process === 'string' && worker.process in processTransitions
    && (worker.attention === 'active' || worker.attention === 'blocked')
    && typeof worker.task === 'string' && worker.task in taskTransitions
    && typeof worker.delivery === 'string' && worker.delivery in deliveryTransitions
    && typeof worker.capacityReleased === 'boolean'
    && worker.capacityReleased === terminalProcesses.has(worker.process)
    && (transport === 'CLI' || transport === 'MODERN')
    && (transport === 'MODERN'
      ? isModernWorkerState(worker)
      : worker.threadId === undefined && worker.generation === undefined && worker.bindingState === undefined && worker.modernContext === undefined);
}

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING_LENGTH;
}
