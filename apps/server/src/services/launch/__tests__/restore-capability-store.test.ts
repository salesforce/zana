import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createRestoreCapabilityStore } from '../restore-capability-store.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('restore capability store', () => {
  it('reserves without consuming, blocks concurrent replay, and consumes after success', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-restore-cap-'));
    dirs.push(dir);
    const filePath = join(dir, 'restore.json');
    const first = createRestoreCapabilityStore({ filePath });
    first.put({
      id: 'cap-1',
      request: { projectId: 'p1', profile: 'claude', cols: 80, rows: 24, cwd: '/trusted' },
      sessionId: 'session-1',
      sessionProfile: 'claude',
      sessionTitle: 'Trusted session',
      remoteTmuxId: 'tmux-1',
      createdAt: 1
    });

    const reopened = createRestoreCapabilityStore({ filePath });
    expect(reopened.get('cap-1')?.request.cwd).toBe('/trusted');
    expect(reopened.list()).toMatchObject([{ id: 'cap-1', sessionId: 'session-1' }]);
    const listed = reopened.list();
    listed[0].request.cwd = '/mutated';
    expect(reopened.get('cap-1')?.request.cwd).toBe('/trusted');
    reopened.markExited('session-1', 2);
    expect(reopened.findSession('session-1')).toMatchObject({ id: 'cap-1', sessionId: 'session-1' });
    expect(reopened.findExitedSession({
      projectId: 'p1',
      profile: 'claude',
      sessionId: 'session-1'
    })).toMatchObject({
      sessionTitle: 'Trusted session',
      remoteTmuxId: 'tmux-1',
      exitedAt: 2
    });
    expect(reopened.findExitedSession({
      projectId: 'other',
      profile: 'claude',
      sessionId: 'session-1'
    })).toBeUndefined();
    expect(reopened.findExitedSession({
      projectId: 'p1',
      profile: 'shell',
      sessionId: 'session-1'
    })).toBeUndefined();
    reopened.put({
      ...reopened.get('cap-1')!,
      request: { projectId: 'p1', profile: 'shell', cols: 80, rows: 24 }
    });
    expect(reopened.findExitedSession({
      projectId: 'p1',
      profile: 'claude',
      sessionId: 'session-1'
    })?.remoteTmuxId).toBe('tmux-1');
    const reserved = reopened.reserve('cap-1');
    expect(reserved?.capability.request.cwd).toBeUndefined();
    expect(reopened.reserve('cap-1')).toBeUndefined();
    expect(reopened.consume('cap-1', reserved!.reservationId)).toBe(true);
    expect(reopened.get('cap-1')).toBeUndefined();
  });

  it('does not resolve unknown, live, or targetless sessions as legacy reconnect targets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-restore-cap-'));
    dirs.push(dir);
    const store = createRestoreCapabilityStore({ filePath: join(dir, 'restore.json') });
    store.put({
      id: 'live-cap',
      request: { projectId: 'p1', profile: 'claude', cols: 80, rows: 24 },
      sessionId: 'live-session',
      sessionProfile: 'claude',
      sessionTitle: 'Live session',
      remoteTmuxId: 'live-tmux',
      createdAt: 1
    });
    store.put({
      id: 'local-cap',
      request: { projectId: 'p1', profile: 'claude', cols: 80, rows: 24 },
      sessionId: 'local-session',
      sessionProfile: 'claude',
      sessionTitle: 'Local session',
      createdAt: 1
    });
    store.markExited('local-session', 2);

    expect(store.findExitedSession({ projectId: 'p1', profile: 'claude', sessionId: 'missing' })).toBeUndefined();
    expect(store.findExitedSession({ projectId: 'p1', profile: 'claude', sessionId: 'live-session' })).toBeUndefined();
    expect(store.findExitedSession({ projectId: 'p1', profile: 'claude', sessionId: 'local-session' })).toBeUndefined();
  });

  it('releases a failed launch reservation for retry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-restore-cap-'));
    dirs.push(dir);
    const store = createRestoreCapabilityStore({ filePath: join(dir, 'restore.json') });
    store.put({
      id: 'cap-1',
      request: { projectId: 'p1', profile: 'claude', cols: 80, rows: 24 },
      createdAt: 1
    });

    const first = store.reserve('cap-1')!;
    store.put({
      id: 'cap-1',
      request: { projectId: 'p1', profile: 'shell', cols: 10, rows: 10 },
      createdAt: 2
    });
    expect(store.get('cap-1')?.request.profile).toBe('claude');
    expect(store.release('cap-1', 'wrong-reservation')).toBe(false);
    expect(store.reserve('cap-1')).toBeUndefined();
    expect(store.release('cap-1', first.reservationId)).toBe(true);
    expect(store.reserve('cap-1')).toBeDefined();
  });

  it('removes stale capabilities by session during bounded orphan cleanup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-restore-cap-'));
    dirs.push(dir);
    const store = createRestoreCapabilityStore({ filePath: join(dir, 'restore.json') });
    store.put({
      id: 'stale-cap',
      request: { projectId: 'p1', profile: 'claude', cols: 80, rows: 24 },
      sessionId: 'stale-session',
      createdAt: 1
    });

    expect(store.removeSession('stale-session')).toBe(true);
    expect(store.findSession('stale-session')).toBeUndefined();
    expect(store.removeSession('stale-session')).toBe(false);
  });
});
