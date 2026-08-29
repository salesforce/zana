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
  generation?: number;
}

interface StateFile { version: 1; revision: number; grants: ResumeGrantV1[]; generations: GenerationRecord[]; }

const queue = createSerializedTransactionQueue();
const MAX_GRANTS = 2_000;
const MAX_STRING = 2_048;

export const RESUME_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
    && (grant.revokedAt === undefined || typeof grant.revokedAt === 'number')
    && (grant.generation === undefined || Number.isInteger(grant.generation) && grant.generation >= 0);
}

interface GenerationRecord { executionId: string; projectId: string; generation: number; }

function validGeneration(value: unknown): value is GenerationRecord {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<GenerationRecord>;
  return typeof entry.executionId === 'string' && typeof entry.projectId === 'string'
    && Number.isInteger(entry.generation) && (entry.generation ?? -1) >= 0;
}

export function createResumeGrantStore(options: { filePath: string; now?: () => number; token?: () => string }) {
  const now = options.now ?? Date.now;
  const token = options.token ?? randomUUID;

  function read(): { state: StateFile; hash: string | null } {
    const bytes = readRawFile(options.filePath);
    if (!bytes) return { state: { version: 1, revision: 0, grants: [], generations: [] }, hash: null };
    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as Partial<StateFile>;
      if (Array.isArray(parsed.generations)) {
        const grantMintedAt = new Map((Array.isArray(parsed.grants) ? parsed.grants : [])
          .filter(validGrant)
          .map((grant) => [`${grant.projectId}\u0000${grant.executionId}`, grant.mintedAt]));
        parsed.generations = parsed.generations.map((entry) => entry && typeof entry === 'object' && !('updatedAt' in entry)
          ? { ...entry, updatedAt: grantMintedAt.get(`${(entry as GenerationRecord).projectId}\u0000${(entry as GenerationRecord).executionId}`) ?? 0 }
          : entry) as GenerationRecord[];
      }
      if (!Array.isArray(parsed.generations) && Array.isArray(parsed.grants)) {
        const migrated = new Map<string, GenerationRecord>();
        for (const grant of parsed.grants) {
          if (!validGrant(grant)) continue;
          const key = `${grant.projectId}\u0000${grant.executionId}`;
          const current = migrated.get(key);
          const generation = grant.generation ?? 0;
          if (!current || generation > current.generation) migrated.set(key, { executionId: grant.executionId, projectId: grant.projectId, generation });
        }
        parsed.generations = [...migrated.values()];
      }
      if (parsed.version !== 1 || !Number.isInteger(parsed.revision) || !Array.isArray(parsed.grants) || !parsed.grants.every(validGrant)
        || !Array.isArray(parsed.generations) || !parsed.generations.every(validGeneration)) throw new Error('invalid shape');
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

  async function rotate(input: { executionId: string; projectId: string; callerPrincipalId: string; expectedGeneration: number; expiresAt?: number }) {
    const executionId = string(input.executionId, 'execution id');
    const projectId = string(input.projectId, 'project id');
    const callerPrincipalId = string(input.callerPrincipalId, 'caller principal id');
    if (!Number.isInteger(input.expectedGeneration) || input.expectedGeneration < 0) throw new Error('invalid execution recovery generation');
    const expiresAt = input.expiresAt ?? now() + RESUME_GRANT_TTL_MS;
    if (!Number.isFinite(expiresAt) || expiresAt <= now()) throw new Error('invalid execution resume grant expiry');
    return queue.run(async () => {
      const snapshot = read();
      let generationRecord = snapshot.state.generations.find((entry) => entry.executionId === executionId && entry.projectId === projectId);
      const currentGeneration = generationRecord?.generation ?? 0;
      if (currentGeneration < input.expectedGeneration || currentGeneration > input.expectedGeneration + 1) throw new Error('stale execution recovery generation');
      if (currentGeneration === input.expectedGeneration + 1) {
        const currentGrant = snapshot.state.grants.find((grant) => grant.executionId === executionId && grant.projectId === projectId
          && grant.generation === currentGeneration && grant.revokedAt === undefined);
        if (!currentGrant) throw new Error('stale execution recovery generation');
      }
      const timestamp = now();
      for (const existing of snapshot.state.grants) {
        if (existing.executionId === executionId && existing.projectId === projectId && existing.consumedAt === undefined) existing.revokedAt = timestamp;
      }
      const rawToken = string(token(), 'token');
      const generation = currentGeneration === input.expectedGeneration + 1
        ? currentGeneration
        : currentGeneration + 1;
      const grant: ResumeGrantV1 = {
        version: 1, executionId, projectId, callerPrincipalId, tokenDigest: digest(rawToken), mintedAt: timestamp, expiresAt,
        generation
      };
      if (generationRecord) generationRecord.generation = generation;
      else {
        generationRecord = { executionId, projectId, generation };
        snapshot.state.generations.push(generationRecord);
      }
      snapshot.state.grants.push(grant);
      persist(snapshot.state, snapshot.hash);
      return { token: rawToken, expiresAt: grant.expiresAt, generation };
    });
  }

  async function mint(input: { executionId: string; projectId: string; callerPrincipalId: string; expiresAt?: number }) {
    const executionId = string(input.executionId, 'execution id');
    const projectId = string(input.projectId, 'project id');
    const callerPrincipalId = string(input.callerPrincipalId, 'caller principal id');
    const expiresAt = input.expiresAt ?? now() + RESUME_GRANT_TTL_MS;
    if (!Number.isFinite(expiresAt) || expiresAt <= now()) throw new Error('invalid execution resume grant expiry');
    return queue.run(async () => {
      const snapshot = read();
      const generationRecord = snapshot.state.generations.find((entry) => entry.executionId === executionId && entry.projectId === projectId);
      const generation = generationRecord ? generationRecord.generation + 1 : 0;
      const rawToken = string(token(), 'token');
      const timestamp = now();
      for (const existing of snapshot.state.grants) {
        if (existing.executionId === executionId && existing.projectId === projectId && existing.consumedAt === undefined) existing.revokedAt = timestamp;
      }
      if (generationRecord) generationRecord.generation = generation;
      else snapshot.state.generations.push({ executionId, projectId, generation });
      snapshot.state.grants.push({
        version: 1, executionId, projectId, callerPrincipalId, tokenDigest: digest(rawToken), mintedAt: timestamp, expiresAt, generation
      });
      persist(snapshot.state, snapshot.hash);
      return { token: rawToken, expiresAt, generation };
    });
  }

  async function consume(input: { token: string; executionId: string; projectId: string; effectiveOwnerPrincipalId: string; generation?: number }) {
    const rawToken = string(input.token, 'token');
    const executionId = string(input.executionId, 'execution id');
    const projectId = string(input.projectId, 'project id');
    const effectiveOwnerPrincipalId = string(input.effectiveOwnerPrincipalId, 'effective owner principal id');
    return queue.run(async () => {
      const snapshot = read();
      const grant = snapshot.state.grants.find((candidate) => candidate.tokenDigest === digest(rawToken));
      if (!grant || grant.executionId !== executionId || grant.projectId !== projectId || grant.revokedAt !== undefined || grant.expiresAt <= now()
        || (input.generation !== undefined && grant.generation !== input.generation)) {
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

  async function revokeBound(executionId: string, projectId: string, effectiveOwnerPrincipalId: string): Promise<void> {
    const safeExecutionId = string(executionId, 'execution id');
    const safeProjectId = string(projectId, 'project id');
    const safeOwnerPrincipalId = string(effectiveOwnerPrincipalId, 'effective owner principal id');
    await queue.run(async () => {
      const snapshot = read();
      for (const grant of snapshot.state.grants) {
        if (grant.executionId === safeExecutionId && grant.projectId === safeProjectId
          && grant.boundOwnerPrincipalId === safeOwnerPrincipalId) grant.revokedAt = now();
      }
      persist(snapshot.state, snapshot.hash);
    });
  }

  return { mint, rotate, consume, revoke, revokeBound };
}
