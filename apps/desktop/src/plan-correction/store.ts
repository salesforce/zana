import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { atomicDurableWrite, createSerializedTransactionQueue, hashBytes, readRawFile } from '@zana-ai/zcc-server/services/harness-routing/storage';
import { readExecutionSqliteState, writeExecutionSqliteState } from '@zana-ai/zcc-server/services/execution/storage/sqlite-state';
import type { ExecutionDatabase } from '@zana-ai/zcc-db';
import type { ExecutionWorkUnitInput } from '@zana-ai/zcc-server/services/execution/store';
import type { CoordinatorHandoffContext } from '../team-plan-handoff.js';

export type PlanCorrectionStatus = 'correction-required' | 'pending' | 'approved' | 'cancelled';

export interface PlanCorrectionRecord {
  executionId: string;
  ctx: CoordinatorHandoffContext;
  reason: string;
  retries: number;
  status: PlanCorrectionStatus;
  offeredActionId?: string;
  offeredDigest?: string;
  offeredUnits?: ExecutionWorkUnitInput[];
  approvedDigest?: string;
  approvedUnits?: ExecutionWorkUnitInput[];
  /**
   * `register`: the coordinator submits corrections through its bound
   * `execution.plan.register` tool (Modern/ACP), so offered and approved units are
   * the captured submission snapshot rather than a host-reread corrected file.
   */
  channel?: 'register';
}

interface StateFile { version: 1; revision: number; records: PlanCorrectionRecord[]; }

const queue = createSerializedTransactionQueue();
const MAX_RECORDS = 2_000;

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function validContext(value: unknown): value is CoordinatorHandoffContext {
  if (!value || typeof value !== 'object') return false;
  const ctx = value as Partial<CoordinatorHandoffContext>;
  return typeof ctx.sessionId === 'string' && typeof ctx.projectId === 'string'
    && typeof ctx.projectRoot === 'string' && typeof ctx.executionId === 'string' && typeof ctx.slotId === 'string';
}
function validUnit(value: unknown): value is ExecutionWorkUnitInput {
  if (!value || typeof value !== 'object') return false;
  const unit = value as Partial<ExecutionWorkUnitInput>;
  return typeof unit.id === 'string' && typeof unit.title === 'string' && typeof unit.task === 'string' && Array.isArray(unit.dependencies);
}
function validRecord(value: unknown): value is PlanCorrectionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PlanCorrectionRecord>;
  return typeof record.executionId === 'string' && validContext(record.ctx) && record.ctx.executionId === record.executionId
    && typeof record.reason === 'string' && Number.isInteger(record.retries)
    && ['correction-required', 'pending', 'approved', 'cancelled'].includes(record.status ?? '')
    && (record.offeredActionId === undefined || typeof record.offeredActionId === 'string')
    && (record.offeredDigest === undefined || typeof record.offeredDigest === 'string')
    && (record.offeredUnits === undefined || record.offeredUnits.every(validUnit))
    && (record.approvedDigest === undefined || typeof record.approvedDigest === 'string')
    && (record.approvedUnits === undefined || record.approvedUnits.every(validUnit))
    && (record.channel === undefined || record.channel === 'register');
}

/** Durable, execution-keyed consent ledger. Unknown/corrupt state is never treated as approval. */
export interface PlanCorrectionStoreOptions {
  filePath: string;
  database?: ExecutionDatabase;
  maxRecords?: number;
  /**
   * True only when the execution is terminal, not resumable, and so can never
   * consult its correction record again. Consulted only at capacity. Without it
   * (or when it throws or returns false) a record is retained: a missing record
   * authorizes registration, so only provably retired records may be pruned.
   */
  isExecutionRetired?(executionId: string): Promise<boolean>;
}

export function createPlanCorrectionStore(options: PlanCorrectionStoreOptions) {
  const maxRecords = options.maxRecords ?? MAX_RECORDS;
  function read(): { state: StateFile; hash: string | null } {
    const sqlite = readExecutionSqliteState<StateFile>(options.database, 'plan-correction-store');
    if (options.database && !sqlite) return { state: { version: 1, revision: 0, records: [] }, hash: null };
    const bytes = options.database ? null : readRawFile(options.filePath);
    if (!sqlite && !bytes) return { state: { version: 1, revision: 0, records: [] }, hash: null };
    try {
      const parsed = (sqlite?.value ?? JSON.parse(bytes!.toString('utf8'))) as Partial<StateFile>;
      if (parsed.version !== 1 || !Number.isInteger(parsed.revision) || !Array.isArray(parsed.records) || !parsed.records.every(validRecord)) throw new Error('invalid shape');
      return { state: parsed as StateFile, hash: sqlite?.hash ?? hashBytes(bytes!) };
    } catch (error) {
      throw new Error(`corrupt plan correction store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  /** Drop records whose execution can never resume; keep everything else. */
  async function pruneRetired(state: StateFile): Promise<void> {
    const isRetired = options.isExecutionRetired;
    if (!isRetired) return;
    const kept: PlanCorrectionRecord[] = [];
    for (const candidate of state.records) {
      let retired = false;
      try { retired = await isRetired(candidate.executionId); } catch { retired = false; }
      if (!retired) kept.push(candidate);
    }
    state.records = kept;
  }
  async function persist(state: StateFile, expectedHash: string | null): Promise<void> {
    state.revision += 1;
    if (options.database) writeExecutionSqliteState(options.database, 'plan-correction-store', state, expectedHash);
    else {
      await mkdir(dirname(options.filePath), { recursive: true });
      atomicDurableWrite(options.filePath, Buffer.from(JSON.stringify(state)), { expectedHash });
    }
  }
  return {
    async get(executionId: string): Promise<PlanCorrectionRecord | undefined> {
      return queue.run(async () => {
        const record = read().state.records.find((candidate) => candidate.executionId === executionId);
        return record ? clone(record) : undefined;
      });
    },
    async listCancelled(): Promise<PlanCorrectionRecord[]> {
      return queue.run(async () => clone(read().state.records.filter((record) => record.status === 'cancelled')));
    },
    async put(record: PlanCorrectionRecord): Promise<PlanCorrectionRecord> {
      return queue.run(async () => {
        const snapshot = read();
        const index = snapshot.state.records.findIndex((candidate) => candidate.executionId === record.executionId);
        if (index >= 0) {
          const existing = snapshot.state.records[index]!;
          // Cancellation is a durable authorization denial. Never let stale review
          // or approval work overwrite it after the cancellation write commits.
          if (existing.status === 'cancelled' && record.status !== 'cancelled') return clone(existing);
          snapshot.state.records[index] = clone(record);
        }
        else {
          // All correction records gate execution authorization. Eviction would
          // turn a missing record into an authorization bypass, so reject safely.
          if (snapshot.state.records.length >= maxRecords) await pruneRetired(snapshot.state);
          if (snapshot.state.records.length >= maxRecords) throw new Error('plan correction store is at capacity');
          snapshot.state.records.push(clone(record));
        }
        await persist(snapshot.state, snapshot.hash);
        return clone(record);
      });
    }
  };
}
