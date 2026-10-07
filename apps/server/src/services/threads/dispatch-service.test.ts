import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConversationThread, createEnvironment, getDispatchAdmissionGeneration, openDatabase, upsertHost } from '@zana-ai/zcc-db';
import { describe, expect, it, vi } from 'vitest';
import { admitDispatch } from './dispatch-service.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-dispatch-service-'));
  const db = openDatabase(join(dir, 'runtime.sqlite'));
  const host = upsertHost(db, { name: 'host', hostKeyHash: 'hash' });
  const environment = createEnvironment(db, { projectId: 'project', hostId: host.id });
  const thread = createConversationThread(db, {
    projectId: 'project',
    hostId: host.id,
    environmentId: environment.id,
    providerId: 'claude-code'
  });
  const request = { threadId: thread.id, projectId: 'project' };
  return {
    db,
    request,
    ctx(admit: ReturnType<typeof vi.fn>) {
      return { db, plugins: { admitDispatch: admit } } as never;
    },
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

describe('admitDispatch', () => {
  it.each(['wait', 'proceed', 'reject', 'error'])('does not mutate admission state after cancellation during a late %s', async action => {
    const f = fixture();
    try {
      await admitDispatch(f.ctx(vi.fn().mockResolvedValue({ action: 'wait', reason: 'prior', overrideable: true })), f.request);
      const previous = getDispatchAdmissionGeneration(f.db, f.request.threadId);
      let complete!: (value: unknown) => void;
      let fail!: (error: Error) => void;
      let cancelled = false;
      const admit = vi.fn(() => new Promise((resolve, reject) => { complete = resolve; fail = reject; }));
      const cancellation = new Error('send_cancelled');
      const pending = admitDispatch(f.ctx(admit), f.request, () => { if (cancelled) throw cancellation; });
      const rejected = expect(pending).rejects.toBe(cancellation);
      cancelled = true;
      if (action === 'error') fail(new Error('plugin failed'));
      else complete(action === 'wait' ? { action, reason: 'late', overrideable: true } : { action, message: 'rejected' });
      await rejected;
      expect(getDispatchAdmissionGeneration(f.db, f.request.threadId)).toEqual(previous);
    } finally { f.cleanup(); }
  });
  it('forwards a wait decision and mints generation 1 for a fresh thread', async () => {
    const f = fixture();
    try {
      const admit = vi.fn().mockResolvedValue({ action: 'wait', reason: 'capacity', overrideable: true });
      await expect(admitDispatch(f.ctx(admit), f.request)).resolves.toEqual({
        decision: { action: 'wait', reason: 'capacity', overrideable: true },
        generation: 1,
        pluginId: undefined
      });
      expect(admit).toHaveBeenCalledWith({ ...f.request, generation: 1, dispatchId: expect.any(String) });
    } finally { f.cleanup(); }
  });

  it('increments the generation across successive waits on the same thread', async () => {
    const f = fixture();
    try {
      const admit = vi.fn().mockResolvedValue({ action: 'wait', reason: 'capacity', overrideable: true });
      await admitDispatch(f.ctx(admit), f.request);
      const second = await admitDispatch(f.ctx(admit), f.request);
      expect(second.generation).toBe(2);
      // The plugin sees the generation in effect *before* this wait is recorded.
      expect(admit).toHaveBeenLastCalledWith({ ...f.request, generation: 1, dispatchId: expect.any(String) });
    } finally { f.cleanup(); }
  });

  it('clears the recorded generation on proceed so the next wait starts fresh', async () => {
    const f = fixture();
    try {
      const admit = vi.fn()
        .mockResolvedValueOnce({ action: 'wait', reason: 'capacity', overrideable: true })
        .mockResolvedValueOnce({ action: 'proceed' })
        .mockResolvedValueOnce({ action: 'wait', reason: 'capacity again', overrideable: true });
      await admitDispatch(f.ctx(admit), f.request);
      await admitDispatch(f.ctx(admit), f.request);
      const third = await admitDispatch(f.ctx(admit), f.request);
      expect(third.generation).toBe(1);
    } finally { f.cleanup(); }
  });

  it('forwards a reject decision without recording a generation', async () => {
    const f = fixture();
    try {
      const admit = vi.fn().mockResolvedValue({ action: 'reject', message: 'blocked' });
      await expect(admitDispatch(f.ctx(admit), f.request)).resolves.toEqual({
        decision: { action: 'reject', message: 'blocked' },
        generation: 1
      });
    } finally { f.cleanup(); }
  });

  it('a reject clears an earlier overrideable wait so it cannot be Send-now\'d through after the reject', async () => {
    const f = fixture();
    try {
      const admit = vi.fn()
        .mockResolvedValueOnce({ action: 'wait', reason: 'capacity', overrideable: true })
        .mockResolvedValueOnce({ action: 'reject', message: 'blocked' });
      const waited = await admitDispatch(f.ctx(admit), f.request);
      expect(waited.decision.action).toBe('wait');
      await admitDispatch(f.ctx(admit), f.request);
      // The stale generation from the pre-reject wait must be gone, not just superseded in memory.
      const { getDispatchAdmissionGeneration } = await import('@zana-ai/zcc-db');
      expect(getDispatchAdmissionGeneration(f.db, f.request.threadId)).toBeNull();
    } finally { f.cleanup(); }
  });

  it('a non-overrideable wait reports overrideable: false for the queued caller to enforce', async () => {
    const f = fixture();
    try {
      const admit = vi.fn().mockResolvedValue({ action: 'wait', reason: 'policy', overrideable: false });
      const outcome = await admitDispatch(f.ctx(admit), f.request);
      expect(outcome.decision).toMatchObject({ action: 'wait', overrideable: false });
    } finally { f.cleanup(); }
  });

  it('attributes a wait to the plugin id supplied by the admission handler', async () => {
    const f = fixture();
    try {
      const admit = vi.fn().mockResolvedValue({ action: 'wait', reason: 'capacity', overrideable: true, pluginId: 'platform-hooks-probe' });
      const outcome = await admitDispatch(f.ctx(admit), f.request);
      expect(outcome.pluginId).toBe('platform-hooks-probe');
    } finally { f.cleanup(); }
  });

  it('rejects when plugin admission throws', async () => {
    const f = fixture();
    try {
      const admit = vi.fn().mockRejectedValue(new Error('plugin died'));
      await expect(admitDispatch(f.ctx(admit), f.request)).resolves.toEqual({
        decision: { action: 'reject', message: 'Plugin dispatch admission unavailable' },
        generation: 1
      });
    } finally { f.cleanup(); }
  });

  it('clears a previous wait after plugin failure', async () => {
    const f = fixture();
    try {
      const admit = vi.fn()
        .mockResolvedValueOnce({ action: 'wait', reason: 'capacity', overrideable: true })
        .mockRejectedValueOnce(new Error('plugin died'));
      await admitDispatch(f.ctx(admit), f.request);
      expect(getDispatchAdmissionGeneration(f.db, f.request.threadId)).not.toBeNull();
      await expect(admitDispatch(f.ctx(admit), f.request)).resolves.toMatchObject({ decision: { action: 'reject' } });
      expect(getDispatchAdmissionGeneration(f.db, f.request.threadId)).toBeNull();
    } finally { f.cleanup(); }
  });

  it('clears the timer when admission resolves and ignores late waits after timeout', async () => {
    const f = fixture();
    vi.useFakeTimers();
    try {
      await admitDispatch(f.ctx(vi.fn().mockResolvedValue({ action: 'proceed' })), f.request);
      expect(vi.getTimerCount()).toBe(0);
      let finish!: (decision: { action: 'wait'; reason: string; overrideable: boolean }) => void;
      const admit = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
      const pending = admitDispatch(f.ctx(admit), f.request);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toMatchObject({ decision: { action: 'reject', message: 'Plugin dispatch admission timed out' } });
      finish({ action: 'wait', reason: 'late', overrideable: true });
      await Promise.resolve();
      expect(getDispatchAdmissionGeneration(f.db, f.request.threadId)).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); f.cleanup(); }
  });

  it('fails open (no plugin host at all) without touching the db', async () => {
    const f = fixture();
    try {
      await expect(admitDispatch({ db: f.db, plugins: undefined } as never, f.request)).resolves.toEqual({
        decision: { action: 'proceed' },
        generation: 1
      });
    } finally { f.cleanup(); }
  });
});
