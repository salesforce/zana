import { isMainThread, parentPort } from 'node:worker_threads';
import { runInNewContext } from 'node:vm';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { applyPluginSqliteMigrations } from './plugin-database-migrations.js';
import { backupCopyHandle, createPluginDatabaseBackup } from './plugin-database-backup.js';
import { createPluginWorkerBridge, PEER_WORKER_EXECUTION_TIMEOUT_MS } from './plugin-worker-bridge.js';
import type { ZccPluginApi, PluginDatabase } from '@zana-ai/zcc-plugin-sdk';

export async function runPluginWorker(port = parentPort) {
  if (!port) throw new Error('Plugin worker requires a parent port');
  const workerData = await new Promise<any>(resolve => port.once('message', message => resolve(message.data)));
  let database: any;
  let databaseApi: PluginDatabase | undefined;
  let commitState: { asyncInvalid: boolean } | undefined;
  const bridge = createPluginWorkerBridge(port, 'plugin', { commitSync: callback => {
    const state = { asyncInvalid: false };
    commitState = state;
    try {
      const run = () => {
        const result = runInNewContext('callback()', { callback }, { timeout: PEER_WORKER_EXECUTION_TIMEOUT_MS });
        if (result && typeof result.then === 'function') {
          state.asyncInvalid = true;
          void Promise.resolve(result).catch(() => {});
          throw new Error('peer commit fence requires synchronous callback');
        }
        if (state.asyncInvalid) throw new Error('peer commit fence requires synchronous callback');
        return result;
      };
      // Open the worker-owned database before the callback so first-use writes roll back too.
      api.storage.database();
      return database.transaction(run)();
    } catch (error) {
      if (state.asyncInvalid || (error as { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        // A rejected async continuation must never get another turn to write.
        port.postMessage({ kind: 'failure', message: error instanceof Error ? error.message : String(error) });
        database?.close();
        if (!isMainThread) process.exit(1);
      }
      throw error;
    } finally { commitState = undefined; }
  } });
  const api = bridge.decode(workerData.api) as ZccPluginApi;
  const callService = bridge.decode(workerData.callService) as (id: string, method: string, args: unknown[]) => { asynchronous: boolean; value: any };
  const serviceMember = bridge.decode(workerData.serviceMember) as (id: string, method: string) => { method: boolean; present: boolean; value: unknown };
  const require = createRequire(import.meta.url);

  api.storage.database = (): PluginDatabase => {
    if (databaseApi) return databaseApi;
    if (!database) {
      const Sqlite = require(workerData.sqlite.modulePath);
      database = new Sqlite(workerData.databasePath, { nativeBinding: workerData.sqlite.nativeBinding, timeout: 25 });
      database.pragma('journal_mode = WAL');
    }
    const db = database;
    databaseApi = {
      prepare: sql => db.prepare(sql),
      runScript: sql => { db.exec(sql); },
      transaction: fn => db.transaction(() => {
        if (fn.constructor.name === 'AsyncFunction') throw new Error('Plugin database transaction requires synchronous callback');
        const result = fn();
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          if (commitState) commitState.asyncInvalid = true;
          void Promise.resolve(result).catch(() => {});
          throw new Error('Plugin database transaction requires synchronous callback');
        }
        if (commitState?.asyncInvalid) throw new Error('Plugin database transaction requires synchronous callback');
        return result;
      })(),
      migrate: statements => applyPluginSqliteMigrations(sql => db.exec(sql), sql => db.prepare(sql), fn => db.transaction(fn)(), statements)
    };
    return databaseApi;
  };
  // Backups stay in the worker: the parent never opens the isolated plugin's database.
  const backupLifetime = new AbortController();
  api.storage.backupDatabase = createPluginDatabaseBackup({
    pluginId: String(api.pluginId ?? 'plugin'),
    pluginDir: dirname(workerData.databasePath),
    lifetime: backupLifetime.signal,
    source: () => { api.storage.database(); return database; },
    openCopy: (file) => backupCopyHandle(new (require(workerData.sqlite.modulePath))(file, { nativeBinding: workerData.sqlite.nativeBinding, timeout: 25 }))
  });
  api.services.use = <T extends object>(id: string): T => new Proxy({} as T, {
    get(_target, method) {
      if (method === 'then' || typeof method === 'symbol') return undefined;
      const member = serviceMember(id, method);
      if (!member.method) return member.value;
      return (...args: unknown[]) => {
        const result = callService(id, method, args);
        return result.asynchronous ? result.value() : result.value;
      };
    },
    has(_target, method) { return typeof method === 'string' && serviceMember(id, method).present; }
  });
  // Contracts are advisory in core; validation wrappers and closures stay in the worker.
  api.rpc.register = (_contract, handlers) => { for (const [name, handler] of Object.entries(handlers)) api.rpc.method(name, handler as (args: unknown) => unknown); };

  const heartbeat = setInterval(() => port.postMessage({ kind: 'heartbeat' }), 100);
  port.on('close', () => { clearInterval(heartbeat); backupLifetime.abort(); bridge.dispose(); database?.close(); });
  try {
    const entry = workerData.entry as string;
    let mod: { default?: unknown };
    if (/\.tsx?$/.test(entry)) {
      const imported = await import('jiti');
      const createJiti = imported.createJiti ?? (imported.default as any)?.createJiti ?? imported.default;
      if (typeof createJiti !== 'function') throw new Error('jiti createJiti is unavailable');
      mod = await createJiti(import.meta.url, { moduleCache: false, fsCache: false }).import(entry);
    } else { mod = await import(`${pathToFileURL(entry).href}?v=${workerData.generation}`); }
    if (typeof mod.default === 'function') {
      await mod.default(api);
      port.postMessage({ kind: 'ready' });
    } else if (mod.default && typeof mod.default === 'object' && typeof (mod.default as any).setup === 'function') {
      // Legacy MainModule setup still belongs to its existing desktop process host.
      port.postMessage({ kind: 'ready', legacy: true });
    } else { throw new Error(`plugin server entry must default-export a factory: ${entry}`); }
  } catch (error) {
    port.postMessage({ kind: 'failure', message: error instanceof Error ? error.message : String(error) });
  }
}
void runPluginWorker().catch(error => parentPort?.postMessage({ kind: 'failure', message: error instanceof Error ? error.message : String(error) }));
