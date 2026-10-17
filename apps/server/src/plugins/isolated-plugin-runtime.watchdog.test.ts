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
const { createIsolatedPluginRuntime } = await import('./isolated-plugin-runtime.js');

afterEach(() => { vi.useRealTimers(); state.activeCommits = 0; state.workers.length = 0; });

function start() {
  const onFailure = vi.fn();
  const runtime = createIsolatedPluginRuntime({ api: {} as never, entry: 'x', generation: 1, databasePath: 'db', onFailure, heartbeatTimeoutMs: 1_000 });
  const worker = state.workers.at(-1) as EventEmitter;
  worker.emit('message', { kind: 'ready' });
  return { runtime, onFailure, worker };
}

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
