import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { sqliteWorkerConfiguration } from '@zana-ai/zcc-db';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk';
import { createPluginWorkerBridge, PEER_WORKER_COMMIT_TIMEOUT_MS } from './plugin-worker-bridge.js';

/**
 * Silence tolerated from a ready plugin worker before it is declared hung. The worker runs off the server thread, so
 * synchronous plugin work never stalls the app; this only has to separate a wedged worker from a busy one. Plugins
 * legitimately do synchronous SQLite work (Design Docs journals a supported 24MiB paired document in ~0.75s on fast
 * hardware), so the budget keeps several-fold headroom for slower machines and CI runners.
 */
export const PLUGIN_HEARTBEAT_TIMEOUT_MS = 5_000;

let active = 0;
function workerEntry(): string {
  for (const relative of ['./plugin-server-worker.js', '../plugin-server-worker.js', './plugin-server-worker.ts']) {
    const file = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(file)) return file;
  }
  throw new Error('Plugin server worker entry is unavailable');
}

export function resolvePluginWorkerExecArgv(entry: string, requireFn = createRequire(import.meta.url)): string[] {
  return entry.endsWith('.ts') ? ['--import', pathToFileURL(requireFn.resolve('tsx')).href] : [];
}

export function createIsolatedPluginRuntime(options: {
  api: ZccPluginApi; entry: string; generation: number; databasePath: string;
  onFailure(error: Error): void; startupTimeoutMs?: number; heartbeatTimeoutMs?: number;
  admitCall?: () => void;
}) {
  if (active >= 64) throw new Error('Plugin worker capacity exceeded');
  const entry = workerEntry();
  const execArgv = resolvePluginWorkerExecArgv(entry);
  // Encode without exposing filesystem access or authority from a caller's free text.
  // The proxy binds each function to this already authenticated API instance.
  let bridge!: ReturnType<typeof createPluginWorkerBridge>;
  const worker = new Worker(entry, { execArgv, workerData: {}, resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 } });
  active++;
  // One worker termination is shared by the bridge's commit fence and runtime disposal.
  let workerTermination: Promise<number> | undefined;
  const terminate = () => workerTermination ??= worker.terminate();
  bridge = createPluginWorkerBridge(worker, 'server', { terminate, admitCall: options.admitCall });
  let stopped = false;
  let ready = false;
  let apiWaitStarted: number | undefined;
  let lastHeartbeat = Date.now();
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const started = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Disposal can race the installer attaching its await during application shutdown.
  void started.catch(() => {});
  const startup = setTimeout(() => fail(new Error('Plugin factory timed out')), options.startupTimeoutMs ?? 10_000);
  // A synchronous peer commit blocks worker heartbeats, so it is exempt — but only for a bounded grace. The bridge
  // terminates a commit at PEER_WORKER_COMMIT_TIMEOUT_MS; a count that stops moving past that (e.g. a failed
  // termination) must not disable the watchdog forever. Any change in the count is progress and restarts the grace.
  let commitCount = 0, commitProgressAt = 0;
  const commitGraceActive = (now: number) => {
    const count = bridge.activeCommits;
    if (count !== commitCount) { commitCount = count; commitProgressAt = now; }
    return count > 0 && now - commitProgressAt < PEER_WORKER_COMMIT_TIMEOUT_MS + 5_000;
  };
  const watchdog = setInterval(() => {
    if (ready && !commitGraceActive(Date.now()) && !(apiWaitStarted !== undefined && Date.now() - apiWaitStarted < 10_000) && Date.now() - lastHeartbeat > (options.heartbeatTimeoutMs ?? PLUGIN_HEARTBEAT_TIMEOUT_MS)) fail(new Error('Plugin event loop stopped responding'));
  }, 250);
  watchdog.unref();
  let termination: Promise<void> | undefined;
  function dispose(error = new Error('Plugin runtime stopped')): Promise<void> {
    if (termination) return termination;
    stopped = true; clearTimeout(startup); clearInterval(watchdog);
    bridge.dispose(error); if (!ready) rejectReady(error);
    termination = terminate().then(() => undefined);
    void termination.catch(() => {}); // Observe failure immediately; strict teardown still awaits the original promise.
    return termination;
  }
  function fail(error: Error) { if (stopped) return; dispose(error); options.onFailure(error); }
  worker.on('message', message => {
    if (message.kind === 'api-wait') { apiWaitStarted = message.waiting ? Date.now() : undefined; if (!message.waiting) lastHeartbeat = Date.now(); }
    if (message.kind === 'heartbeat') lastHeartbeat = Date.now();
    if (message.kind === 'ready') { ready = true; lastHeartbeat = Date.now(); clearTimeout(startup); resolveReady(); if (message.legacy) dispose(); }
    if (message.kind === 'failure') fail(new Error(message.message));
  });
  worker.once('error', error => fail(error instanceof Error ? error : new Error(String(error))));
  worker.once('exit', () => { active--; fail(new Error('Plugin worker exited')); });
  worker.unref();
  function serviceMember(id: string, method: string) {
    if (['constructor', 'prototype', '__proto__'].includes(method)) throw new Error('Invalid plugin service method');
    const service = options.api.services.use<Record<string, unknown>>(id);
    return { present: method in service, value: service[method] };
  }
  // Observe a provider's actual return kind before waiting for its result. This
  // preserves both synchronous methods and ordinary functions returning Promises.
  const callService = async (id: string, method: string, args: unknown[]) => {
    const fn = serviceMember(id, method).value;
    if (typeof fn !== 'function') throw new Error(`Unknown plugin service method: ${method}`);
    const observe = Reflect.get(fn, '__zccPluginInvokeObserved');
    if (typeof observe === 'function') return observe(...args);
    const result = fn(...args);
    if (result && typeof result.then === 'function') {
      const promise = Promise.resolve(result);
      void promise.catch(() => {});
      const follow = () => promise;
      Object.defineProperty(follow, '__zccPluginOnce', { value: true });
      return { asynchronous: true, value: follow };
    }
    return { asynchronous: false, value: result };
  };
  // A first message supplies the API after the endpoint is listening.
  try { worker.postMessage({ kind: 'initialize', data: {
    api: bridge.encode(options.api),
    callService: bridge.encode((id: string, method: string, args: unknown[]) => callService(id, method, args)),
    serviceMember: bridge.encode((id: string, method: string) => {
      const member = serviceMember(id, method);
      return { present: member.present, method: typeof member.value === 'function', value: typeof member.value === 'function' ? undefined : member.value };
    }),
    entry: options.entry, generation: options.generation, databasePath: options.databasePath, sqlite: sqliteWorkerConfiguration()
  }}); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  return { started, dispose, isBusy: () => bridge.isBusy(), get retainedFunctions() { return bridge.retainedFunctions; } };
}
