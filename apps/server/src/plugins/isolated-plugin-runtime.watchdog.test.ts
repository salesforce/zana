import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@zana-ai/zcc-db', () => ({ sqliteWorkerConfiguration: () => ({}) }));

const state = vi.hoisted(() => ({ activeCommits: 0, workers: [] as Array<import('node:events').EventEmitter> }));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class Worker extends Emitter {
    constructor() { super(); state.workers.push(this); }
    postMessage() {}
    unref() {}
    terminate() { return Promise.resolve(0); }
  }
  return { Worker };
});
vi.mock('./plugin-worker-bridge.js', () => ({
  PEER_WORKER_COMMIT_TIMEOUT_MS: 10_000,
  createPluginWorkerBridge: () => ({ get activeCommits() { return state.activeCommits; }, dispose: vi.fn(), encode: vi.fn(() => ({})), retainedFunctions: 0 })
}));
const { createIsolatedPluginRuntime, PLUGIN_HEARTBEAT_TIMEOUT_MS } = await import('./isolated-plugin-runtime.js');

afterEach(() => { vi.useRealTimers(); state.activeCommits = 0; state.workers.length = 0; });

function initialize(options: { entry?: string; heartbeatTimeoutMs?: number; startupTimeoutMs?: number } = {}) {
  const onFailure = vi.fn();
  const runtime = createIsolatedPluginRuntime({ api: {} as never, entry: 'x', generation: 1, databasePath: 'db', onFailure, ...options });
  const worker = state.workers.at(-1) as EventEmitter;
  return { runtime, onFailure, worker };
}

function start(timeout: { heartbeatTimeoutMs?: number } = { heartbeatTimeoutMs: 1_000 }) {
  const f = initialize(timeout);
  f.worker.emit('message', { kind: 'ready' });
  return f;
}

it.each(['server.ts', 'server.tsx'])('allows a cold source import to finish after the compiled deadline: %s', async entry => {
  vi.useFakeTimers();
  const f = initialize({ entry });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(f.onFailure).not.toHaveBeenCalled();
  f.worker.emit('message', { kind: 'ready' });
  await expect(f.runtime.started).resolves.toBeUndefined();
  // A slow source import must not extend the watchdog once the plugin is ready.
  await vi.advanceTimersByTimeAsync(5_000);
  expect(f.onFailure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(250);
  expect(f.onFailure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Plugin event loop stopped responding' }));
  await f.runtime.dispose();
});

it.each(['server.mjs', 'server.js', 'server.ts.mjs'])('keeps the compiled startup deadline at ten seconds: %s', async entry => {
  vi.useFakeTimers();
  const f = initialize({ entry });
  await vi.advanceTimersByTimeAsync(9_999);
  expect(f.onFailure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await expect(f.runtime.started).rejects.toThrow('Plugin factory timed out');
  expect(f.onFailure).toHaveBeenCalledOnce();
  await f.runtime.dispose();
});

it('still terminates a source factory that exceeds its bounded startup allowance', async () => {
  vi.useFakeTimers();
  const f = initialize({ entry: 'server.ts' });
  // Heartbeats during imports do not waive the absolute startup deadline.
  for (let i = 0; i < 3; i++) {
    await vi.advanceTimersByTimeAsync(5_000);
    f.worker.emit('message', { kind: 'heartbeat' });
  }
  await vi.advanceTimersByTimeAsync(4_999);
  expect(f.onFailure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await expect(f.runtime.started).rejects.toThrow('Plugin factory timed out');
  expect(f.onFailure).toHaveBeenCalledOnce();
  await f.runtime.dispose();
});

it.each(['server.ts', 'server.mjs'])('honors an explicit startup deadline for %s', async entry => {
  vi.useFakeTimers();
  const f = initialize({ entry, startupTimeoutMs: 700 });
  await vi.advanceTimersByTimeAsync(699);
  expect(f.onFailure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await expect(f.runtime.started).rejects.toThrow('Plugin factory timed out');
  expect(f.onFailure).toHaveBeenCalledOnce();
  await f.runtime.dispose();
});

it('tolerates bounded synchronous plugin work by default and still fails a wedged worker', async () => {
  vi.useFakeTimers();
  expect(PLUGIN_HEARTBEAT_TIMEOUT_MS).toBe(5_000);
  const f = start({});
  // A supported 24MiB Design Docs journal blocks a slow runner for seconds; the old 1.5s budget killed it.
  await vi.advanceTimersByTimeAsync(4_500);
  expect(f.onFailure).not.toHaveBeenCalled();
  // A heartbeat restarts the budget.
  f.worker.emit('message', { kind: 'heartbeat' });
  await vi.advanceTimersByTimeAsync(4_500);
  expect(f.onFailure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(f.onFailure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Plugin event loop stopped responding' }));
  f.runtime.dispose();
});

it('exempts an in-flight peer commit from the heartbeat check only for a bounded grace', async () => {
  vi.useFakeTimers();
  const f = start();
  state.activeCommits = 1;
  // Well past the heartbeat timeout but inside the commit grace: a blocking commit is not a hung worker.
  await vi.advanceTimersByTimeAsync(10_000);
  expect(f.onFailure).not.toHaveBeenCalled();
  // A commit count that never moves (e.g. the worker failed to terminate) no longer disables the watchdog.
  await vi.advanceTimersByTimeAsync(5_500);
  expect(f.onFailure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Plugin event loop stopped responding' }));
  f.runtime.dispose();
});

it('treats a changing commit count as progress and restarts the grace', async () => {
  vi.useFakeTimers();
  const f = start();
  for (let i = 0; i < 4; i++) {
    state.activeCommits = 1 + (i % 2);
    await vi.advanceTimersByTimeAsync(10_000);
  }
  expect(f.onFailure).not.toHaveBeenCalled();
  // With no commits in flight the ordinary heartbeat check applies immediately.
  state.activeCommits = 0;
  await vi.advanceTimersByTimeAsync(500);
  expect(f.onFailure).toHaveBeenCalledOnce();
  f.runtime.dispose();
});
