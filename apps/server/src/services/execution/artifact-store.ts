import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  atomicDurableWrite,
  createSerializedTransactionQueue,
  hashBytes,
  readRawFile
} from '../harness-routing/storage.js';
import type { ExecutionDatabase } from '@zana-ai/zcc-db';
import { readExecutionSqliteState, writeExecutionSqliteState } from './storage/sqlite-state.js';
import { executionStorageBackendForId, type ExecutionStorageBackend } from './storage/backend-policy.js';

export interface ExecutionArtifactRecord {
  id: string;
  executionId: string;
  attempt: number;
  projectId: string;
  name: string;
  mediaType: string;
  contentDigest: string;
  content: string;
  producerRole?: 'worker' | 'orchestrator';
  producerSlotId?: string;
  createdAt: number;
}

interface ArtifactStateFile {
  version: 1;
  revision: number;
  records: ExecutionArtifactRecord[];
}

interface SqliteArtifactRow {
  id: string;
  execution_id: string;
  attempt: number;
  project_id: string;
  name: string;
  media_type: string;
  content_digest: string;
  content: string;
  producer_role: ExecutionArtifactRecord['producerRole'] | null;
  producer_slot_id: string | null;
  created_at: number;
}

export interface ArtifactStoreOptions {
  filePath: string;
  /** Composite execution ledger JSON path used only for backend ownership lookup. */
  executionFilePath?: string;
  database?: ExecutionDatabase;
  now?: () => number;
  id?: () => string;
  maxRecords?: number;
  maxRecordsPerExecution?: number;
}

const MAX_RECORDS = 5_000;
const MAX_RECORDS_PER_EXECUTION = 100;
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
    && (record.producerRole === undefined || record.producerRole === 'worker' || record.producerRole === 'orchestrator')
    && (record.producerSlotId === undefined || typeof record.producerSlotId === 'string')
    && Buffer.byteLength(record.content, 'utf8') <= MAX_CONTENT_BYTES;
}

function fromSqliteRow(row: SqliteArtifactRow): ExecutionArtifactRecord {
  return {
    id: row.id,
    executionId: row.execution_id,
    attempt: row.attempt,
    projectId: row.project_id,
    name: row.name,
    mediaType: row.media_type,
    contentDigest: row.content_digest,
    content: row.content,
    ...(row.producer_role ? { producerRole: row.producer_role } : {}),
    ...(row.producer_slot_id ? { producerSlotId: row.producer_slot_id } : {}),
    createdAt: row.created_at
  };
}

