import { describe, expect, it, vi } from 'vitest';
import { SyncCoordinator } from '../lib/sync-coordinator.js';

describe('SyncCoordinator', () => {
  it('joins covered work but queues an uncovered scoped sync', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.fn(async () => { await gate; return { ok: true, prs: [], deltas: [] }; });
    const complete = vi.fn(async () => {});
    const coordinator = new SyncCoordinator(run, complete, vi.fn());

    const first = coordinator.start('repos', ['acme/web']);
    const joined = coordinator.start('repos', ['acme/web']);
    const queued = coordinator.start('repos', ['acme/api']);

    expect(joined).toMatchObject({ id: first.id, state: 'running' });
    expect(queued).toMatchObject({ id: 2, state: 'queued', repos: ['acme/api'] });
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls[1]).toEqual(['repos', ['acme/api']]);
  });

  it('merges queued work into a full sync and logs failures', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.fn(async () => { await gate; return { ok: true, prs: [] }; });
    const log = vi.fn();
    const coordinator = new SyncCoordinator(run, async () => {}, log);
    coordinator.start('repos', ['acme/web']);
    coordinator.start('repos', ['acme/api']);
    const full = coordinator.start('all');

    expect(full).toMatchObject({ state: 'queued', scope: 'all' });
    release();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls[1]).toEqual(['all', undefined]);

    const failed = new SyncCoordinator(async () => { throw new Error('slow gh failed'); }, async () => {}, log);
    const job = failed.start('all');
    await vi.waitFor(() => expect(failed.status(job.id)).toMatchObject({ state: 'failed' }));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('slow gh failed'));
  });
});
