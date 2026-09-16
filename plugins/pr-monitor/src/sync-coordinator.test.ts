import { describe, expect, it, vi } from 'vitest';
import { SyncCoordinator } from '../lib/sync-coordinator.js';

describe('SyncCoordinator', () => {
  it('returns running state immediately and joins overlapping callers', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => {
      await gate;
      return { ok: true, prs: [], deltas: [] };
    });
    const coordinator = new SyncCoordinator();

    const first = coordinator.start('all', undefined, run);
    const joined = coordinator.start('repos', ['acme/web'], run);

    expect(first).toMatchObject({ id: 1, state: 'running', scope: 'all' });
    expect(joined).toEqual(first);
    expect(run).toHaveBeenCalledTimes(1);

    release();
    await expect(coordinator.wait()).resolves.toMatchObject({ id: 1, state: 'succeeded', prs: [] });
  });

  it('records unexpected failures and allows a later retry', async () => {
    const coordinator = new SyncCoordinator();

    coordinator.start('all', undefined, async () => {
      throw new Error('slow gh failed');
    });
    await expect(coordinator.wait()).resolves.toMatchObject({ state: 'failed', error: 'slow gh failed' });

    const next = coordinator.start('repos', ['acme/web'], async () => ({ ok: true, prs: [] }));
    expect(next).toMatchObject({ id: 2, state: 'running', scope: 'repos', repos: ['acme/web'] });
    await expect(coordinator.wait()).resolves.toMatchObject({ id: 2, state: 'succeeded' });
  });
});
