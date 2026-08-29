import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { atomicDurableWrite, createSerializedTransactionQueue, hashBytes, readRawFile } from '../harness-routing-migration/storage.js';

export const EXECUTION_HANDOFF_OPERATION = 'execution.control' as const;
export const EXECUTION_RESUME_MONITOR_OPERATION = 'execution.resume-monitor' as const;
export type ExecutionHandoffOperation = typeof EXECUTION_HANDOFF_OPERATION | typeof EXECUTION_RESUME_MONITOR_OPERATION;

export interface ExecutionHandoffGrant {
  id: string;
  tokenDigest: string;
  sourceOwnerSessionId: string;
  targetSessionId: string;
  projectId: string;
  executionId: string;
  operations: ExecutionHandoffOperation[];
  kind?: 'monitor';
  expiresAt: number;
  usedAt?: number;
  createdAt: number;
}

interface StateFile { version: 1; revision: number; grants: ExecutionHandoffGrant[]; }

const queue = createSerializedTransactionQueue();
const MAX_GRANTS = 2_000;
const MAX_STRING = 2_048;

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_STRING) throw new Error(`invalid execution handoff ${label}`);
  return value;
}
function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
function validGrant(value: unknown): value is ExecutionHandoffGrant {
  if (!value || typeof value !== 'object') return false;
  const grant = value as Partial<ExecutionHandoffGrant>;
  return typeof grant.id === 'string' && typeof grant.tokenDigest === 'string'
    && typeof grant.sourceOwnerSessionId === 'string' && typeof grant.targetSessionId === 'string'
    && typeof grant.projectId === 'string' && typeof grant.executionId === 'string'
    && Array.isArray(grant.operations) && grant.operations.length === 1 && grant.operations.every((operation) => operation === EXECUTION_HANDOFF_OPERATION || operation === EXECUTION_RESUME_MONITOR_OPERATION)
    && (grant.kind === undefined || grant.kind === 'monitor')
    && typeof grant.expiresAt === 'number' && typeof grant.createdAt === 'number'
    && (grant.usedAt === undefined || typeof grant.usedAt === 'number');
}

export function createExecutionHandoffStore(options: { filePath: string; now?: () => number; id?: () => string; token?: () => string }) {
  const now = options.now ?? Date.now;
  const id = options.id ?? randomUUID;
  const token = options.token ?? randomUUID;
  function read(): { state: StateFile; hash: string | null } {
    const bytes = readRawFile(options.filePath);
    if (!bytes) return { state: { version: 1, revision: 0, grants: [] }, hash: null };
    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as Partial<StateFile>;
      if (parsed.version !== 1 || !Number.isInteger(parsed.revision) || !Array.isArray(parsed.grants) || !parsed.grants.every(validGrant)) throw new Error('invalid shape');
      return { state: parsed as StateFile, hash: hashBytes(bytes) };
    } catch (error) {
      throw new Error(`corrupt execution handoff store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  function persist(state: StateFile, expectedHash: string | null): void {
    const timestamp = now();
    state.grants = state.grants.filter((grant) => grant.usedAt === undefined && grant.expiresAt > timestamp).slice(-MAX_GRANTS);
    state.revision += 1;
    mkdirSync(dirname(options.filePath), { recursive: true });
    atomicDurableWrite(options.filePath, Buffer.from(JSON.stringify(state)), { expectedHash });
  }
  async function mint(input: Omit<ExecutionHandoffGrant, 'id' | 'tokenDigest' | 'createdAt' | 'usedAt'>) {
    const bounded = {
      sourceOwnerSessionId: string(input.sourceOwnerSessionId, 'source owner session id'),
      targetSessionId: string(input.targetSessionId, 'target session id'),
      projectId: string(input.projectId, 'project id'),
      executionId: string(input.executionId, 'execution id'),
      operations: input.operations,
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      expiresAt: input.expiresAt
    };
    if (bounded.operations.length !== 1 || (bounded.operations[0] !== EXECUTION_HANDOFF_OPERATION && bounded.operations[0] !== EXECUTION_RESUME_MONITOR_OPERATION) || !Number.isFinite(bounded.expiresAt) || bounded.expiresAt <= now()) {
      throw new Error('invalid execution handoff grant');
    }
    return queue.run(async () => {
      const snapshot = read();
      const rawToken = string(token(), 'token');
      const record: ExecutionHandoffGrant = { id: string(id(), 'id'), tokenDigest: digest(rawToken), ...bounded, createdAt: now() };
      snapshot.state.grants.push(record);
      persist(snapshot.state, snapshot.hash);
      return { token: rawToken, expiresAt: record.expiresAt };
    });
  }
  async function consume(input: { token: string; targetSessionId: string; projectId: string; executionId: string; operation: ExecutionHandoffOperation }) {
    const bounded = {
      token: string(input.token, 'token'), targetSessionId: string(input.targetSessionId, 'target session id'),
      projectId: string(input.projectId, 'project id'), executionId: string(input.executionId, 'execution id'), operation: input.operation
    };
    return queue.run(async () => {
      const snapshot = read();
      const grant = snapshot.state.grants.find((candidate) => candidate.tokenDigest === digest(bounded.token));
      if (!grant || grant.usedAt !== undefined || grant.expiresAt <= now()
        || grant.targetSessionId !== bounded.targetSessionId || grant.projectId !== bounded.projectId
        || grant.executionId !== bounded.executionId || !grant.operations.includes(bounded.operation)) {
        throw new Error('execution handoff is not current');
      }
      grant.usedAt = now();
      persist(snapshot.state, snapshot.hash);
      return clone(grant);
    });
  }
  async function inspect(input: { token: string; targetSessionId: string; projectId: string; executionId: string; operation: ExecutionHandoffOperation }) {
    const bounded = {
      token: string(input.token, 'token'), targetSessionId: string(input.targetSessionId, 'target session id'),
      projectId: string(input.projectId, 'project id'), executionId: string(input.executionId, 'execution id'), operation: input.operation
    };
    return queue.run(async () => {
      const grant = read().state.grants.find((candidate) => candidate.tokenDigest === digest(bounded.token));
      if (!grant || grant.kind !== 'monitor' || grant.usedAt !== undefined || grant.expiresAt <= now()
        || grant.targetSessionId !== bounded.targetSessionId || grant.projectId !== bounded.projectId
        || grant.executionId !== bounded.executionId || !grant.operations.includes(bounded.operation)) {
        throw new Error('execution handoff is not current');
      }
      return clone(grant);
    });
  }
  return { mint, consume, inspect };
}
