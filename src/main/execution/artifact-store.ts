import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  atomicDurableWrite,
  createSerializedTransactionQueue,
  hashBytes,
  readRawFile
} from '../harness-routing-migration/storage.js';

export interface ExecutionArtifactRecord {
  id: string;
  executionId: string;
  attempt: number;
  projectId: string;
  name: string;
  mediaType: string;
  contentDigest: string;
  content: string;
  createdAt: number;
}

interface ArtifactStateFile {
  version: 1;
  revision: number;
  records: ExecutionArtifactRecord[];
}

export interface ArtifactStoreOptions {
  filePath: string;
  now?: () => number;
  id?: () => string;
  maxRecords?: number;
}

const MAX_RECORDS = 5_000;
export const EXECUTION_ARTIFACT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_CONTENT_BYTES = 64 * 1024;
const MAX_STRING = 512;
const queue = createSerializedTransactionQueue();

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function string(value: unknown, label: string, max = MAX_STRING): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`invalid execution artifact ${label}`);
  return value;
}

function validRecord(value: unknown): value is ExecutionArtifactRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ExecutionArtifactRecord>;
  return typeof record.id === 'string' && typeof record.executionId === 'string'
    && typeof record.projectId === 'string' && typeof record.name === 'string'
    && typeof record.mediaType === 'string' && typeof record.contentDigest === 'string'
    && typeof record.content === 'string' && Number.isInteger(record.attempt) && typeof record.createdAt === 'number'
    && Buffer.byteLength(record.content, 'utf8') <= MAX_CONTENT_BYTES;
}

export function contentDigest(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

export function createExecutionArtifactStore(options: ArtifactStoreOptions) {
  if (options.maxRecords !== undefined && (!Number.isInteger(options.maxRecords) || options.maxRecords < 1)) {
    throw new Error('invalid execution artifact max records');
  }
  const now = options.now ?? Date.now;
  const id = options.id ?? randomUUID;
  const maxRecords = Math.min(options.maxRecords ?? MAX_RECORDS, MAX_RECORDS);

  function read(): { state: ArtifactStateFile; hash: string | null } {
    const bytes = readRawFile(options.filePath);
    if (!bytes) return { state: { version: 1, revision: 0, records: [] }, hash: null };
    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as Partial<ArtifactStateFile>;
      if (parsed.version !== 1 || !Number.isInteger(parsed.revision) || !Array.isArray(parsed.records) || !parsed.records.every(validRecord)) {
        throw new Error('invalid shape');
      }
      return { state: parsed as ArtifactStateFile, hash: hashBytes(bytes) };
    } catch (error) {
      throw new Error(`corrupt execution artifact store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function persist(state: ArtifactStateFile, expectedHash: string | null): void {
    const protectedRecords = state.records.filter((record) => now() - record.createdAt < EXECUTION_ARTIFACT_RETENTION_MS);
    if (maxRecords === MAX_RECORDS && protectedRecords.length > maxRecords) {
      throw new Error('execution retention pressure: protected artifacts exceed storage limit');
    }
    const oldRecords = state.records.filter((record) => now() - record.createdAt >= EXECUTION_ARTIFACT_RETENTION_MS).slice(-maxRecords);
    state.records = [...protectedRecords, ...oldRecords].sort((left, right) => left.createdAt - right.createdAt);
    state.revision += 1;
    mkdirSync(dirname(options.filePath), { recursive: true });
    atomicDurableWrite(options.filePath, Buffer.from(JSON.stringify(state)), { expectedHash });
  }

  async function put(input: Omit<ExecutionArtifactRecord, 'id' | 'contentDigest' | 'createdAt'>) {
    const executionId = string(input.executionId, 'execution id');
    const projectId = string(input.projectId, 'project id');
    const name = string(input.name, 'name');
    const mediaType = string(input.mediaType, 'media type');
    const content = string(input.content, 'content', MAX_CONTENT_BYTES);
    if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) throw new Error('invalid execution artifact content');
    if (!Number.isInteger(input.attempt) || input.attempt < 1) throw new Error('invalid execution artifact attempt');
    const digest = contentDigest(content);
    return queue.run(async () => {
      const snapshot = read();
      const existing = snapshot.state.records.find((record) => record.executionId === executionId && record.name === name);
      if (existing) {
        if (existing.contentDigest === digest && existing.attempt === input.attempt && existing.projectId === projectId && existing.mediaType === mediaType) {
          return { outcome: 'replay' as const, record: clone(existing) };
        }
        return { outcome: 'conflict' as const, record: clone(existing) };
      }
      const record: ExecutionArtifactRecord = {
        id: string(id(), 'id'), executionId, projectId, name, mediaType, content, contentDigest: digest,
        attempt: input.attempt, createdAt: now()
      };
      snapshot.state.records.push(record);
      persist(snapshot.state, snapshot.hash);
      return { outcome: 'stored' as const, record: clone(record) };
    });
  }

  async function list(executionId: string, projectId: string): Promise<ExecutionArtifactRecord[]> {
    return queue.run(async () => clone(read().state.records.filter((record) =>
      record.executionId === string(executionId, 'execution id') && record.projectId === string(projectId, 'project id'))));
  }

  async function get(executionId: string, projectId: string, name: string): Promise<ExecutionArtifactRecord | undefined> {
    return queue.run(async () => {
      const record = read().state.records.find((candidate) => candidate.executionId === string(executionId, 'execution id')
        && candidate.projectId === string(projectId, 'project id') && candidate.name === string(name, 'name'));
      return record ? clone(record) : undefined;
    });
  }

  return { put, list, get };
}
