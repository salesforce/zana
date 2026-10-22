import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { createPluginApi } from './plugin-api';
import { createIsolatedPluginRuntime, resolvePluginWorkerExecArgv } from './isolated-plugin-runtime';
import { createPluginPeerCommit, PEER_WORKER_COMMIT_TIMEOUT_MS, PEER_WORKER_EXECUTION_TIMEOUT_MS } from './plugin-worker-bridge';
import { PairStore } from '../services/peers/pair-store';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

it('resolves tsx loader URL for TypeScript worker entries and empty argv for JavaScript', () => {
  const tsArgv = resolvePluginWorkerExecArgv('/path/to/worker.ts');
  expect(tsArgv[0]).toBe('--import');
  expect(tsArgv[1]).toMatch(/^file:\/\/\/.+tsx/);

  const jsArgv = resolvePluginWorkerExecArgv('/path/to/worker.js');
  expect(jsArgv).toEqual([]);
});
async function fixture(source: string, timings = {}, configure?: (api: ReturnType<typeof createPluginApi>['api']) => void) {
  const dir = await mkdtemp(join(tmpdir(), 'plugin-isolation-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const entry = join(dir, 'server.mjs'); await writeFile(entry, source);
  const rpc = new Map<string, (input: unknown) => unknown>(); const handle = createPluginApi('isolation-test', dir); cleanups.push(() => handle.dispose()); handle.api.rpc.method = (name, fn) => { rpc.set(name, fn); };
  configure?.(handle.api);
  const failure = vi.fn(); const runtime = createIsolatedPluginRuntime({ api: handle.api, entry, generation: 1, databasePath: join(dir, 'data.db'), onFailure: failure, ...timings });
  cleanups.push(async () => runtime.dispose()); return { dir, runtime, handle, failure, rpc };
}
it('keeps database transactions local, supports callbacks, settings, KV and disposal', async () => {
  const f = await fixture(`export default async api => {
    const settings = api.settings.define({ greeting: { type: 'string', label: 'Greeting', default: 'hi' } });
    const db = api.storage.database(); db.migrate(['CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT)']);
    db.transaction(() => db.prepare('INSERT INTO records VALUES (?, ?)').run(1, 'one'));
    await api.storage.kv.set('saved', 'value');
    api.rpc.method('read', async () => ({ row: db.prepare('SELECT value FROM records').get(), kv: await api.storage.kv.get('saved'), greeting: (await settings.get()).greeting }));
    api.agents.contributeInstructions(ctx => 'thread ' + ctx.threadId);
    api.onDispose(async () => { await api.storage.kv.set('disposed', true); });
  }`);
  await f.runtime.started; expect(await f.rpc.get('read')!({})).toEqual({ row: { value: 'one' }, kv: 'value', greeting: 'hi' });
  expect(await f.handle.extraInstructionProviders[0]({ threadId: 't', projectId: 'p' })).toBe('thread t');
  f.runtime.dispose(); await expect(f.rpc.get('read')!({})).rejects.toThrow('stopped');
});
it('bounds synchronous factory and top-level import CPU work without blocking the server', async () => {
  let ticks = 0; const timer = setInterval(() => ticks++, 10);
  try {
    const f = await fixture('while (true) {}', { startupTimeoutMs: 900 });
    await expect(f.runtime.started).rejects.toThrow('timed out'); expect(ticks).toBeGreaterThan(10); expect(f.failure).toHaveBeenCalledOnce();
  } finally { clearInterval(timer); }
});
it('terminates a callback that blocks after await and rejects its pending request', async () => {
  const f = await fixture(`export default api => api.rpc.method('busy', async () => { await new Promise(r => setTimeout(r, 10)); while (true) {} });`, { heartbeatTimeoutMs: 400 });
  await f.runtime.started; let ticks = 0; const timer = setInterval(() => ticks++, 10);
  try { await expect(f.rpc.get('busy')!({})).rejects.toThrow('stopped responding'); expect(ticks).toBeGreaterThan(5); expect(f.failure).toHaveBeenCalledOnce(); } finally { clearInterval(timer); }
});
it('surfaces factory errors and does not retain a live callback', async () => {
  const f = await fixture('export default () => { throw Error("broken factory"); }'); await expect(f.runtime.started).rejects.toThrow('broken factory'); expect(f.failure).toHaveBeenCalledOnce();
});
it('disposes during initialization without leaking an unhandled rejection', async () => {
  const f = await fixture('export default () => new Promise(() => {})'); const termination = f.runtime.dispose();
  expect(f.runtime.dispose()).toBe(termination); await termination;
  await expect(f.runtime.started).rejects.toThrow('stopped'); expect(f.failure).not.toHaveBeenCalled(); expect(f.runtime.isBusy()).toBe(false);
});

it('preserves trusted service values, Promise returns and errors through the worker', async () => {
  const f = await fixture(`export default api => {
    const sdk = api.services.use('trusted');
    api.rpc.method('read', async () => {
      let rejected; try { await sdk.fail(); } catch (error) { rejected = error.message; }
      let invalid; try { sdk.constructor; } catch (error) { invalid = error.message; }
      return { version: sdk.version, present: 'version' in sdk, sync: sdk.sync(), lazy: await sdk.lazy().then(value => value), rejected, invalid };
    });
  }`, {}, api => {
    api.services.use = (() => ({ version: 1, sync: () => 'sync', lazy: () => Promise.resolve('lazy'), fail: () => Promise.reject(Error('failed')) })) as typeof api.services.use;
  });
  await f.runtime.started;
  expect(await f.rpc.get('read')!({})).toEqual({ version: 1, present: true, sync: 'sync', lazy: 'lazy', rejected: 'failed', invalid: 'Invalid plugin service method' });
});

async function peerFixture(callback: string, queueDelayMs = 0) {
  const f = await fixture(`export default api => {
    const db = api.storage.database(); db.migrate(['CREATE TABLE receipts (value TEXT)']);
    let counter = 0;
    api.sdk.peers.handle('apply', async request => {
      const operation = request.commitSync(${callback});
      const until = Date.now() + ${queueDelayMs}; while (Date.now() < until) {}
      const result = await operation;
      return request.body.multiple ? request.commitSync(${callback}) : result;
    });
    api.rpc.method('read', () => ({ counter, rows: db.prepare('SELECT value FROM receipts').all() }));
  }`);
  await f.runtime.started;
  const pairs = new PairStore(join(await realpath(f.dir), 'pairs'), { localInstanceId: 'local', keyProvider: { getKey: async () => Buffer.alloc(32, 1) } });
  cleanups.push(async () => pairs.dispose());
  await pairs.create({ pairId: 'pair', localInstanceId: 'local', remoteInstanceId: 'remote', targetHostId: 'host', pluginId: 'isolation-test', scope: 'scope', proposalId: 'proposal', epoch: 1 });
  const lease = (await pairs.acquireGrant('pair', 1, 'isolation-test', 'scope'))!;
  cleanups.push(async () => lease.release());
  const request = { body: { text: 'payload-'.repeat(2048) }, peerId: 'remote', scope: 'scope', grantEpoch: 1,
    signal: lease.signal, commitSync: createPluginPeerCommit(lease, lease.signal) };
  return { ...f, pairs, lease, request, apply: () => f.handle.peerHandlers.get('apply')!(request) };
}

it('commits counter and worker-local SQLite payload over real observed bridge without server blocking', async () => {
  const f = await peerFixture(`() => { counter++; db.prepare('INSERT INTO receipts VALUES (?)').run(request.body.text); return { counter, text: request.body.text }; }`);
  expect(await f.apply()).toEqual({ counter: 1, text: f.request.body.text });
  expect(await f.rpc.get('read')!({})).toEqual({ counter: 1, rows: [{ value: f.request.body.text }] });
  await f.pairs.revoke('pair');
  await expect(f.apply()).rejects.toThrow(/active|aborted|Unknown plugin callback/);
  expect(await f.rpc.get('read')!({})).toEqual({ counter: 1, rows: [{ value: f.request.body.text }] });
});

it('rejects host roundtrips inside synchronous commit and rolls back SQL', async () => {
  const f = await peerFixture(`() => { db.prepare('INSERT INTO receipts VALUES (?)').run('rollback'); api.log.info('forbidden'); }`);
  await expect(f.apply()).rejects.toThrow('cannot call host APIs');
  expect(await f.rpc.get('read')!({})).toEqual({ counter: 0, rows: [] });
});

it('rejects declared async commit before its mutation', async () => {
  const f = await peerFixture(`async () => { counter++; db.prepare('INSERT INTO receipts VALUES (?)').run('forbidden'); }`);
  await expect(f.apply()).rejects.toThrow('requires synchronous');
  expect(await f.rpc.get('read')!({})).toEqual({ counter: 0, rows: [] });
});

it('revokes while real worker commit is queued and prevents counter and SQLite mutation', async () => {
  const f = await peerFixture(`() => { counter++; db.prepare('INSERT INTO receipts VALUES (?)').run('forbidden'); return counter; }`, 300);
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const original = f.lease.commitWorkerSync.bind(f.lease);
  vi.spyOn(f.lease, 'commitWorkerSync').mockImplementation((observe, signal) => original((gate, preflight) => {
    const result = observe(gate, preflight); entered(); return result;
  }, signal));
  const rejected = expect(f.apply()).rejects.toThrow(/active|aborted/);
  await ready; await f.pairs.revoke('pair'); await rejected;
  expect(await f.rpc.get('read')!({})).toEqual({ counter: 0, rows: [] });
});

it('retires Promise-returning commit before delayed continuation can write', async () => {
  const f = await peerFixture(`() => { db.prepare('INSERT INTO receipts VALUES (?)').run('rollback'); return Promise.resolve().then(() => db.prepare('INSERT INTO receipts VALUES (?)').run('forbidden')); }`);
  await expect(f.apply()).rejects.toThrow(/synchronous|exited/);
  await vi.waitFor(() => expect(f.failure).toHaveBeenCalledOnce());
  const { createSqliteDatabase } = await import('@zana-ai/zcc-db');
  const db = createSqliteDatabase(join(f.dir, 'data.db'));
  try { expect(db.prepare('SELECT value FROM receipts').all()).toEqual([]); } finally { db.close(); }
});

it.each([false, true])('retires nested Promise transaction even when callback catches error=%s', async caught => {
  const nested = `db.transaction(() => { db.prepare('INSERT INTO receipts VALUES (?)').run('initial'); return Promise.resolve().then(() => db.prepare('INSERT INTO receipts VALUES (?)').run('late')); });`;
  const f = await peerFixture(`() => { ${caught ? `try { ${nested} } catch {}` : nested} return 42; }`);
  await expect(f.apply()).rejects.toThrow(/synchronous|exited/);
  await vi.waitFor(() => expect(f.failure).toHaveBeenCalledOnce());
  const { createSqliteDatabase } = await import('@zana-ai/zcc-db');
  const db = createSqliteDatabase(join(f.dir, 'data.db'));
  try { expect(db.prepare('SELECT value FROM receipts').all()).toEqual([]); } finally { db.close(); }
});

it.each(['small', 'chunks'])('keeps worker API live after 4201 request-scoped %s fences with multiple commits', async kind => {
  const f = await peerFixture(`() => { counter++; db.prepare('INSERT INTO receipts VALUES (?)').run(request.body.text); return counter; }`);
  const baseline = f.runtime.retainedFunctions;
  for (let index = 0; index < 4201; index++) {
    const lifetime = new AbortController();
    const request = { ...f.request, body: { text: kind === 'chunks' ? 'chunk-'.repeat(256) : 'small', multiple: true },
      signal: lifetime.signal, commitSync: createPluginPeerCommit(f.lease, lifetime.signal) };
    try {
      expect(await f.handle.peerHandlers.get('apply')!(request)).toBe((index + 1) * 2);
    } finally { lifetime.abort(); }
  }
  expect((await f.rpc.get('read')!({}) as any).counter).toBe(8402);
  expect(f.failure).not.toHaveBeenCalled();
  expect(f.runtime.retainedFunctions).toBe(baseline);
}, 120_000);

it('interrupts endless synchronous commit off server thread and rolls back', async () => {
  const f = await peerFixture(`() => { db.prepare('INSERT INTO receipts VALUES (?)').run('rollback'); while (true) {} }`);
  let ticks = 0; const timer = setInterval(() => ticks++, 10);
  const started = Date.now();
  try { await expect(f.apply()).rejects.toThrow(/timed out|exited/); expect(ticks).toBeGreaterThan(100); }
  finally { clearInterval(timer); }
  await vi.waitFor(() => expect(f.failure).toHaveBeenCalledOnce());
  const { createSqliteDatabase } = await import('@zana-ai/zcc-db');
  const db = createSqliteDatabase(join(f.dir, 'data.db'));
  try { expect(db.prepare('SELECT value FROM receipts').all()).toEqual([]); } finally { db.close(); }
  expect(Date.now() - started).toBeLessThan(PEER_WORKER_COMMIT_TIMEOUT_MS);
  await expect(f.pairs.revoke('pair')).resolves.toBeUndefined();
});

// V8 coverage instrumentation (CI) slows the worker past the fixed 5s execution cap and inflates its heap past the
// 256MB cap on 24MiB payloads; the uninstrumented run and e2e/peer-data-boundary exercise this same fence.
it.skipIf(!!(globalThis as { __vitest_worker__?: { config?: { coverage?: { enabled?: boolean } } } }).__vitest_worker__?.config?.coverage?.enabled)('applies and rewrites supported 24MiB Design Docs through production worker fence', async () => {
  expect(PEER_WORKER_EXECUTION_TIMEOUT_MS).toBe(5000);
  expect(PEER_WORKER_COMMIT_TIMEOUT_MS).toBe(10000);
  const entry = pathToFileURL(fileURLToPath(new URL('../../../../e2e/fixtures/peer-design-docs-worker.ts', import.meta.url))).href;
  const source = `export { default } from ${JSON.stringify(entry)};`;
  // Sender fixture generation is not the commit under test; coverage adds heavy hashing overhead.
  const a = await fixture(source, { heartbeatTimeoutMs: 10_000 }), b = await fixture(source);
  await Promise.all([a.runtime.started, b.runtime.started]);
  const members = ['a', 'b'].map(name => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, sponsorReplicaId: null, joinedAt: 1 }));
  for (const [f, replicaId] of [[a, 'replica-a'], [b, 'replica-b']] as const) await f.rpc.get('configure')!({ scope: 'repo', replicaId, members });
  const pairs = new PairStore(join(await realpath(b.dir), 'pairs'), { localInstanceId: 'local', keyProvider: { getKey: async () => Buffer.alloc(32, 1) } });
  cleanups.push(async () => pairs.dispose());
  await pairs.create({ pairId: 'pair', localInstanceId: 'local', remoteInstanceId: 'remote', targetHostId: 'host', pluginId: 'isolation-test', scope: 'repo', proposalId: 'proposal', epoch: 1 });
  const { transferQuery } = await import('../../../../plugins/design-docs/src/server/peer-protocol');
  for (let revision = 0; revision < 2; revision++) {
    const prepared = await a.rpc.get('prepare')!({ grantEpoch: 1 }) as any, transfer = prepared.transfer, query = transferQuery(transfer);
    const dispatch = async (method: string, body: unknown) => {
      const lease = (await pairs.acquireGrant('pair', 1, 'isolation-test', 'repo'))!, lifetime = new AbortController();
      try { return await b.handle.peerHandlers.get(method)!({ peerId: 'machine-a', body, scope: 'repo', grantEpoch: 1, signal: lease.signal,
        commitSync: createPluginPeerCommit(lease, lease.signal, lifetime.signal) }); }
      finally { lifetime.abort(); lease.release(); }
    };
    await dispatch('transfer', transfer);
    const missing = await dispatch('missing', query) as any;
    for (const chunk of missing.chunks) await dispatch('chunk', await a.rpc.get('chunk')!({ transfer, ...chunk }));
    let ticks = 0; const timer = setInterval(() => ticks++, 10), started = Date.now();
    try { expect(await dispatch('apply', query)).toMatchObject({ stage: 'synced', heads: transfer.heads, appliedHeads: transfer.heads }); }
    finally { clearInterval(timer); }
    const elapsed = Date.now() - started;
    expect(ticks).toBeGreaterThan(1);
    expect(elapsed).toBeLessThan(PEER_WORKER_EXECUTION_TIMEOUT_MS);
    const expected = await a.rpc.get('inspect')!(prepared) as any, actual = await b.rpc.get('inspect')!(prepared) as any;
    expect(actual).toMatchObject({ bytes: 24 * 1024 * 1024, files: expected.files, head: transfer.heads[prepared.docId], receipt: { stage: 'synced' }, staged: { n: 0 } });
    console.log(`[peer-fence] 24MiB ${revision ? 'rewrite' : 'initial'} production DD apply ${elapsed}ms; worker live; SQLite hashes/receipt exact`);
  }
  expect(a.failure).not.toHaveBeenCalled(); expect(b.failure).not.toHaveBeenCalled();
}, 120_000);
