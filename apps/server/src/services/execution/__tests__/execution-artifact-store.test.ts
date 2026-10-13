import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { openExecutionDatabase, putExecutionRecord, type ExecutionDatabase } from '@zana-ai/zcc-db';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentDigest, createExecutionArtifactStore } from '../artifact-store.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-artifacts-'));
  try { await run(join(dir, 'artifacts.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const artifact = { executionId: 'execution-1', attempt: 1, projectId: 'project-1', name: 'result.json', mediaType: 'application/json', content: '{"ok":true}' };

describe('execution artifact store', () => {
  it('stores content-addressed records and replays identical writes', async () => fixture(async (filePath) => {
    const store = createExecutionArtifactStore({ filePath, id: () => 'artifact-1' });
    const first = await store.put(artifact);
    expect(first).toMatchObject({ outcome: 'stored', record: { id: 'artifact-1', contentDigest: contentDigest(artifact.content) } });
    expect(await store.put(artifact)).toMatchObject({ outcome: 'replay', record: { id: 'artifact-1' } });
  }));

  it('rejects same artifact name with changed content and isolates projects', async () => fixture(async (filePath) => {
    const store = createExecutionArtifactStore({ filePath });
    await store.put(artifact);
    expect(await store.put({ ...artifact, content: '{"ok":false}' })).toMatchObject({ outcome: 'conflict' });
    expect(await store.list('execution-1', 'other-project')).toEqual([]);
    expect(await store.get('execution-1', 'other-project', 'result.json')).toBeUndefined();
  }));

  it('rejects content exceeding the UTF-8 byte limit', async () => fixture(async (filePath) => {
    const store = createExecutionArtifactStore({ filePath });
    await expect(store.put({ ...artifact, content: '€'.repeat(30_000) })).rejects.toThrow('invalid execution artifact content');
  }));

  it('bounds artifacts per execution without another execution bricking the store', async () => fixture(async (filePath) => {
    let id = 0;
    const store = createExecutionArtifactStore({ filePath, id: () => `artifact-${++id}`, maxRecords: 4, maxRecordsPerExecution: 2 });
    for (let index = 0; index < 5; index += 1) await store.put({ ...artifact, name: `one-${index}.json`, content: String(index) });
    await expect(store.put({ ...artifact, executionId: 'execution-2', name: 'two.json' })).resolves.toMatchObject({ outcome: 'stored' });
    expect(await store.list('execution-1', 'project-1')).toHaveLength(2);
    expect(await store.list('execution-2', 'project-1')).toHaveLength(1);
  }));

  it('accepts a valid producerRole and rejects an unknown one before it is persisted', async () => fixture(async (filePath) => {
    const store = createExecutionArtifactStore({ filePath });
    await expect(store.put({ ...artifact, name: 'worker.json', producerRole: 'worker' })).resolves.toMatchObject({ outcome: 'stored', record: { producerRole: 'worker' } });
    await expect(store.put({ ...artifact, name: 'bad.json', producerRole: 'boss' as unknown as 'worker' })).rejects.toThrow('invalid execution artifact producer role');
  }));

  it('rejects blank content and invalid per-execution record caps', async () => fixture(async (filePath) => {
    expect(() => createExecutionArtifactStore({ filePath, maxRecordsPerExecution: 0 })).toThrow('invalid execution artifact max records per execution');
    const store = createExecutionArtifactStore({ filePath });
    await expect(store.put({ ...artifact, content: '   ' })).rejects.toThrow('invalid execution artifact content');
  }));
});

async function sqliteFixture(run: (ctx: { database: ExecutionDatabase; filePath: string; executionFilePath: string }) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-artifacts-sqlite-'));
  const database = openExecutionDatabase(join(dir, 'execution.sqlite'));
  try { await run({ database, filePath: join(dir, 'artifacts.json'), executionFilePath: join(dir, 'executions.json') }); } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
}

describe('execution artifact store (SQLite backend)', () => {
  it('requires executionFilePath when a database is provided', async () => sqliteFixture(async ({ database, filePath }) => {
    expect(() => createExecutionArtifactStore({ filePath, database } as never)).toThrow('requires executionFilePath');
  }));

  it('stores, replays, conflicts, lists and gets with project isolation', async () => sqliteFixture(async ({ database, filePath, executionFilePath }) => {
    let id = 0;
    const store = createExecutionArtifactStore({ filePath, database, executionFilePath, id: () => `a-${++id}` });
    const stored = await store.put({ ...artifact, producerRole: 'worker', producerSlotId: 'slot-1' });
    expect(stored).toMatchObject({ outcome: 'stored', record: { id: 'a-1', producerRole: 'worker', producerSlotId: 'slot-1' } });
    expect(await store.put({ ...artifact, producerRole: 'worker', producerSlotId: 'slot-1' })).toMatchObject({ outcome: 'replay', record: { id: 'a-1' } });
    expect(await store.put({ ...artifact, content: '{"ok":false}' })).toMatchObject({ outcome: 'conflict', record: { id: 'a-1' } });
    expect(await store.put({ ...artifact, attempt: 2 })).toMatchObject({ outcome: 'conflict' });
    await store.put({ ...artifact, name: 'plain.json' });
    const listed = await store.list('execution-1', 'project-1');
    expect(listed.map((record) => record.name).sort()).toEqual(['plain.json', 'result.json']);
    const plain = listed.find((record) => record.name === 'plain.json')!;
    expect(plain).not.toHaveProperty('producerRole');
    expect(plain).not.toHaveProperty('producerSlotId');
    expect(await store.get('execution-1', 'project-1', 'result.json')).toMatchObject({ id: 'a-1', producerRole: 'worker', content: artifact.content });
    expect(await store.get('execution-1', 'project-1', 'missing.json')).toBeUndefined();
    expect(await store.get('execution-1', 'other', 'result.json')).toBeUndefined();
    expect(await store.list('execution-1', 'other')).toEqual([]);
    expect(readRowCount(database)).toBe(2);
  }));

  function readRowCount(database: ExecutionDatabase): number {
    return (database.sqlite.prepare('SELECT COUNT(*) AS n FROM execution_artifact_records').get() as { n: number }).n;
  }

  it('prunes per execution and globally by recency in SQL', async () => sqliteFixture(async ({ database, filePath, executionFilePath }) => {
    let id = 0;
    let clock = 0;
    const store = createExecutionArtifactStore({
      filePath, database, executionFilePath, id: () => `a-${++id}`, now: () => ++clock, maxRecords: 4, maxRecordsPerExecution: 2
    });
    for (let index = 0; index < 5; index += 1) await store.put({ ...artifact, name: `one-${index}.json`, content: String(index) });
    expect((await store.list('execution-1', 'project-1')).map((record) => record.name)).toEqual(['one-3.json', 'one-4.json']);
    await store.put({ ...artifact, executionId: 'execution-2', name: 'two-0.json' });
    await store.put({ ...artifact, executionId: 'execution-2', name: 'two-1.json' });
    await store.put({ ...artifact, executionId: 'execution-3', name: 'three-0.json' });
    expect(readRowCount(database)).toBe(4);
    expect(await store.list('execution-1', 'project-1')).toHaveLength(1);
    expect(await store.list('execution-3', 'project-1')).toHaveLength(1);
  }));

  it('migrates the legacy aggregate row atomically and keeps its records', async () => sqliteFixture(async ({ database, filePath, executionFilePath }) => {
    const legacy = {
      id: 'legacy-1', executionId: 'execution-1', attempt: 1, projectId: 'project-1', name: 'old.json', mediaType: 'application/json',
      content: 'old', contentDigest: contentDigest('old'), producerRole: 'orchestrator', producerSlotId: 'slot-9', createdAt: 5
    };
    putExecutionRecord(database, 'execution-artifact-store', { version: 1, revision: 3, records: [legacy] } as never);
    const store = createExecutionArtifactStore({ filePath, database, executionFilePath });
    expect(await store.get('execution-1', 'project-1', 'old.json')).toEqual(legacy);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM execution_records WHERE id = 'execution-artifact-store'").get()).toEqual({ n: 0 });
    // Idempotent: a later call finds no legacy row and keeps migrated data.
    expect(await store.list('execution-1', 'project-1')).toEqual([legacy]);
  }));

  it('migrates legacy data on put and on list', async () => sqliteFixture(async ({ database, filePath, executionFilePath }) => {
    const legacy = { id: 'legacy-1', executionId: 'execution-1', attempt: 1, projectId: 'project-1', name: 'old.json', mediaType: 'text/plain', content: 'old', contentDigest: contentDigest('old'), createdAt: 5 };
    putExecutionRecord(database, 'execution-artifact-store', { version: 1, revision: 1, records: [legacy] } as never);
    const store = createExecutionArtifactStore({ filePath, database, executionFilePath });
    expect(await store.put({ ...artifact, name: 'old.json', mediaType: 'text/plain', content: 'old' })).toMatchObject({ outcome: 'replay', record: { id: 'legacy-1' } });
    putExecutionRecord(database, 'execution-artifact-store', { version: 1, revision: 1, records: [{ ...legacy, id: 'legacy-2', name: 'older.json' }] } as never);
    expect((await store.list('execution-1', 'project-1')).map((record) => record.id).sort()).toEqual(['legacy-1', 'legacy-2']);
  }));

  it('rejects a corrupt legacy aggregate without losing it', async () => sqliteFixture(async ({ database, filePath, executionFilePath }) => {
    for (const bad of [{ version: 2, revision: 0, records: [] }, { version: 1, revision: 0.5, records: [] }, { version: 1, revision: 0, records: 'x' }, { version: 1, revision: 0, records: [{ id: 1 }] }]) {
      putExecutionRecord(database, 'execution-artifact-store', bad as never);
      const store = createExecutionArtifactStore({ filePath, database, executionFilePath });
      await expect(store.put(artifact)).rejects.toThrow('corrupt execution artifact store: invalid shape');
      await expect(store.list('execution-1', 'project-1')).rejects.toThrow('invalid shape');
      await expect(store.get('execution-1', 'project-1', 'x')).rejects.toThrow('invalid shape');
      expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM execution_records WHERE id = 'execution-artifact-store'").get()).toEqual({ n: 1 });
    }
    expect(readRowCount(database)).toBe(0);
  }));

  it('routes executions owned by the JSON ledger to the JSON file', async () => sqliteFixture(async ({ database, filePath, executionFilePath }) => {
    await writeFile(executionFilePath, JSON.stringify({ version: 1, revision: 1, records: [{ id: 'json-exec' }], events: [] }));
    const store = createExecutionArtifactStore({ filePath, database, executionFilePath });
    expect(await store.put({ ...artifact, executionId: 'json-exec' })).toMatchObject({ outcome: 'stored' });
    expect(readRowCount(database)).toBe(0);
    expect(await store.get('json-exec', 'project-1', 'result.json')).toMatchObject({ executionId: 'json-exec' });
    expect(await store.list('json-exec', 'project-1')).toHaveLength(1);
    // Unclaimed executions default to SQLite.
    await store.put({ ...artifact, executionId: 'fresh-exec' });
    expect(readRowCount(database)).toBe(1);
  }));

  it('validates identifiers before querying SQLite', async () => sqliteFixture(async ({ database, filePath, executionFilePath }) => {
    const store = createExecutionArtifactStore({ filePath, database, executionFilePath });
    await expect(store.get(' ', 'project-1', 'x')).rejects.toThrow('invalid execution artifact execution id');
    await expect(store.list('execution-1', '')).rejects.toThrow('invalid execution artifact project id');
    await expect(store.get('execution-1', 'project-1', '')).rejects.toThrow('invalid execution artifact name');
  }));

  it('rolls back the insert when the transaction fails (duplicate artifact id)', async () => sqliteFixture(async ({ database, filePath, executionFilePath }) => {
    const store = createExecutionArtifactStore({ filePath, database, executionFilePath, id: () => 'same-id' });
    await store.put(artifact);
    await expect(store.put({ ...artifact, name: 'second.json' })).rejects.toThrow();
    expect(readRowCount(database)).toBe(1);
    expect(await store.put({ ...artifact })).toMatchObject({ outcome: 'replay' });
  }));
});

describe('execution artifact store (JSON backend validation and corruption)', () => {
  it('rejects invalid max records and attempts, and stores producer slot ids', async () => fixture(async (filePath) => {
    expect(() => createExecutionArtifactStore({ filePath, maxRecords: 0 })).toThrow('invalid execution artifact max records');
    expect(() => createExecutionArtifactStore({ filePath, maxRecords: 1.5 })).toThrow('invalid execution artifact max records');
    const store = createExecutionArtifactStore({ filePath });
    await expect(store.put({ ...artifact, attempt: 0 })).rejects.toThrow('invalid execution artifact attempt');
    await expect(store.put({ ...artifact, attempt: 1.5 })).rejects.toThrow('invalid execution artifact attempt');
    expect(await store.put({ ...artifact, producerSlotId: 'slot-3' })).toMatchObject({ outcome: 'stored', record: { producerSlotId: 'slot-3' } });
    await expect(store.put({ ...artifact, name: 'b.json', producerSlotId: ' ' })).rejects.toThrow('invalid execution artifact producer slot id');
  }));

  it('refuses to read or overwrite corrupt or wrongly shaped files', async () => fixture(async (filePath) => {
    const store = createExecutionArtifactStore({ filePath });
    const bad = ['not json', 'null', JSON.stringify({ version: 2, revision: 0, records: [] }), JSON.stringify({ version: 1, revision: 0, records: [null] }),
      JSON.stringify({ version: 1, revision: 0, records: [{ id: 'x' }] })];
    for (const content of bad) {
      await writeFile(filePath, content);
      await expect(store.put(artifact)).rejects.toThrow('corrupt execution artifact store');
      await expect(store.list('execution-1', 'project-1')).rejects.toThrow('corrupt execution artifact store');
      await expect(store.get('execution-1', 'project-1', 'result.json')).rejects.toThrow('corrupt execution artifact store');
      expect(await readFile(filePath, 'utf8')).toBe(content);
    }
  }));
});
