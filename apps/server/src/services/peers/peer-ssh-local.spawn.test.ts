import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizedKeys } from './peer-ssh-contract.js';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async importOriginal => ({ ...(await importOriginal<typeof import('node:child_process')>()), spawn: spawnMock }));

import { createLocalEndpoint } from './peer-ssh-local.js';

const HOST_KEY = `ssh-ed25519 ${'A'.repeat(68)}`;

afterEach(() => { vi.restoreAllMocks(); spawnMock.mockReset(); });

describe('default self-test ssh process', () => {
  it('spawns detached and SIGKILLs the whole process group on cleanup', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 4321, stderr: new EventEmitter() as never, kill: vi.fn() });
    (child.stderr as unknown as { setEncoding: () => void }).setEncoding = () => undefined;
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const authorizedKeys: AuthorizedKeys = { upsert: async () => undefined, remove: async () => undefined, reconcile: async () => undefined, list: async () => [] };
    // ssh "exits" immediately with an auth failure so the self-test stops and runs its cleanup.
    spawnMock.mockImplementation(() => { setTimeout(() => child.emit('close', 255), 0); return child; });
    const endpoint = createLocalEndpoint({
      env: {}, authorizedKeys, user: () => ({ username: 'alice', homedir: '/h' }), home: () => '/h', warn: () => undefined,
      probeBanner: async () => 'ok', localHostName: async () => 'box', readHostKey: async () => HOST_KEY
    });
    await expect(endpoint(new AbortController().signal)).rejects.toThrow();
    expect(spawnMock.mock.calls[0]![2]).toMatchObject({ detached: true, shell: false });
    expect(killSpy).toHaveBeenCalledWith(-4321, 'SIGKILL');
  });

  it('falls back to killing the child when the group is already gone', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 99, stderr: new EventEmitter() as never, kill: vi.fn() });
    (child.stderr as unknown as { setEncoding: () => void }).setEncoding = () => undefined;
    vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH'); });
    spawnMock.mockImplementation(() => { setTimeout(() => child.emit('close', 255), 0); return child; });
    const authorizedKeys: AuthorizedKeys = { upsert: async () => undefined, remove: async () => undefined, reconcile: async () => undefined, list: async () => [] };
    const endpoint = createLocalEndpoint({
      env: {}, authorizedKeys, user: () => ({ username: 'alice', homedir: '/h' }), home: () => '/h', warn: () => undefined,
      probeBanner: async () => 'ok', localHostName: async () => 'box', readHostKey: async () => HOST_KEY
    });
    await expect(endpoint(new AbortController().signal)).rejects.toThrow();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
