import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useData } from '../store.js';
import type { Project, TerminalSession, Result } from '@zana-ai/zcc-domain/product';

/**
 * `reconnectRemote` recovers a REMOTE tab whose local `ssh` proxy died during
 * machine sleep: it asks main to spawn a fresh local pty re-attached to the
 * still-live `cc-<id>` tmux session on the box, then swaps the exited tombstone
 * for the returned live session AT THE SAME SLOT, preserving pin/title/selection.
 * These pin that swap + the guard rails (local/running/missing are no-ops).
 */

const remoteProject: Project = {
  id: 'remote-1',
  name: 'devbox',
  path: '/work/p1',
  remote: { host: 'devbox', remotePath: '/work/p1' }
} as Project;

const localProject: Project = {
  id: 'local-1',
  name: 'here',
  path: '/here'
} as Project;

function tombstone(id: string, over: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id,
    projectId: 'remote-1',
    title: `Agent ${id}`,
    profile: 'claude',
    cwd: '/work/p1',
    status: 'exited',
    exitCode: 255,
    createdAt: 1,
    remoteTmuxId: id,
    ...over
  } as TerminalSession;
}

const reconnectRemote =
  vi.fn((_input: unknown): Promise<Result<TerminalSession>> =>
    Promise.resolve({ ok: true, value: tombstone('fresh-id', { status: 'running', exitCode: undefined }) })
  );

beforeEach(() => {
  reconnectRemote.mockReset();
  reconnectRemote.mockResolvedValue({
    ok: true,
    value: tombstone('fresh-id', { status: 'running', exitCode: undefined })
  });
  (globalThis as { window?: unknown }).window = {
    cc: { terminals: { reconnectRemote } }
  };
  useData.setState({ projects: [remoteProject, localProject], terminals: {} });
});

describe('useData.reconnectRemote', () => {
  it('swaps the exited tombstone for the returned live session at the same slot', async () => {
    const a = tombstone('a', { status: 'running', exitCode: undefined });
    const dead = tombstone('dead');
    const c = tombstone('c', { status: 'running', exitCode: undefined });
    useData.setState({ terminals: { 'remote-1': [a, dead, c] } });

    const created = await useData.getState().reconnectRemote('dead', 'remote-1');

    expect(created?.id).toBe('fresh-id');
    const list = useData.getState().terminals['remote-1'];
    // Dead tombstone gone; fresh session in its original middle slot.
    expect(list.map((t) => t.id)).toEqual(['a', 'fresh-id', 'c']);
  });

  it('passes only the main-owned capability when one exists', async () => {
    // A prior reconnect minted a fresh pty id but kept the ORIGINAL tmux name;
    // a SECOND sleep must still target that original box session.
    const dead = tombstone('pty-2', {
      remoteTmuxId: 'original-tmux-id',
      restoreCapabilityId: 'restore-capability'
    });
    useData.setState({ terminals: { 'remote-1': [dead] } });

    await useData.getState().reconnectRemote('pty-2', 'remote-1');

    expect(reconnectRemote).toHaveBeenCalledTimes(1);
    expect(reconnectRemote.mock.calls[0][0]).toEqual({
      capabilityId: 'restore-capability',
      legacy: undefined
    });
  });

  it('passes only session identity for a legacy tombstone', async () => {
    const dead = tombstone('legacy', { remoteTmuxId: undefined });
    useData.setState({ terminals: { 'remote-1': [dead] } });

    await useData.getState().reconnectRemote('legacy', 'remote-1');

    expect(reconnectRemote.mock.calls[0][0]).toEqual({
      capabilityId: undefined,
      legacy: {
        projectId: 'remote-1',
        profile: 'claude',
        sessionId: 'legacy'
      }
    });
  });

  it('preserves pin across the swap', async () => {
    const dead = tombstone('dead', { pinned: true });
    reconnectRemote.mockResolvedValue({
      ok: true,
      value: tombstone('fresh-id', { status: 'running', exitCode: undefined, pinned: false })
    });
    useData.setState({ terminals: { 'remote-1': [dead] } });

    await useData.getState().reconnectRemote('dead', 'remote-1');

    const restored = useData.getState().terminals['remote-1'].find((t) => t.id === 'fresh-id');
    expect(restored?.pinned).toBe(true);
  });

  it('is a no-op for a LOCAL project (nothing to re-attach)', async () => {
    const dead = tombstone('dead', { projectId: 'local-1' });
    useData.setState({ terminals: { 'local-1': [dead] } });

    const created = await useData.getState().reconnectRemote('dead', 'local-1');

    expect(created).toBeNull();
    expect(reconnectRemote).not.toHaveBeenCalled();
  });

  it('is a no-op when the session id is not found', async () => {
    useData.setState({ terminals: { 'remote-1': [tombstone('a')] } });
    const created = await useData.getState().reconnectRemote('missing', 'remote-1');
    expect(created).toBeNull();
    expect(reconnectRemote).not.toHaveBeenCalled();
  });

  it('leaves the tombstone in place when main returns an error', async () => {
    reconnectRemote.mockResolvedValue({ ok: false, code: 'NOT_FOUND', message: 'gone' });
    useData.setState({ terminals: { 'remote-1': [tombstone('dead')] } });

    const created = await useData.getState().reconnectRemote('dead', 'remote-1');

    expect(created).toBeNull();
    // The tombstone must survive a failed reconnect so the user can retry.
    expect(useData.getState().terminals['remote-1'].map((t) => t.id)).toEqual(['dead']);
  });
});
