import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ workers: [] as any[], constructError: undefined as Error | undefined }));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return { Worker: class extends EventEmitter {
    terminate = vi.fn(async () => 0);
    constructor() {
      super();
      if (state.constructError) throw state.constructError;
      state.workers.push(this);
    }
  } };
});
import { historyQueryWorker } from './history-query-worker';

afterEach(() => {
  for (const worker of state.workers.splice(0)) worker.emit('exit', 0);
  state.constructError = undefined;
  vi.useRealTimers();
});

it('recovers capacity when construction, worker execution or exit fails', async () => {
  state.constructError = Error('cannot create worker');
  await expect(historyQueryWorker('file', 'sql', [])).rejects.toThrow('cannot create worker');
  state.constructError = undefined;
  const failed = historyQueryWorker('file', 'sql', []);
  state.workers.at(-1).emit('error', Error('native failure'));
  await expect(failed).rejects.toThrow('native failure');
  state.workers.at(-1).emit('exit', 1);
  const exited = historyQueryWorker('file', 'sql', []);
  state.workers.at(-1).emit('exit', 1);
  await expect(exited).rejects.toThrow('worker stopped');
  const recovered = historyQueryWorker('file', 'sql', []);
  state.workers.at(-1).emit('message', {});
  expect(await recovered).toEqual([]);
});

it('releases slots after timed-out searches settle without waiting for worker exit', async () => {
  vi.useFakeTimers();
  const first = historyQueryWorker('file', 'sql', []);
  const second = historyQueryWorker('file', 'sql', []);
  const queued = historyQueryWorker('file', 'sql', []);
  const settled = Promise.allSettled([first, second, queued]);
  await vi.advanceTimersByTimeAsync(5000);
  await Promise.resolve();
  expect(state.workers).toHaveLength(3);
  state.workers[2].emit('message', { rows: [{ value: 1 }] });
  const results = await settled;
  expect(results.map(result => result.status === 'rejected' ? result.reason.message : '')).toEqual(['History search timed out', 'History search timed out', '']);
  expect(state.workers.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
  const next = historyQueryWorker('file', 'sql', []);
  expect(state.workers).toHaveLength(4);
  state.workers[3].emit('message', { rows: [{ value: 2 }] });
  expect(await next).toEqual([{ value: 2 }]);
});
