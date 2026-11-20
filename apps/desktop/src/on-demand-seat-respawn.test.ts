import { describe, expect, it, vi } from 'vitest';
import { createWorkerRespawner, type WorkerRespawnDeps } from './on-demand-seat.js';

type Seat = { slotId: string; process: 'exited' | 'running' | 'spawn-failed'; sessionId?: string };
type Rec = { workers: Seat[] };

function make(over: Partial<WorkerRespawnDeps<Rec>> = {}, seat: Seat | undefined = { slotId: 's', process: 'exited', sessionId: 'old' }) {
  const rec: Rec = { workers: seat ? [seat] : [] };
  const deps = {
    lifecycle: {
      get: vi.fn(async () => rec),
      launchIsClosing: vi.fn(async () => false),
      reopenExitedWorker: vi.fn(async () => ({ ok: true as const, record: rec }))
    },
    hasSpawner: vi.fn(() => true),
    closeSession: vi.fn(async () => true),
    sessionGone: vi.fn(async () => true),
    spawn: vi.fn(async () => ({ ok: true as const, sessionId: 'new' })),
    track: vi.fn(),
    log: vi.fn(),
    ...over
  } as unknown as WorkerRespawnDeps<Rec>;
  return { deps, respawner: createWorkerRespawner(deps) };
}

describe('createWorkerRespawner', () => {
  it('respawns an exited seat: closes the old session, reopens, tracks and spawns', async () => {
    const { deps, respawner } = make();
    expect(await respawner.respawn('r', 's')).toEqual({ ok: true, sessionId: 'new' });
    expect(deps.closeSession).toHaveBeenCalledWith('old');
    expect(deps.track).toHaveBeenCalled();
    expect(respawner.isRespawn('r', 's')).toBe(false);
  });

  it('flags the seat as a respawn only while it is starting', async () => {
    let during = false;
    const holder: { r?: ReturnType<typeof createWorkerRespawner> } = {};
    const { respawner } = make({ spawn: async () => { during = holder.r!.isRespawn('r', 's'); return { ok: true, sessionId: 'n' } as never; } });
    holder.r = respawner;
    await respawner.respawn('r', 's');
    expect(during).toBe(true);
  });

  it('skips closing when there was no session (spawn-failed seat)', async () => {
    const { deps, respawner } = make({}, { slotId: 's', process: 'spawn-failed' });
    expect((await respawner.respawn('r', 's')).ok).toBe(true);
    expect(deps.closeSession).not.toHaveBeenCalled();
  });

  it.each([
    ['no-spawner', { hasSpawner: () => false }, undefined],
    ['closing', { lifecycle: { get: async () => ({ workers: [] }), launchIsClosing: async () => true, reopenExitedWorker: async () => ({ ok: false, reason: 'x' }) } }, undefined],
    ['not-found', {}, { slotId: 'other', process: 'exited' as const }],
    ['unsupported', { unsupported: () => 'remote' }, undefined],
    ['not-over', {}, { slotId: 's', process: 'running' as const }],
    ['old-session-running', { sessionGone: async () => false }, undefined],
    ['old-session-running', { closeSession: async () => { throw new Error('x'); } }, undefined]
  ])('refuses with %s', async (reason, over, seat) => {
    const { deps, respawner } = make(over as never, seat);
    const result = await respawner.respawn('r', 's');
    expect(result).toMatchObject({ ok: false, reason });
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it('passes a lifecycle refusal through', async () => {
    const { respawner } = make({ lifecycle: { get: async () => ({ workers: [{ slotId: 's', process: 'exited' }] }), launchIsClosing: async () => false, reopenExitedWorker: async () => ({ ok: false, reason: 'closing' }) } } as never);
    expect(await respawner.respawn('r', 's')).toMatchObject({ ok: false, reason: 'closing' });
    const other = make({ lifecycle: { get: async () => ({ workers: [{ slotId: 's', process: 'exited' }] }), launchIsClosing: async () => false, reopenExitedWorker: async () => ({ ok: false, reason: 'never-launched' }) } } as never);
    expect(await other.respawner.respawn('r', 's')).toMatchObject({ ok: false, reason: 'never-launched' });
  });

  it('reports a failed or throwing spawn and releases the in-flight key', async () => {
    const failing = make({ spawn: async () => ({ ok: false, message: 'no' }) as never });
    expect(await failing.respawner.respawn('r', 's')).toMatchObject({ ok: false, reason: 'spawn-failed', message: 'no' });
    const throwing = make({ spawn: async () => { throw new Error('boom'); } });
    expect(await throwing.respawner.respawn('r', 's')).toMatchObject({ ok: false, reason: 'spawn-failed', message: 'boom' });
    expect(throwing.respawner.isRespawn('r', 's')).toBe(false);
  });

  it('refuses a concurrent second respawn of the same seat', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { deps, respawner } = make({ spawn: async () => { await gate; return { ok: true, sessionId: 'n' } as never; } });
    const first = respawner.respawn('r', 's');
    expect(await respawner.respawn('r', 's')).toMatchObject({ ok: false, reason: 'busy' });
    release();
    expect((await first).ok).toBe(true);
    expect(deps.lifecycle.reopenExitedWorker).toHaveBeenCalledTimes(1);
  });

  it('marks refusals before the seat was reopened as uncommitted, and later failures as committed', async () => {
    expect(await make({ hasSpawner: () => false }).respawner.respawn('r', 's')).not.toHaveProperty('committed');
    const err = await make({ lifecycle: { get: async () => { throw new Error('read'); } } } as never).respawner.respawn('r', 's');
    expect(err).toMatchObject({ ok: false, reason: 'error' });
    expect(err).not.toHaveProperty('committed');
    expect(await make({ spawn: async () => ({ ok: false, message: 'no' }) as never }).respawner.respawn('r', 's')).toMatchObject({ committed: true });
    expect(await make({ spawn: async () => { throw new Error('x'); } }).respawner.respawn('r', 's')).toMatchObject({ reason: 'spawn-failed', committed: true });
  });

  it('reports a retryable refusal as queued', async () => {
    const { respawner } = make({ spawn: async () => ({ ok: false, message: 'machine is at its session limit', retryable: true }) as never });
    expect(await respawner.respawn('r', 's')).toMatchObject({ ok: false, reason: 'queued', committed: true, message: expect.stringContaining('queued') });
  });

  it('closes a session that came up after the run began closing', async () => {
    const closing = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { deps, respawner } = make({ lifecycle: { get: async () => ({ workers: [{ slotId: 's', process: 'spawn-failed' }] }), launchIsClosing: closing, reopenExitedWorker: async () => ({ ok: true, record: { workers: [] } }) } } as never);
    expect(await respawner.respawn('r', 's')).toMatchObject({ ok: false, reason: 'closing', committed: true });
    expect(deps.closeSession).toHaveBeenCalledWith('new');
  });

  it('still reports closing when the late close itself fails', async () => {
    const closing = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { deps, respawner } = make({ closeSession: async () => { throw new Error('gone'); }, lifecycle: { get: async () => ({ workers: [{ slotId: 's', process: 'spawn-failed' }] }), launchIsClosing: closing, reopenExitedWorker: async () => ({ ok: true, record: { workers: [] } }) } } as never);
    expect(await respawner.respawn('r', 's')).toMatchObject({ reason: 'closing' });
    expect(deps.log).toHaveBeenCalled();
  });
});
