import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createPluginApi } from './plugin-api';
import { createIsolatedPluginRuntime, resolvePluginWorkerExecArgv } from './isolated-plugin-runtime';
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
  cleanups.push(async () => runtime.dispose()); return { runtime, handle, failure, rpc };
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
  const f = await fixture('export default () => new Promise(() => {})'); f.runtime.dispose(); await expect(f.runtime.started).rejects.toThrow('stopped'); expect(f.failure).not.toHaveBeenCalled();
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
