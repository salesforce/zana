import { describe, expect, it, vi } from 'vitest';
import { WorkloadMemo, WORKLOAD_MEMO_SKIPPED } from './workload-memo.js';

describe('WorkloadMemo', () => {
  it('reuses successful values and does not retain failures', async () => {
    const memo = new WorkloadMemo();
    const compute = vi.fn(async () => ({ value: 'cached' }));
    await expect(memo.getOrCompute('test', 'key', 1_000, compute)).resolves.toEqual({ value: 'cached' });
    await expect(memo.getOrCompute('test', 'key', 1_000, compute)).resolves.toEqual({ value: 'cached' });
    expect(compute).toHaveBeenCalledTimes(1);

    const failed = vi.fn(async () => undefined);
    await memo.getOrCompute('test', 'failed', 1_000, failed);
    await memo.getOrCompute('test', 'failed', 1_000, failed);
    expect(failed).toHaveBeenCalledTimes(2);
    expect(memo.snapshot().test.failures).toBe(2);
  });

  it('coalesces matching work and expires values', async () => {
    let now = 0;
    const memo = new WorkloadMemo(() => now);
    let resolve!: (value: string) => void;
    const compute = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const first = memo.getOrCompute('test', 'key', 10, compute);
    const second = memo.getOrCompute('test', 'key', 10, compute);
    resolve('value');
    await expect(Promise.all([first, second])).resolves.toEqual(['value', 'value']);
    expect(compute).toHaveBeenCalledTimes(1);
    now = 11;
    await memo.getOrCompute('test', 'key', 10, async () => 'new');
    await expect(memo.getOrCompute('test', 'key', 10, async () => 'wrong')).resolves.toBe('new');
  });

  it('evicts least-recently-used values at its entry bound and clears retained values', async () => {
    const memo = new WorkloadMemo(() => 0, 2);
    await memo.getOrCompute('test', 'one', 10, async () => 'one');
    await memo.getOrCompute('test', 'two', 10, async () => 'two');
    await memo.getOrCompute('test', 'one', 10, async () => 'wrong'); // promote one
    await memo.getOrCompute('test', 'three', 10, async () => 'three');
    await expect(memo.getOrCompute('test', 'two', 10, async () => 'new')).resolves.toBe('new');
    memo.clear();
    await expect(memo.getOrCompute('test', 'one', 10, async () => 'after-clear')).resolves.toBe('after-clear');
  });

  it('cleans up rejected work without retaining it', async () => {
    const memo = new WorkloadMemo();
    await expect(memo.getOrCompute('test', 'reject', 10, async () => { throw new Error('no'); })).rejects.toThrow('no');
    await expect(memo.getOrCompute('test', 'reject', 10, async () => 'recovered')).resolves.toBe('recovered');
  });

  it('bounds distinct active work while preserving matching joins', async () => {
    let resolve!: (value: string) => void;
    const memo = new WorkloadMemo(() => 0, 128, 1024, 1);
    const first = memo.getOrCompute('test', 'one', 10, () => new Promise<string>((done) => { resolve = done; }));
    expect(await memo.getOrCompute('test', 'two', 10, async () => 'two')).toBe(WORKLOAD_MEMO_SKIPPED);
    const joined = memo.getOrCompute('test', 'one', 10, async () => 'wrong');
    resolve('one');
    await expect(Promise.all([first, joined])).resolves.toEqual(['one', 'one']);
  });

  it('records bounded per-workload counters', async () => {
    const memo = new WorkloadMemo(() => 0, 1, 1024, 1);
    await memo.getOrCompute('summary', 'one', 10, async () => 'one');
    await memo.getOrCompute('summary', 'one', 10, async () => 'wrong');
    await memo.getOrCompute('summary', 'two', 10, async () => 'two');

    expect(memo.snapshot()).toEqual({
      summary: {
        requests: 3,
        hits: 1,
        misses: 2,
        inFlightJoins: 0,
        activeLimitSkips: 0,
        evictions: 1,
        providerCalls: 2,
        failures: 0
      }
    });
  });

  it('does not retain a value completed after invalidation', async () => {
    const memo = new WorkloadMemo();
    let resolve!: (value: string) => void;
    const pending = memo.getOrCompute('summary', 'key', 10, () => new Promise<string>((done) => { resolve = done; }));
    memo.clear();
    resolve('stale');
    await expect(pending).resolves.toBe('stale');

    await expect(memo.getOrCompute('summary', 'key', 10, async () => 'fresh')).resolves.toBe('fresh');
  });

  it('retains active-call capacity after invalidation until stale work settles', async () => {
    const memo = new WorkloadMemo(() => 0, 128, 1024, 1);
    let resolve!: (value: string) => void;
    const stale = memo.getOrCompute('summary', 'stale', 10, () => new Promise<string>((done) => { resolve = done; }));
    memo.clear();
    await expect(memo.getOrCompute('summary', 'fresh', 10, async () => 'fresh')).resolves.toBe(WORKLOAD_MEMO_SKIPPED);
    resolve('stale');
    await stale;
    await expect(memo.getOrCompute('summary', 'fresh', 10, async () => 'fresh')).resolves.toBe('fresh');
  });

  it('bounds distinct counter buckets', async () => {
    const memo = new WorkloadMemo();
    for (let i = 0; i < 10; i++) await memo.getOrCompute(`workload-${i}`, 'key', 10, async () => 'value');
    expect(Object.keys(memo.snapshot())).toHaveLength(9);
    expect(memo.snapshot().other.requests).toBe(2);
  });
});