export function contentDigest(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

export function createExecutionArtifactStore(options: ArtifactStoreOptions) {
  if (options.maxRecords !== undefined && (!Number.isInteger(options.maxRecords) || options.maxRecords < 1)) {
    throw new Error('invalid execution artifact max records');
  }
  if (options.maxRecordsPerExecution !== undefined && (!Number.isInteger(options.maxRecordsPerExecution) || options.maxRecordsPerExecution < 1)) {
    throw new Error('invalid execution artifact max records per execution');
  }
  const now = options.now ?? Date.now;
  const id = options.id ?? randomUUID;
  const maxRecords = Math.min(options.maxRecords ?? MAX_RECORDS, MAX_RECORDS);
  const maxRecordsPerExecution = Math.min(options.maxRecordsPerExecution ?? MAX_RECORDS_PER_EXECUTION, MAX_RECORDS_PER_EXECUTION);

  function owner(executionId: string): ExecutionStorageBackend {
    return executionStorageBackendForId({ filePath: options.executionFilePath ?? options.filePath.replace(/(?:\.artifacts|-artifacts)(\.json)?$/, '$1'), database: options.database, executionId });
  }

  // Pre-v2 SQLite stored every artifact body in one aggregate JSON row. Move it
  // atomically before writes, so existing databases retain their durable evidence.
  function migrateLegacySqliteArtifacts(): void {
    const database = options.database!;
    const legacy = readExecutionSqliteState<ArtifactStateFile>(database, 'execution-artifact-store');
    if (!legacy) return;
    const state = legacy.value;
    if (state.version !== 1 || !Number.isInteger(state.revision) || !Array.isArray(state.records) || !state.records.every(validRecord)) {
      throw new Error('corrupt execution artifact store: invalid shape');
    }
    const insert = database.sqlite.prepare(
      `INSERT OR IGNORE INTO execution_artifact_records
       (id, execution_id, attempt, project_id, name, media_type, content_digest, content, producer_role, producer_slot_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const record of state.records) {
      insert.run(record.id, record.executionId, record.attempt, record.projectId, record.name, record.mediaType,
        record.contentDigest, record.content, record.producerRole ?? null, record.producerSlotId ?? null, record.createdAt);
    }
    database.sqlite.prepare('DELETE FROM execution_records WHERE id = ?').run('execution-artifact-store');
  }

  function pruneSqliteRecords(): void {
    // Rank only IDs and timestamps. Artifact bodies remain unread unless returned.
    options.database!.sqlite.prepare(
      `WITH per_execution AS (
         SELECT id, created_at,
                ROW_NUMBER() OVER (PARTITION BY execution_id ORDER BY created_at DESC, id DESC) AS execution_rank
         FROM execution_artifact_records
       ), retained AS (
         SELECT id,
                ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS record_rank
         FROM per_execution
         WHERE execution_rank <= ?
       )
       DELETE FROM execution_artifact_records
       WHERE id NOT IN (SELECT id FROM retained WHERE record_rank <= ?)`
    ).run(maxRecordsPerExecution, maxRecords);
  }

  function read(backend: ExecutionStorageBackend): { state: ArtifactStateFile; hash: string | null } {
    const sqlite = backend === 'sqlite' ? readExecutionSqliteState<ArtifactStateFile>(options.database, 'execution-artifact-store') : null;
    if (backend === 'sqlite' && !sqlite) return { state: { version: 1, revision: 0, records: [] }, hash: null };
    const bytes = backend === 'json' ? readRawFile(options.filePath) : null;
    if (!sqlite && !bytes) return { state: { version: 1, revision: 0, records: [] }, hash: null };
    try {
      const parsed = (sqlite?.value ?? JSON.parse(bytes!.toString('utf8'))) as Partial<ArtifactStateFile>;
      if (parsed.version !== 1 || !Number.isInteger(parsed.revision) || !Array.isArray(parsed.records) || !parsed.records.every(validRecord)) {
        throw new Error('invalid shape');
      }
      return { state: parsed as ArtifactStateFile, hash: sqlite?.hash ?? hashBytes(bytes!) };
    } catch (error) {
      throw new Error(`corrupt execution artifact store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function persist(state: ArtifactStateFile, expectedHash: string | null, backend: ExecutionStorageBackend): Promise<void> {
    const byExecution = new Map<string, ExecutionArtifactRecord[]>();
    for (const record of state.records) {
      const group = byExecution.get(record.executionId) ?? [];
      group.push(record);
      byExecution.set(record.executionId, group);
    }
    state.records = [...byExecution.values()]
      .flatMap((records) => records.slice(-maxRecordsPerExecution))
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(-maxRecords);
    state.revision += 1;
    if (backend === 'sqlite') writeExecutionSqliteState(options.database!, 'execution-artifact-store', state, expectedHash);
    else {
      await mkdir(dirname(options.filePath), { recursive: true });
      atomicDurableWrite(options.filePath, Buffer.from(JSON.stringify(state)), { expectedHash });
    }
  }

  async function put(input: Omit<ExecutionArtifactRecord, 'id' | 'contentDigest' | 'createdAt'>) {
    const executionId = string(input.executionId, 'execution id');
    const projectId = string(input.projectId, 'project id');
    const name = string(input.name, 'name');
    const mediaType = string(input.mediaType, 'media type');
    if (typeof input.content !== 'string' || !input.content.trim()) throw new Error('invalid execution artifact content');
    const content = input.content;
    if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) throw new Error('invalid execution artifact content');
    if (!Number.isInteger(input.attempt) || input.attempt < 1) throw new Error('invalid execution artifact attempt');
    if (input.producerRole !== undefined && input.producerRole !== 'worker' && input.producerRole !== 'orchestrator') throw new Error('invalid execution artifact producer role');
    const digest = contentDigest(content);
    return queue.run(async () => {
      const backend = owner(executionId);
      if (backend === 'sqlite') {
        const database = options.database;
        if (!database) throw new Error('execution SQLite backend is unavailable');
        return database.transaction(() => {
          migrateLegacySqliteArtifacts();
          const existingRow = options.database!.sqlite.prepare(
            `SELECT id, execution_id, attempt, project_id, name, media_type, content_digest, content,
                    producer_role, producer_slot_id, created_at
             FROM execution_artifact_records WHERE execution_id = ? AND name = ?`
          ).get(executionId, name) as SqliteArtifactRow | undefined;
          if (existingRow) {
            const existing = fromSqliteRow(existingRow);
            if (existing.contentDigest === digest && existing.attempt === input.attempt && existing.projectId === projectId && existing.mediaType === mediaType) {
              return { outcome: 'replay' as const, record: clone(existing) };
            }
            return { outcome: 'conflict' as const, record: clone(existing) };
          }
          const record: ExecutionArtifactRecord = {
            id: string(id(), 'id'), executionId, projectId, name, mediaType, content, contentDigest: digest,
            attempt: input.attempt, createdAt: now(),
            ...(input.producerRole ? { producerRole: input.producerRole } : {}),
            ...(input.producerSlotId ? { producerSlotId: string(input.producerSlotId, 'producer slot id') } : {})
          };
          options.database!.sqlite.prepare(
            `INSERT INTO execution_artifact_records
             (id, execution_id, attempt, project_id, name, media_type, content_digest, content, producer_role, producer_slot_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(record.id, record.executionId, record.attempt, record.projectId, record.name, record.mediaType,
            record.contentDigest, record.content, record.producerRole ?? null, record.producerSlotId ?? null, record.createdAt);
          pruneSqliteRecords();
          return { outcome: 'stored' as const, record: clone(record) };
        });
      }
      const snapshot = read('json');
      const existing = snapshot.state.records.find((record) => record.executionId === executionId && record.name === name);
      if (existing) {
        if (existing.contentDigest === digest && existing.attempt === input.attempt && existing.projectId === projectId && existing.mediaType === mediaType) {
          return { outcome: 'replay' as const, record: clone(existing) };
        }
        return { outcome: 'conflict' as const, record: clone(existing) };
      }
      const record: ExecutionArtifactRecord = {
        id: string(id(), 'id'), executionId, projectId, name, mediaType, content, contentDigest: digest,
        attempt: input.attempt, createdAt: now(),
        ...(input.producerRole ? { producerRole: input.producerRole } : {}),
        ...(input.producerSlotId ? { producerSlotId: string(input.producerSlotId, 'producer slot id') } : {})
      };
      snapshot.state.records.push(record);
      await persist(snapshot.state, snapshot.hash, 'json');
      return { outcome: 'stored' as const, record: clone(record) };
    });
  }

  async function list(executionId: string, projectId: string): Promise<ExecutionArtifactRecord[]> {
    const boundedExecutionId = string(executionId, 'execution id');
    const boundedProjectId = string(projectId, 'project id');
    const backend = owner(boundedExecutionId);
    if (backend === 'sqlite') return queue.run(async () => options.database!.transaction(() => {
      migrateLegacySqliteArtifacts();
      const rows = options.database!.sqlite.prepare(
        `SELECT id, execution_id, attempt, project_id, name, media_type, content_digest, content,
                producer_role, producer_slot_id, created_at
         FROM execution_artifact_records
         WHERE execution_id = ? AND project_id = ?
         ORDER BY created_at ASC, id ASC`
      ).all(boundedExecutionId, boundedProjectId) as SqliteArtifactRow[];
      return clone(rows.map(fromSqliteRow));
    }));
    return queue.run(async () => clone(read('json').state.records.filter((record) =>
      record.executionId === boundedExecutionId && record.projectId === boundedProjectId)));
  }

  async function get(executionId: string, projectId: string, name: string): Promise<ExecutionArtifactRecord | undefined> {
    const backend = owner(string(executionId, 'execution id'));
    if (backend === 'sqlite') return queue.run(async () => options.database!.transaction(() => {
      migrateLegacySqliteArtifacts();
      const row = options.database!.sqlite.prepare(
        `SELECT id, execution_id, attempt, project_id, name, media_type, content_digest, content,
                producer_role, producer_slot_id, created_at
         FROM execution_artifact_records WHERE execution_id = ? AND project_id = ? AND name = ?`
      ).get(string(executionId, 'execution id'), string(projectId, 'project id'), string(name, 'name')) as SqliteArtifactRow | undefined;
      return row ? clone(fromSqliteRow(row)) : undefined;
    }));
    return queue.run(async () => {
      const record = read('json').state.records.find((candidate) => candidate.executionId === string(executionId, 'execution id')
        && candidate.projectId === string(projectId, 'project id') && candidate.name === string(name, 'name'));
      return record ? clone(record) : undefined;
    });
  }

  return { put, list, get };
}
