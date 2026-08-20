import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { atomicDurableWrite, createSerializedTransactionQueue, hashBytes, readRawFile } from '../harness-routing-migration/storage.js';
import type { ExecutionState } from './store.js';

export interface ResumeGrantV1 {
  version: 1;
  executionId: string;
  projectId: string;
  callerPrincipalId: string;
  tokenDigest: string;
  mintedAt: number;
  expiresAt: number;
  boundOwnerPrincipalId?: string;
  boundAt?: number;
  consumedAt?: number;
  revokedAt?: number;
}

interface StateFile { version: 1; revision: number; grants: ResumeGrantV1[]; }

const queue = createSerializedTransactionQueue();
const MAX_GRANTS = 2_000;
const MAX_STRING = 2_048;

export const RESUME_GRANT_TTL_MS = 24 * 60 * 60 * 1000;

export function isResumeGrantTerminal(state: ExecutionState): boolean {
  return state === 'COMPLETED' || state === 'STOPPED' || state === 'FAILED';
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_STRING) throw new Error(`invalid execution resume grant ${label}`);
  return value;
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validGrant(value: unknown): value is ResumeGrantV1 {
  if (!value || typeof value !== 'object') return false;
  const grant = value as Partial<ResumeGrantV1>;
  return grant.version === 1 && typeof grant.executionId === 'string' && typeof grant.projectId === 'string'
    && typeof grant.callerPrincipalId === 'string' && typeof grant.tokenDigest === 'string'
    && typeof grant.mintedAt === 'number' && typeof grant.expiresAt === 'number'
    && (grant.boundOwnerPrincipalId === undefined || typeof grant.boundOwnerPrincipalId === 'string')
    && (grant.boundAt === undefined || typeof grant.boundAt === 'number')
    && (grant.consumedAt === undefined || typeof grant.consumedAt === 'number')
    && (grant.revokedAt === undefined || typeof grant.revokedAt === 'number');
}

export function createResumeGrantStore(options: { filePath: string; now?: () => number; token?: () => string }) {
  const now = options.now ?? Date.now;
  const token = options.token ?? randomUUID;

  function read(): { state: StateFile; hash: string | null } {
    const bytes = readRawFile(options.filePath);
    if (!bytes) return { state: { version: 1, revision: 0, grants: [] }, hash: null };
    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as Partial<StateFile>;
      if (parsed.version !== 1 || !Number.isInteger(parsed.revision) || !Array.isArray(parsed.grants) || !parsed.grants.every(validGrant)) throw new Error('invalid shape');
      return { state: parsed as StateFile, hash: hashBytes(bytes) };
    } catch (error) {
      throw new Error(`corrupt execution resume grant store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function persist(state: StateFile, expectedHash: string | null): void {
    const timestamp = now();
    state.grants = state.grants.filter((grant) => grant.expiresAt > timestamp).slice(-MAX_GRANTS);
    state.revision += 1;
    mkdirSync(dirname(options.filePath), { recursive: true });
    atomicDurableWrite(options.filePath, Buffer.from(JSON.stringify(state)), { expectedHash });
  }

  async function mint(input: { executionId: string; projectId: string; callerPrincipalId: string; expiresAt?: number }) {
    const executionId = string(input.executionId, 'execution id');
    const projectId = string(input.projectId, 'project id');
    const callerPrincipalId = string(input.callerPrincipalId, 'caller principal id');
    const expiresAt = input.expiresAt ?? now() + RESUME_GRANT_TTL_MS;
    if (!Number.isFinite(expiresAt) || expiresAt <= now()) throw new Error('invalid execution resume grant expiry');
    return queue.run(async () => {
      const snapshot = read();
      const rawToken = string(token(), 'token');
      const grant: ResumeGrantV1 = {
        version: 1, executionId, projectId, callerPrincipalId, tokenDigest: digest(rawToken), mintedAt: now(), expiresAt
      };
      snapshot.state.grants.push(grant);
      persist(snapshot.state, snapshot.hash);
      return { token: rawToken, expiresAt: grant.expiresAt };
    });
  }

  async function consume(input: { token: string; executionId: string; projectId: string; effectiveOwnerPrincipalId: string }) {
    const rawToken = string(input.token, 'token');
    const executionId = string(input.executionId, 'execution id');
    const projectId = string(input.projectId, 'project id');
    const effectiveOwnerPrincipalId = string(input.effectiveOwnerPrincipalId, 'effective owner principal id');
    return queue.run(async () => {
      const snapshot = read();
      const grant = snapshot.state.grants.find((candidate) => candidate.tokenDigest === digest(rawToken));
      if (!grant || grant.executionId !== executionId || grant.projectId !== projectId || grant.revokedAt !== undefined || grant.expiresAt <= now()) {
        throw new Error('execution resume grant is not current');
      }
      if (grant.boundOwnerPrincipalId) {
        if (grant.boundOwnerPrincipalId !== effectiveOwnerPrincipalId) throw new Error('execution resume grant is not current');
        return { outcome: 'recovered' as const, grant: clone(grant) };
      }
      if (grant.consumedAt !== undefined) throw new Error('execution resume grant is not current');
      grant.consumedAt = now();
      grant.boundOwnerPrincipalId = effectiveOwnerPrincipalId;
      grant.boundAt = now();
      persist(snapshot.state, snapshot.hash);
      return { outcome: 'consumed' as const, grant: clone(grant) };
    });
  }

  async function revoke(executionId: string, projectId: string): Promise<void> {
    const safeExecutionId = string(executionId, 'execution id');
    const safeProjectId = string(projectId, 'project id');
    await queue.run(async () => {
      const snapshot = read();
      for (const grant of snapshot.state.grants) {
        if (grant.executionId === safeExecutionId && grant.projectId === safeProjectId && grant.consumedAt === undefined) grant.revokedAt = now();
      }
      persist(snapshot.state, snapshot.hash);
    });
  }

  return { mint, consume, revoke };
}
