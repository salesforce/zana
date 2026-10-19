import { describe, expect, it, vi } from 'vitest';
import { createCoalescedReconciler } from './coalesced-reconciler.js';

describe('coalesced reconciler', () => {
  it('coalesces idle triggers and serializes one queued rerun', async () => {
    let release!: () => void;
    const run = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }))
      .mockResolvedValue(undefined);
    const reconciler = createCoalescedReconciler(run, vi.fn());
    const done = reconciler.request();
    expect(reconciler.request()).toBe(done);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 100; i++) expect(reconciler.request()).toBe(done);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await done;
    expect(run).toHaveBeenCalledTimes(2);
    await reconciler.request();
    expect(run).toHaveBeenCalledTimes(3);
    await reconciler.dispose();
  });

  it('catches sync throws and async rejection, then runs again', async () => {
    const failure = new Error('failed');
    const run = vi.fn().mockImplementationOnce(() => { throw failure; })
      .mockRejectedValueOnce('secret').mockResolvedValue(undefined);
    const warn = vi.fn();
    const reconciler = createCoalescedReconciler(run, warn);
    await reconciler.request();
    await reconciler.request();
    await reconciler.request();
    expect(run).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls).toEqual([[failure], ['secret']]);
    await reconciler.dispose();
  });

  it('dispose waits for active work, drops queued work, and refuses later triggers', async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const reconciler = createCoalescedReconciler(run, vi.fn());
    const done = reconciler.request();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    void reconciler.request();
    let stopped = false;
    const disposing = reconciler.dispose().then(() => { stopped = true; });
    await reconciler.request();
    expect(stopped).toBe(false);
    release();
    await Promise.all([done, disposing]);
    await reconciler.request();
    await reconciler.dispose();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('dispose before the first microtask prevents any work', async () => {
    const run = vi.fn();
    const reconciler = createCoalescedReconciler(run, vi.fn());
    const done = reconciler.request();
    await reconciler.dispose();
    await done;
    await reconciler.request();
    expect(run).not.toHaveBeenCalled();
  });
});
