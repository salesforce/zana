import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openExecutionDatabase, putExecutionRecord, type ExecutionDatabase } from '@zana-ai/zcc-db';
import { createExecutionArtifactStore } from '../../artifact-store.js';
import { createExecutionHandoffStore, EXECUTION_HANDOFF_OPERATION } from '../../handoff-store.js';
import { createResumeGrantStore } from '../../resume-grant-store.js';
import { createExecutionStore } from '../../store.js';
import {
  readExecutionSqliteState,
  readExecutionStoreSqliteState,
  writeExecutionSqliteState,
  writeExecutionStoreSqliteState
} from '../../storage/sqlite-state.js';
import { executionStoreCreationBackend, sqliteExecutionStoreWarning } from '../../storage/backend-policy.js';

let directory: string | undefined;
let database: ExecutionDatabase | undefined;

function setup(): { filePath: string; databasePath: string } {
  directory = mkdtempSync(join(tmpdir(), 'zcc-execution-storage-'));
  return { filePath: join(directory, 'legacy.json'), databasePath: join(directory, 'execution.sqlite') };
}

function reopen(databasePath: string): ExecutionDatabase {
  database?.close();
  database = openExecutionDatabase(databasePath);
  return database;
}

afterEach(() => {
  database?.close();
  database = undefined;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

const executionRequest = {
  callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship feature',
  requestDigest: 'digest-1', launchRequestId: 'request-1', resolvedModels: [],
  request: { version: 1 as const, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] }
};

describe('execution SQLite store routing', () => {
  it('keeps existing SQLite executions owned by SQLite while forced JSON creates only new JSON executions', async () => {
    const { filePath, databasePath } = setup();
    const sqlite = reopen(databasePath);
    const first = createExecutionStore({ filePath, database: sqlite, id: () => 'sqlite-execution', now: () => 1 });
    const sqliteRecord = (await first.claim(executionRequest)).record;

    const forcedJson = createExecutionStore({ filePath, database: reopen(databasePath), createInJson: true, id: () => 'json-execution', now: () => 2 });
    expect(await forcedJson.get(sqliteRecord.id)).toMatchObject({ id: 'sqlite-execution', state: 'READY' });
    await forcedJson.transition(sqliteRecord.id, sqliteRecord.stateVersion, 'STARTING', 'info', 'SQLite remains owner');
    const jsonRecord = (await forcedJson.claim({ ...executionRequest, launchRequestId: 'request-2' })).record;

    expect(jsonRecord.id).toBe('json-execution');
    expect(readExecutionStoreSqliteState<{ records: Array<{ id: string; state: string }> }>(reopen(databasePath), 'execution-store')?.value.records)
      .toEqual([expect.objectContaining({ id: 'sqlite-execution', state: 'STARTING' })]);
    expect(JSON.parse(readFileSync(filePath, 'utf8')).records).toEqual([expect.objectContaining({ id: 'json-execution' })]);
  });

  it('defaults new executions to SQLite when a database is configured without importing JSON records', async () => {
    const { filePath, databasePath } = setup();
    const legacyJson = createExecutionStore({ filePath, id: () => 'json-execution', now: () => 1 });
    await legacyJson.claim(executionRequest);
    const before = readFileSync(filePath, 'utf8');

    const defaultSqlite = createExecutionStore({ filePath, database: reopen(databasePath), id: () => 'sqlite-execution', now: () => 2 });
    const record = (await defaultSqlite.claim({ ...executionRequest, launchRequestId: 'request-2' })).record;
    expect(record.id).toBe('sqlite-execution');
    expect(await defaultSqlite.get('json-execution')).toMatchObject({ id: 'json-execution' });
    expect(readFileSync(filePath, 'utf8')).toBe(before);
    expect(readExecutionStoreSqliteState<{ records: Array<{ id: string }> }>(reopen(databasePath), 'execution-store')?.value.records)
      .toEqual([expect.objectContaining({ id: 'sqlite-execution' })]);
  });

  it('parses JSON override as creation-only and warns for active SQLite ownership', () => {
    expect(executionStoreCreationBackend(undefined)).toBe('sqlite');
    expect(executionStoreCreationBackend('sqlite')).toBe('sqlite');
    expect(executionStoreCreationBackend('json')).toBe('json');
    expect(sqliteExecutionStoreWarning(true, [{ state: 'RUNNING' }])).toContain('new executions');
    expect(sqliteExecutionStoreWarning(true, [{ state: 'COMPLETED' }])).toBeUndefined();
    expect(sqliteExecutionStoreWarning(false, [{ state: 'RUNNING' }])).toBeUndefined();
  });

  it('keeps legacy JSON state visible and unchanged when SQLite records are created', async () => {
    const { filePath, databasePath } = setup();
    const legacy = createExecutionStore({ filePath, id: () => 'legacy-execution', now: () => 1 });
    await legacy.claim(executionRequest);
    const legacyJson = readFileSync(filePath, 'utf8');

    const sqlite = reopen(databasePath);
    const routed = createExecutionStore({ filePath, database: sqlite, id: () => 'sqlite-execution', now: () => 2 });
    await routed.claim({ ...executionRequest, launchRequestId: 'request-2' });
    expect(readFileSync(filePath, 'utf8')).toBe(legacyJson);
    expect(await routed.get('legacy-execution')).toMatchObject({ id: 'legacy-execution' });

    const restarted = createExecutionStore({ filePath, database: reopen(databasePath) });
    expect(await restarted.get('sqlite-execution')).toMatchObject({ id: 'sqlite-execution', projectId: 'project-1' });
    expect(await createExecutionStore({ filePath }).get('legacy-execution')).toMatchObject({ id: 'legacy-execution' });
  });

  it('routes side records by execution owner without importing mixed-owner state', async () => {
    const { filePath, databasePath } = setup();
    const artifactPath = `${filePath}.artifacts`;
    const handoffPath = `${filePath}.handoffs`;
    const grantPath = `${filePath}.grants`;
    const legacyStore = createExecutionStore({ filePath, id: () => 'json-execution', now: () => 1 });
    await legacyStore.claim(executionRequest);

    const legacyArtifacts = createExecutionArtifactStore({ filePath: artifactPath, executionFilePath: filePath, id: () => 'json-artifact', now: () => 2 });
    await legacyArtifacts.put({ executionId: 'json-execution', attempt: 1, projectId: 'project-1', name: 'legacy.txt', mediaType: 'text/plain', content: 'legacy' });
    const legacyHandoffs = createExecutionHandoffStore({ filePath: handoffPath, executionFilePath: filePath, now: () => 2, id: () => 'json-handoff', token: () => 'json-handoff-token' });
    await legacyHandoffs.mint({ sourceOwnerSessionId: 'source', targetSessionId: 'target', projectId: 'project-1', executionId: 'json-execution', operations: [EXECUTION_HANDOFF_OPERATION], expiresAt: 20 });
    const legacyGrants = createResumeGrantStore({ filePath: grantPath, executionFilePath: filePath, now: () => 2, token: () => 'json-resume-token' });
    await legacyGrants.mint({ executionId: 'json-execution', projectId: 'project-1', callerPrincipalId: 'owner', expiresAt: 20 });

    const sqliteStore = createExecutionStore({ filePath, database: reopen(databasePath), id: () => 'sqlite-execution', now: () => 3 });
    await sqliteStore.claim({ ...executionRequest, launchRequestId: 'request-2' });
    const artifacts = createExecutionArtifactStore({ filePath: artifactPath, executionFilePath: filePath, database: database!, id: () => 'sqlite-artifact', now: () => 4 });
    const handoffs = createExecutionHandoffStore({ filePath: handoffPath, executionFilePath: filePath, database: database!, now: () => 4, id: () => 'sqlite-handoff', token: () => 'sqlite-handoff-token' });
    const grants = createResumeGrantStore({ filePath: grantPath, executionFilePath: filePath, database: database!, now: () => 4, token: () => 'sqlite-resume-token' });

    await expect(artifacts.get('json-execution', 'project-1', 'legacy.txt')).resolves.toMatchObject({ id: 'json-artifact', content: 'legacy' });
    await expect(handoffs.consume({ token: 'json-handoff-token', targetSessionId: 'target', projectId: 'project-1', executionId: 'json-execution', operation: EXECUTION_HANDOFF_OPERATION }))
      .resolves.toMatchObject({ id: 'json-handoff', usedAt: 4 });
    await expect(grants.rotate({ executionId: 'json-execution', projectId: 'project-1', callerPrincipalId: 'owner', expectedGeneration: 0, expiresAt: 20 }))
      .resolves.toMatchObject({ token: 'sqlite-resume-token', generation: 1 });
    await expect(grants.consume({ token: 'sqlite-resume-token', executionId: 'json-execution', projectId: 'project-1', effectiveOwnerPrincipalId: 'replacement', generation: 1 }))
      .resolves.toMatchObject({ outcome: 'consumed', grant: { generation: 1, boundOwnerPrincipalId: 'replacement' } });

    await artifacts.put({ executionId: 'sqlite-execution', attempt: 1, projectId: 'project-1', name: 'sqlite.txt', mediaType: 'text/plain', content: 'sqlite' });
    await handoffs.mint({ sourceOwnerSessionId: 'source', targetSessionId: 'target', projectId: 'project-1', executionId: 'sqlite-execution', operations: [EXECUTION_HANDOFF_OPERATION], expiresAt: 20 });
    await grants.mint({ executionId: 'sqlite-execution', projectId: 'project-1', callerPrincipalId: 'owner', expiresAt: 20 });

    expect(JSON.parse(readFileSync(artifactPath, 'utf8')).records).toEqual([expect.objectContaining({ executionId: 'json-execution' })]);
    expect(JSON.parse(readFileSync(handoffPath, 'utf8')).grants).toEqual([]);
    expect(JSON.parse(readFileSync(grantPath, 'utf8')).grants).toEqual([expect.objectContaining({ executionId: 'json-execution', generation: 1 })]);
    expect(await artifacts.get('json-execution', 'project-1', 'sqlite.txt')).toBeUndefined();
    expect(await artifacts.get('sqlite-execution', 'project-1', 'sqlite.txt')).toMatchObject({ id: 'sqlite-artifact', content: 'sqlite' });
    expect(readExecutionSqliteState<{ grants: Array<{ executionId: string; tokenDigest: string }> }>(database!, 'execution-resume-grant-store')?.value.grants)
      .toEqual([expect.objectContaining({ executionId: 'sqlite-execution' })]);
  });

  it('rejects stale SQLite compare-and-swap writes', () => {
    const { databasePath } = setup();
    const sqlite = reopen(databasePath);
    writeExecutionSqliteState(sqlite, 'state', { revision: 1 }, null);
    const staleHash = readExecutionSqliteState<{ revision: number }>(sqlite, 'state')!.hash;
    writeExecutionSqliteState(sqlite, 'state', { revision: 2 }, staleHash);
    expect(() => writeExecutionSqliteState(sqlite, 'state', { revision: 3 }, staleHash)).toThrow('stale execution SQLite state');
  });

  it('preserves ledger compare-and-swap semantics across row snapshots', () => {
    const { databasePath } = setup();
    const sqlite = reopen(databasePath);
    const first = { version: 1 as const, revision: 1, records: [], events: [] };
    writeExecutionStoreSqliteState(sqlite, 'execution-store', first, null);
    const staleHash = readExecutionStoreSqliteState(sqlite, 'execution-store')!.hash;
    writeExecutionStoreSqliteState(sqlite, 'execution-store', { ...first, revision: 2 }, staleHash);
    expect(() => writeExecutionStoreSqliteState(sqlite, 'execution-store', { ...first, revision: 3 }, staleHash))
      .toThrow('stale execution SQLite state');
  });

  it('migrates legacy aggregate execution ledger without losing ownership or history', async () => {
    const { filePath, databasePath } = setup();
    const legacy = createExecutionStore({ filePath, id: () => 'legacy-execution', now: () => 1_000_000 });
    await legacy.claim(executionRequest);
    const legacyState = JSON.parse(readFileSync(filePath, 'utf8'));
    const sqlite = reopen(databasePath);
    putExecutionRecord(sqlite, 'execution-store', legacyState);

    const migrated = createExecutionStore({ filePath, database: sqlite });
    await expect(migrated.get('legacy-execution')).resolves.toMatchObject({ callerPrincipalId: 'session-1' });
    await expect(migrated.events('session-1', 'project-1', 'legacy-execution')).resolves.toMatchObject({
      events: [{ executionId: 'legacy-execution', sequence: 1 }]
    });
    expect(sqlite.sqlite.prepare('SELECT id FROM execution_records WHERE id = ?').get('execution-store')).toBeUndefined();
    expect(sqlite.sqlite.prepare('SELECT store_id FROM execution_store_meta WHERE store_id = ?').get('execution-store'))
      .toEqual({ store_id: 'execution-store' });
  });

  it('persists execution ledger state beyond 4 MiB across reopen', async () => {
    const { filePath, databasePath } = setup();
    let id = 0;
    const store = createExecutionStore({
      filePath,
      database: reopen(databasePath),
      id: () => `execution-${++id}`,
      now: () => 1_000_000 + id
    });
    const workUnits = Array.from({ length: 100 }, (_, index) => ({
      id: `unit-${index}`,
      title: `Unit ${index}`,
      task: 'x'.repeat(16 * 1024),
      dependencies: []
    }));

    for (let index = 1; index <= 3; index += 1) {
      await store.claim({ ...executionRequest, launchRequestId: `request-${index}`, workUnits });
    }

    const aggregateBytes = Number(reopen(databasePath).sqlite.prepare(
      'SELECT COALESCE(SUM(length(value_json)), 0) AS bytes FROM execution_store_record_rows WHERE store_id = ?'
    ).get('execution-store')!.bytes);
    expect(aggregateBytes).toBeGreaterThan(4 * 1024 * 1024);

    const restarted = createExecutionStore({ filePath, database: reopen(databasePath) });
    await expect(restarted.list('session-1', 'project-1')).resolves.toHaveLength(3);
    const record = await restarted.get('execution-3');
    expect(record?.workUnits?.[0]).toMatchObject({ id: 'unit-0', task: 'x'.repeat(16 * 1024) });
    await expect(restarted.events('session-1', 'project-1', 'execution-3')).resolves.toMatchObject({
      events: [{ executionId: 'execution-3', sequence: 1, summary: 'Execution reserved' }]
    });
  });

  it('persists artifact records across SQLite reopen', async () => {
    const { filePath, databasePath } = setup();
    const store = createExecutionArtifactStore({ filePath, database: reopen(databasePath), id: () => 'artifact-1', now: () => 1 });
    await store.put({ executionId: 'execution-1', attempt: 1, projectId: 'project-1', name: 'result.json', mediaType: 'application/json', content: '{"ok":true}' });

    const restarted = createExecutionArtifactStore({ filePath, database: reopen(databasePath) });
    await expect(restarted.get('execution-1', 'project-1', 'result.json')).resolves.toMatchObject({ id: 'artifact-1', content: '{"ok":true}' });
  });

  it('persists supported aggregate artifact capacity without a single-row SQLite limit', async () => {
    const { filePath, databasePath } = setup();
    let id = 0;
    const store = createExecutionArtifactStore({ filePath, database: reopen(databasePath), id: () => `artifact-${++id}`, now: () => id });
    const content = 'x'.repeat(64 * 1024);
    for (let index = 0; index < 65; index += 1) {
      await expect(store.put({ executionId: 'execution-1', attempt: 1, projectId: 'project-1', name: `artifact-${index}.txt`, mediaType: 'text/plain', content }))
        .resolves.toMatchObject({ outcome: 'stored' });
    }

    const restarted = createExecutionArtifactStore({ filePath, database: reopen(databasePath) });
    await expect(restarted.list('execution-1', 'project-1')).resolves.toHaveLength(65);
    await expect(restarted.get('execution-1', 'project-1', 'artifact-64.txt')).resolves.toMatchObject({ content });
  });

  it('filters SQLite artifact lists by execution and project in SQL', async () => {
    const { filePath, databasePath } = setup();
    const sqlite = reopen(databasePath);
    const statements: string[] = [];
    const prepare = sqlite.sqlite.prepare.bind(sqlite.sqlite);
    (sqlite.sqlite as unknown as { prepare: (sql: string) => unknown }).prepare = (sql) => {
      statements.push(sql);
      return prepare(sql);
    };
    const store = createExecutionArtifactStore({ filePath, database: sqlite, id: (() => `artifact-${statements.length}`), now: () => 1 });
    await store.put({ executionId: 'execution-1', attempt: 1, projectId: 'project-1', name: 'one.txt', mediaType: 'text/plain', content: 'one' });
    await store.put({ executionId: 'execution-2', attempt: 1, projectId: 'project-1', name: 'two.txt', mediaType: 'text/plain', content: 'two' });
    await store.put({ executionId: 'execution-1', attempt: 1, projectId: 'project-2', name: 'three.txt', mediaType: 'text/plain', content: 'three' });

    await expect(store.list('execution-1', 'project-1')).resolves.toEqual([
      expect.objectContaining({ executionId: 'execution-1', projectId: 'project-1', name: 'one.txt', content: 'one' })
    ]);
    expect(statements).toContainEqual(expect.stringContaining('WHERE execution_id = ? AND project_id = ?'));
  });

  it('prunes SQLite artifacts from metadata without selecting bodies', async () => {
    const { filePath, databasePath } = setup();
    const sqlite = reopen(databasePath);
    const statements: string[] = [];
    const prepare = sqlite.sqlite.prepare.bind(sqlite.sqlite);
    (sqlite.sqlite as unknown as { prepare: (sql: string) => unknown }).prepare = (sql) => {
      statements.push(sql);
      return prepare(sql);
    };
    let id = 0;
    const store = createExecutionArtifactStore({
      filePath,
      database: sqlite,
      id: () => `artifact-${++id}`,
      now: () => id,
      maxRecords: 3,
      maxRecordsPerExecution: 2
    });
    for (let index = 0; index < 3; index += 1) {
      await store.put({ executionId: 'execution-1', attempt: 1, projectId: 'project-1', name: `one-${index}.txt`, mediaType: 'text/plain', content: 'x'.repeat(1024) });
    }
    await store.put({ executionId: 'execution-2', attempt: 1, projectId: 'project-1', name: 'two.txt', mediaType: 'text/plain', content: 'y'.repeat(1024) });

    const prune = statements.find((statement) => statement.includes('WITH per_execution'));
    expect(prune).toBeDefined();
    expect(prune).not.toContain('content');
    expect(sqlite.sqlite.prepare('SELECT id FROM execution_artifact_records ORDER BY created_at ASC, id ASC').all())
      .toEqual([{ id: 'artifact-2' }, { id: 'artifact-3' }, { id: 'artifact-4' }]);
  });

  it('migrates legacy aggregate SQLite artifacts without losing records', async () => {
    const { filePath, databasePath } = setup();
    const sqlite = reopen(databasePath);
    putExecutionRecord(sqlite, 'execution-artifact-store', {
      version: 1,
      revision: 1,
      records: [{
        id: 'legacy-artifact', executionId: 'execution-1', attempt: 1, projectId: 'project-1',
        name: 'legacy.txt', mediaType: 'text/plain', contentDigest: 'sha256:legacy', content: 'legacy', createdAt: 1
      }]
    });

    const store = createExecutionArtifactStore({ filePath, database: sqlite });
    await expect(store.get('execution-1', 'project-1', 'legacy.txt')).resolves.toMatchObject({ id: 'legacy-artifact', content: 'legacy' });
    expect(sqlite.sqlite.prepare('SELECT id FROM execution_records WHERE id = ?').get('execution-artifact-store')).toBeUndefined();
  });

  it('persists handoff grants across SQLite reopen and consumes them once', async () => {
    const { filePath, databasePath } = setup();
    const store = createExecutionHandoffStore({ filePath, database: reopen(databasePath), now: () => 10, id: () => 'handoff-1', token: () => 'handoff-token' });
    await store.mint({ sourceOwnerSessionId: 'source', targetSessionId: 'target', projectId: 'project-1', executionId: 'execution-1', operations: [EXECUTION_HANDOFF_OPERATION], expiresAt: 20 });

    const restarted = createExecutionHandoffStore({ filePath, database: reopen(databasePath), now: () => 10 });
    await expect(restarted.consume({ token: 'handoff-token', targetSessionId: 'target', projectId: 'project-1', executionId: 'execution-1', operation: EXECUTION_HANDOFF_OPERATION }))
      .resolves.toMatchObject({ id: 'handoff-1', sourceOwnerSessionId: 'source' });
    await expect(restarted.consume({ token: 'handoff-token', targetSessionId: 'target', projectId: 'project-1', executionId: 'execution-1', operation: EXECUTION_HANDOFF_OPERATION }))
      .rejects.toThrow('execution handoff is not current');
  });

  it('persists resume grants across SQLite reopen without storing raw tokens', async () => {
    const { filePath, databasePath } = setup();
    const store = createResumeGrantStore({ filePath, database: reopen(databasePath), now: () => 10, token: () => 'resume-token' });
    await store.mint({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner', expiresAt: 20 });

    const state = readExecutionSqliteState<{ grants: Array<{ tokenDigest: string }> }>(database!, 'execution-resume-grant-store')!;
    expect(JSON.stringify(state.value)).not.toContain('resume-token');
    const restarted = createResumeGrantStore({ filePath, database: reopen(databasePath), now: () => 10 });
    await expect(restarted.consume({ token: 'resume-token', executionId: 'execution-1', projectId: 'project-1', effectiveOwnerPrincipalId: 'replacement' }))
      .resolves.toMatchObject({ outcome: 'consumed', grant: { boundOwnerPrincipalId: 'replacement' } });
  });
});
