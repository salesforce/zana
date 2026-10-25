import { afterEach, expect, it, vi } from 'vitest';
import { runSuiteJob, SuiteStoppedError } from './suite-job-rpc.js';
afterEach(() => vi.useRealTimers());

it('distinguishes intentional cancellation from a failed stop request', async () => {
  const call = vi.fn().mockResolvedValueOnce({ ok: true, jobId: 'j' }).mockResolvedValueOnce({ ok: true, status: 'stopped' });
  await expect(runSuiteJob(call, {}, new AbortController().signal, vi.fn())).rejects.toBeInstanceOf(SuiteStoppedError);
  call.mockResolvedValueOnce({ ok: true, jobId: 'j' }).mockResolvedValueOnce({ ok: false, status: 'stopped', error: 'denied' });
  await expect(runSuiteJob(call, {}, new AbortController().signal, vi.fn())).rejects.toThrow('denied');
});

it('polls a short handle through completion without resubmitting the run', async () => {
  vi.useFakeTimers();
  const call = vi.fn().mockResolvedValueOnce({ ok: true, jobId: 'j' }).mockResolvedValueOnce({ ok: true, status: 'running' }).mockResolvedValueOnce({ ok: true, status: 'completed', result: { ok: true, results: {} } });
  const onJob = vi.fn();
  const running = runSuiteJob(call, { source: 'snapshot' }, new AbortController().signal, onJob);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await running).toEqual({ ok: true, results: {} });
  expect(call.mock.calls.map(c => c[0])).toEqual(['studio.suites.start', 'studio.suites.result', 'studio.suites.result']);
  expect(call.mock.calls[0]?.[1]).toMatchObject({ source: 'snapshot', requestId: expect.any(String) });
  expect(onJob.mock.calls).toEqual([['j'], [null]]);
});

it.each([
  [{ ok: false, error: 'denied' }, undefined, 'denied'],
  [{ ok: true }, undefined, 'run handle'],
  [{ ok: true, jobId: 'j' }, { status: 'failed', error: 'failed job' }, 'failed job'],
  [{ ok: true, jobId: 'j' }, { status: 'stopped' }, 'Suite stopped'],
  [{ ok: true, jobId: 'j' }, { ok: false }, 'recover'],
])('explains start and recovery failures', async (start, result, message) => {
  const call = vi.fn().mockResolvedValueOnce(start).mockResolvedValueOnce(result);
  await expect(runSuiteJob(call, {}, new AbortController().signal, vi.fn())).rejects.toThrow(message);
});

it('releases its timer when the view closes and leaves server work running', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const call = vi.fn().mockResolvedValueOnce({ ok: true, jobId: 'j' }).mockResolvedValue({ status: 'running' });
  const running = runSuiteJob(call, {}, controller.signal, vi.fn());
  const failure = expect(running).rejects.toThrow('continues');
  await vi.advanceTimersByTimeAsync(1);
  controller.abort(); await failure;
  expect(vi.getTimerCount()).toBe(0);
  expect(call).toHaveBeenCalledTimes(2);
});
