import { afterEach, expect, it, vi } from 'vitest';
import { startDeferredRetryLoop } from './deferred-retry-loop.js';
import { isRetryableDeferredFailure } from './conversation-deferred-messages.js';
import { ThreadCreateError } from '../../http/thread-create.js';
afterEach(() => vi.useRealTimers());
it('does not overlap sweeps, survives failure, and stops on disposal', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const sweep = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }))
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const stop = startDeferredRetryLoop(sweep, 100);
  await vi.advanceTimersByTimeAsync(500);
  expect(sweep).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(200);
  expect(sweep).toHaveBeenCalledTimes(3);
  stop();
  await vi.advanceTimersByTimeAsync(500);
  expect(sweep).toHaveBeenCalledTimes(3);
});
it.each([
  [new ThreadCreateError(409, 'already_active', 'busy'), true],
  [new ThreadCreateError(403, 'forbidden', 'denied'), false],
  [{ code: 'host-unavailable', message: 'host h is not connected' }, true],
  [{ code: 'host-unavailable', message: 'host h disconnected' }, false],
  [{ code: 'host-unavailable', message: 'host rpc timed out' }, false],
  [{ code: 'busy', delivery: 'rejected' }, true],
  [{ code: 'busy' }, false],
  [{ code: 'unauthorized', delivery: 'rejected' }, false],
  [null, false], [new Error('bad payload'), false]
])('classifies safe retries (%j)', (error, expected) => {
  expect(isRetryableDeferredFailure(error)).toBe(expected);
});
