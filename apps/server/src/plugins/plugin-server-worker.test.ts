import { EventEmitter } from 'node:events';
import type { MessagePort } from 'node:worker_threads';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { sqliteWorkerConfiguration } from '@zana-ai/zcc-db';

const transport = vi.hoisted(() => ({ dispose: vi.fn(), commitSync: undefined as ((callback: () => any) => any) | undefined }));
// These tests exercise worker startup/API behavior without blocking this test
// thread on a real synchronous bridge. Real transport and ABI run in Electron.
vi.mock('./plugin-worker-bridge.js', () => ({ PEER_WORKER_EXECUTION_TIMEOUT_MS: 5000, createPluginWorkerBridge: (_port: unknown, _side: unknown, options: any) => {
  transport.commitSync = options.commitSync;
  return { decode: (value: unknown) => value, dispose: transport.dispose };
} }));
import { runPluginWorker } from './plugin-server-worker';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); transport.dispose.mockClear(); });

async function fixture(source: string, extension = 'mjs') {
  const dir = await mkdtemp(join(tmpdir(), 'plugin-worker-api-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const entry = join(dir, `server.${extension}`); await writeFile(entry, source);
  const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  cleanups.push(async () => { port.emit('close'); });
  const handlers = new Map<string, (input: unknown) => unknown>();
  const api = {
    storage: { database: () => { throw Error('parent database must not be used'); } },
    rpc: { method: (name: string, handler: (input: unknown) => unknown) => { handlers.set(name, handler); } },
    services: { use: () => ({}) }
  };
  const sdk: Record<string, unknown> = { version: 2, sync: () => 'sync', lazy: () => Promise.resolve('lazy') };
  const running = runPluginWorker(port as unknown as MessagePort);
  port.emit('message', { data: {
    api, entry, generation: 1, databasePath: join(dir, 'plugin.sqlite'), sqlite: sqliteWorkerConfiguration(),
    serviceMember: (_id: string, method: string) => ({ present: method in sdk, method: typeof sdk[method] === 'function', value: typeof sdk[method] === 'function' ? undefined : sdk[method] }),
    callService: (_id: string, method: string, args: unknown[]) => {
      const result = (sdk[method] as (...args: unknown[]) => unknown)(...args);
      return result instanceof Promise ? { asynchronous: true, value: () => result } : { asynchronous: false, value: result };
    }
  } });
  await running;
  return { dir, api, port, handlers };
}

it('initializes local SQLite transactions, service returns and RPC contract handlers', async () => {
  const f = await fixture(`export default async api => {
    const db = api.storage.database(); if (db !== api.storage.database()) throw Error('unstable database');
    db.migrate(['CREATE TABLE values_table (id INTEGER PRIMARY KEY, value TEXT)']);
    db.runScript("INSERT INTO values_table VALUES (1, 'local')");
    db.transaction(() => db.prepare('UPDATE values_table SET value = ?').run('transaction'));
    const sdk = api.services.use('trusted');
    api.rpc.register({}, { read: async () => ({ row: db.prepare('SELECT value FROM values_table').get(), sync: sdk.sync(), lazy: await sdk.lazy(), version: sdk.version, present: 'version' in sdk, missing: 'absent' in sdk, then: sdk.then, symbol: sdk[Symbol.iterator] }) });
  }`);
  expect(f.port.postMessage).toHaveBeenCalledWith({ kind: 'ready' });
  expect(await f.handlers.get('read')!({})).toEqual({ row: { value: 'transaction' }, sync: 'sync', lazy: 'lazy', version: 2, present: true, missing: false, then: undefined, symbol: undefined });
  await new Promise(resolve => setTimeout(resolve, 120));
  expect(f.port.postMessage).toHaveBeenCalledWith({ kind: 'heartbeat' });
  f.port.emit('close'); expect(transport.dispose).toHaveBeenCalled();
});

it('loads TypeScript factories through jiti', async () => {
  const f = await fixture(`export default (api: any) => { const result: number = 42; api.rpc.method('value', () => result); };`, 'ts');
  expect(f.port.postMessage).toHaveBeenCalledWith({ kind: 'ready' });
  expect(f.handlers.get('value')!({})).toBe(42);
});

it('delegates legacy setup without executing it in the worker', async () => {
  const f = await fixture(`export default { setup() { throw Error('legacy setup must use its existing process host'); } };`);
  expect(f.port.postMessage).toHaveBeenCalledWith({ kind: 'ready', legacy: true });
});

it.each([
  ['export default 3;', 'must default-export a factory'],
  ['export default () => { throw Error("factory failed"); };', 'factory failed'],
  ['export default () => { throw "string failure"; };', 'string failure'],
  ['invalid JavaScript ???', 'Parse']
])('reports import/factory failures without admitting a ready runtime', async (source, expected) => {
  const f = await fixture(source);
  expect(f.port.postMessage).toHaveBeenCalledWith({ kind: 'failure', message: expect.stringContaining(expected) });
  expect(f.port.postMessage).not.toHaveBeenCalledWith({ kind: 'ready' });
});

it('requires a worker parent port', async () => {
  await expect(runPluginWorker(null)).rejects.toThrow('requires a parent port');
});

it('rolls back failed peer commits and rejects Promise-returning SQLite transactions', async () => {
  const f = await fixture(`export default api => {
    const db = api.storage.database(); db.migrate(['CREATE TABLE receipts (value TEXT)']);
    api.rpc.method('insert', () => db.prepare('INSERT INTO receipts VALUES (?)').run('committed'));
    api.rpc.method('read', () => db.prepare('SELECT value FROM receipts').all());
    api.rpc.method('asyncTxn', () => db.transaction(() => { db.prepare('INSERT INTO receipts VALUES (?)').run('rollback'); return Promise.resolve(); }));
  }`);
  const execute = transport.commitSync!;
  expect(execute(() => { f.handlers.get('insert')!({}); return 42; })).toBe(42);
  expect(() => execute(() => { f.handlers.get('insert')!({}); throw Error('failed'); })).toThrow('failed');
  expect(() => f.handlers.get('asyncTxn')!({})).toThrow('requires synchronous');
  expect(f.handlers.get('read')!({})).toEqual([{ value: 'committed' }]);
});

it('rolls back Promise peer results and retires worker before async continuations', async () => {
  const f = await fixture(`export default api => {
    const db = api.storage.database(); db.migrate(['CREATE TABLE receipts (value TEXT)']);
    api.rpc.method('insert', () => db.prepare('INSERT INTO receipts VALUES (?)').run('rollback'));
  }`);
  expect(() => transport.commitSync!(() => { f.handlers.get('insert')!({}); return Promise.resolve(42); })).toThrow('requires synchronous');
  expect(f.port.postMessage).toHaveBeenCalledWith({ kind: 'failure', message: 'peer commit fence requires synchronous callback' });
  expect(() => f.handlers.get('insert')!({})).toThrow(/not open/);
});

it('keeps nested async invalidation sticky when peer callback catches the transaction error', async () => {
  const f = await fixture(`export default api => {
    const db = api.storage.database(); db.migrate(['CREATE TABLE receipts (value TEXT)']);
    api.rpc.method('nested', () => db.transaction(() => {
      db.prepare('INSERT INTO receipts VALUES (?)').run('rollback');
      return Promise.resolve().then(() => db.prepare('INSERT INTO receipts VALUES (?)').run('late'));
    }));
    api.rpc.method('insert', () => db.prepare('INSERT INTO receipts VALUES (?)').run('caught'));
  }`);
  expect(() => transport.commitSync!(() => {
    try { f.handlers.get('nested')!({}); } catch {}
    f.handlers.get('insert')!({});
    return 42;
  })).toThrow('requires synchronous');
  expect(f.port.postMessage).toHaveBeenCalledWith({ kind: 'failure', message: 'peer commit fence requires synchronous callback' });
  await Promise.resolve();
  const { createSqliteDatabase } = await import('@zana-ai/zcc-db');
  const db = createSqliteDatabase(join(f.dir, 'plugin.sqlite'));
  try { expect(db.prepare('SELECT value FROM receipts').all()).toEqual([]); }
  finally { db.close(); }
});

it('takes database backups inside the worker from the worker-owned connection', async () => {
  const f = await fixture(`export default api => {
    const db = api.storage.database(); db.migrate(['CREATE TABLE receipts (value TEXT)']);
    db.prepare('INSERT INTO receipts VALUES (?)').run('in-copy');
    api.rpc.method('backup', () => api.storage.backupDatabase({ name: 'worker' }));
  }`);
  const result = await f.handlers.get('backup')!({}) as { path: string; name: string };
  expect(result).toMatchObject({ name: 'worker', path: expect.stringMatching(/backups\/worker\.db$/) });
  const { createSqliteDatabase } = await import('@zana-ai/zcc-db');
  const copy = createSqliteDatabase(result.path, { readonly: true });
  try {
    expect(copy.prepare('SELECT value FROM receipts').all()).toEqual([{ value: 'in-copy' }]);
    expect(copy.prepare('SELECT plugin_id FROM _zcc_backup').get()).toEqual({ plugin_id: 'plugin' });
  } finally { copy.close(); }
  f.port.emit('close');
  await expect(f.handlers.get('backup')!({})).rejects.toMatchObject({ code: 'aborted' });
});
