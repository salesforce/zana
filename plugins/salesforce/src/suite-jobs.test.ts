import { expect, it, vi } from 'vitest';
import { SuiteJobs } from '../lib/suite-jobs.js';

it('returns immediately, deduplicates retries, isolates projects and retains the result', async () => {
  const jobs = new SuiteJobs();
  let finish!: (value: unknown) => void;
  const work = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const first = jobs.start('p', 'retry-1', 'hash', work);
  expect(first.status).toBe('running');
  expect(jobs.start('p', 'retry-1', 'hash', work).jobId).toBe(first.jobId);
  expect(() => jobs.start('p', 'retry-1', 'changed', work)).toThrow('different');
  expect(() => jobs.start('p', undefined, 'hash', work)).toThrow('already running');
  expect(() => jobs.get('other', first.jobId)).toThrow('another project');
  expect(() => jobs.stop('other', first.jobId)).toThrow('another project');
  expect(jobs.latest('p')?.jobId).toBe(first.jobId);
  expect(jobs.latest('other')).toBeNull();
  await Promise.resolve();
  expect(work).toHaveBeenCalledOnce();
  finish({ ok: true, results: { a: 'pass' } });
  await vi.waitFor(() => expect(jobs.get('p', first.jobId)).toMatchObject({ status: 'completed', result: { ok: true } }));
  expect(jobs.start('p', 'retry-1', 'hash', work).status).toBe('completed');
  expect(jobs.stop('p', first.jobId).status).toBe('completed');
});

it('aborts on stop and disposal, consumes late errors and refuses new work after disposal', async () => {
  const jobs = new SuiteJobs();
  let signal!: AbortSignal;
  let reject!: (error: Error) => void;
  const job = jobs.start('p', undefined, 'a', async s => { signal = s; return new Promise((_, fail) => { reject = fail; }); });
  await Promise.resolve();
  expect(jobs.stop('p', job.jobId).status).toBe('stopped');
  expect(signal.aborted).toBe(true);
  reject(Error('late error'));
  await Promise.resolve(); await Promise.resolve();
  expect(jobs.get('p', job.jobId).status).toBe('stopped');
  jobs.start('p', undefined, 'b', async s => { signal = s; return new Promise(() => {}); });
  await Promise.resolve(); jobs.dispose();
  expect(signal.aborted).toBe(true);
  expect(() => jobs.get('p', job.jobId)).toThrow('expired');
  expect(() => jobs.start('p', undefined, 'x', async () => null)).toThrow('closed');
});

it('reports bounded errors and oversized results, prunes old jobs and bounds running jobs', async () => {
  let now = 0;
  const jobs = new SuiteJobs(() => now);
  expect(() => jobs.start('p', 'invalid request', '', async () => null)).toThrow('requestId');
  const failed = jobs.start('p', 'f', '', async () => { throw 'x'.repeat(2000); });
  await vi.waitFor(() => expect(jobs.get('p', failed.jobId).status).toBe('failed'));
  expect(jobs.get('p', failed.jobId).error).toHaveLength(1000);
  const large = jobs.start('p', 'large', '', async () => 'x'.repeat(750001));
  await vi.waitFor(() => expect(jobs.get('p', large.jobId)).toMatchObject({ status: 'failed', error: expect.stringContaining('display limit') }));
  now = 86_400_001;
  for (let i = 0; i < 40; i++) jobs.start(`p${i}`, undefined, '', async () => new Promise(() => {}));
  expect(() => jobs.get('p', failed.jobId)).toThrow('expired');
  expect(() => jobs.start('full', undefined, '', async () => null)).toThrow('capacity');
  jobs.dispose();
});
