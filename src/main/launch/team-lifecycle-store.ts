import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  atomicDurableWrite,
  createSerializedTransactionQueue,
  hashBytes,
  readRawFile
} from '../harness-routing-migration/storage.js';
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

export interface TeamLifecycleWorker extends TeamLaunchedWorker {
  process: TeamWorkerProcessState;
  attention: TeamWorkerAttentionState;
  task: TeamWorkerTaskState;
  delivery: TeamWorkerDeliveryState;
  capacityReleased: boolean;
}

export interface TeamLifecycleRecord {
  id: string;
  callerPrincipalId: string;
  launchRequestId: string;
  payloadDigest: string;
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
  capacity?: TeamRunCapacity;
  launchResult: TeamLaunchResult;
  workers: Array<Omit<TeamLifecycleWorker, 'capacityReleased'>>;
}

export type TeamLifecycleClaimInput = Pick<TeamLifecycleClaim, 'callerPrincipalId' | 'launchRequestId' | 'payloadDigest'>
  & Partial<Pick<TeamLifecycleClaim, 'launchResult' | 'workers' | 'capacity'>>;

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

export interface TeamWorkerUpdate {
  process?: TeamWorkerProcessState;
  attention?: TeamWorkerAttentionState;
  task?: TeamWorkerTaskState;
  delivery?: TeamWorkerDeliveryState;
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
      const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
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
    durableWrite(opts.filePath, Buffer.from(JSON.stringify(state)), { expectedHash });
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
      const changed = update.process !== undefined && update.process !== worker.process
        || update.attention !== undefined && update.attention !== worker.attention
        || update.task !== undefined && update.task !== worker.task
        || update.delivery !== undefined && update.delivery !== worker.delivery;

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
        record.launchResult = launchResult;
        const existingByIdentity = new Map(record.workers.map((worker) => [identityKey(worker), worker]));
        const resultWorkers: TeamLifecycleWorker[] = launchResult.workers.map((worker) => existingByIdentity.get(identityKey(worker)) ?? ({
          ...worker, process: 'running', attention: 'active', task: 'unknown',
          delivery: 'bound-at-spawn', capacityReleased: false
        }));
        record.workers = record.state === 'cancel-pending'
          ? [...resultWorkers, ...record.workers.filter((worker) =>
              !terminalProcesses.has(worker.process)
              && !launchResult.workers.some((candidate) => identityKey(candidate) === identityKey(worker)))]
          : resultWorkers;
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
      record.state = record.workers.every((worker) => terminalProcesses.has(worker.process)) ? 'canceled' : 'cancel-pending';
      record.revision += 1;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return { ...clone(record), releasedSlotIds: [] };
    });
  }

  async function workerMaySpawn(recordId: string, slotId: string): Promise<boolean> {
    const safeRecordId = boundedString(recordId, 'record id');
    const safeSlotId = boundedString(slotId, 'slot id');
    return runExclusive(async () => {
      const record = readState().state.records.find((candidate) => candidate.id === safeRecordId);
      const worker = record?.workers.find((candidate) => candidate.slotId === safeSlotId);
      return record?.state === 'active' && record.outcome.status === 'in-progress'
        && worker?.process === 'spawning';
    });
  }

  async function claimWorkerRunning(recordId: string, slotId: string): Promise<boolean> {
    const safeRecordId = boundedString(recordId, 'record id');
    const safeSlotId = boundedString(slotId, 'slot id');
    return runExclusive(async () => {
      const snapshot = readState();
      const record = snapshot.state.records.find((candidate) => candidate.id === safeRecordId);
      const worker = record?.workers.find((candidate) => candidate.slotId === safeSlotId);
      if (record?.state !== 'active' || record.outcome.status !== 'in-progress'
        || worker?.process !== 'spawning') return false;
      worker.process = 'running';
      record.revision += 1;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return true;
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
          if (recoveredSessionIds.has(worker.sessionId)) continue;
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
        if (record.outcome.status === 'in-progress') {
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

  return { claim, complete, setLaunchResult, addWorker, updateWorker, workerMaySpawn, claimWorkerRunning, cancel, reconcileStartup, list, get, findRequest };
}

export type TeamLifecycleStore = ReturnType<typeof createTeamLifecycleStore>;

export interface TeamLifecycleIntegrationOptions {
  store: TeamLifecycleStore;
  isLiveSession: (sessionId: string) => boolean;
  closeSession: (sessionId: string) => Promise<boolean>;
  releaseCapacity: (authorizationId: string) => void;
  restoreCapacity?: (capacity: TeamRunCapacity, activeAuthorizationIds: readonly string[]) => void;
}

interface TrackedTeamWorker {
  recordId: string;
  slotId: string;
  authorizationId: string;
  process: TeamWorkerProcessState;
}

export function createTeamLifecycleIntegration(opts: TeamLifecycleIntegrationOptions) {
  const bySession = new Map<string, TrackedTeamWorker>();
  const closeRequested = new Set<string>();
  let pending = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const result = pending.then(task, task);
    pending = result.then(() => undefined, () => undefined);
    return result;
  };
  const track = (record: TeamLifecycleRecord): void => {
    for (const worker of record.workers) {
      if (!terminalProcesses.has(worker.process)) {
        bySession.set(worker.sessionId, {
          recordId: record.id,
          slotId: worker.slotId,
          authorizationId: worker.authorizationId,
          process: worker.process
        });
      } else bySession.delete(worker.sessionId);
    }
  };
  return {
    track,
    isTracked(sessionId: string): boolean {
      return bySession.has(sessionId);
    },
    onSessionExit(sessionId: string): Promise<void> {
      return serialize(async () => {
        const tracked = bySession.get(sessionId);
        if (!tracked) return;
        bySession.delete(sessionId);
        closeRequested.delete(sessionId);
        if (terminalProcesses.has(tracked.process)) return;
        const record = await opts.store.get(tracked.recordId);
        const process = record?.state === 'cancel-pending' || record?.state === 'canceled' ? 'canceled' : 'exited';
        const updated = await opts.store.updateWorker(tracked.recordId, tracked.slotId, { process });
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
    cancelTeamLaunch(callerPrincipalId: string, launchRequestId: string) {
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
        const canceled = await opts.store.cancel(record.id);
        const canceledSessionIds: string[] = [];
        const pendingSessionIds: string[] = [];
        for (const worker of canceled.workers) {
          if (terminalProcesses.has(worker.process)) continue;
          if (closeRequested.has(worker.sessionId)) continue;
          const isLive = opts.isLiveSession(worker.sessionId);
          if (isLive && await opts.closeSession(worker.sessionId)) {
            closeRequested.add(worker.sessionId);
            canceledSessionIds.push(worker.sessionId);
          } else if (isLive) {
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
          .filter((worker) => !recovered.has(worker.sessionId)
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
              .filter((worker) => !worker.capacityReleased)
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
  return {
    callerPrincipalId: boundedString(input.callerPrincipalId, 'caller principal id'),
    launchRequestId,
    payloadDigest: boundedString(input.payloadDigest, 'payload digest'),
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
      || hasOrAdd(workerSessionIds, worker.sessionId)
      || hasOrAdd(workerAuthorizationIds, worker.authorizationId)) {
      throw new Error('duplicate team lifecycle worker');
    }
    workerKeys.add(key);
  }
  if ([...launchKeys].some((key) => !workerKeys.has(key))) {
    throw new Error('team lifecycle workers do not match launch result');
  }
}

function identityKey(worker: TeamLaunchedWorker): string {
  return [worker.slotId, worker.sessionId, worker.cohortId, worker.personaId, worker.projectId, worker.authorizationId].join('\u0000');
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

function boundedIdentity(worker: TeamLaunchedWorker): TeamLaunchedWorker {
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
  const identity = boundedIdentity(worker);
  if (!(worker.process in processTransitions) || (worker.attention !== 'active' && worker.attention !== 'blocked')
    || !(worker.task in taskTransitions) || !(worker.delivery in deliveryTransitions)) {
    throw new Error('invalid team worker lifecycle state');
  }
  return { ...identity, process: worker.process, attention: worker.attention, task: worker.task, delivery: worker.delivery };
}

function validateUpdate(update: TeamWorkerUpdate): void {
  if (!update || typeof update !== 'object' || Object.keys(update).length === 0
    || Object.keys(update).some((key) => !['process', 'attention', 'task', 'delivery'].includes(key))
    || update.process !== undefined && !(update.process in processTransitions)
    || update.attention !== undefined && update.attention !== 'active' && update.attention !== 'blocked'
    || update.task !== undefined && !(update.task in taskTransitions)
    || update.delivery !== undefined && !(update.delivery in deliveryTransitions)) {
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

function isWorker(value: unknown): value is TeamLifecycleWorker {
  if (!isIdentity(value)) return false;
  const worker = value as Partial<TeamLifecycleWorker>;
  return typeof worker.process === 'string' && worker.process in processTransitions
    && (worker.attention === 'active' || worker.attention === 'blocked')
    && typeof worker.task === 'string' && worker.task in taskTransitions
    && typeof worker.delivery === 'string' && worker.delivery in deliveryTransitions
    && typeof worker.capacityReleased === 'boolean'
    && worker.capacityReleased === terminalProcesses.has(worker.process);
}

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING_LENGTH;
}
