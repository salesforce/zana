import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalHostIdResolver, createPersistedHostIdDeps, statHostIdFileToken } from './local-host-id.js';

it('wires persisted reads and revision stats to the current data directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hostid-wiring-'));
  try {
    let dataDir = dir;
    const deps = createPersistedHostIdDeps(() => dataDir);
    expect(deps.statHostIdFile()).toBeNull();
    expect(deps.readPersistedHostId()).toBeNull();
    const id = '11111111-1111-4111-8111-111111111111';
    writeFileSync(join(dir, 'host.id'), id);
    expect(deps.readPersistedHostId()).toBe(id);
    expect(deps.statHostIdFile()).toBe(statHostIdFileToken(dir));
    dataDir = join(dir, 'missing');
    expect(deps.statHostIdFile()).toBeNull();
    expect(deps.readPersistedHostId()).toBeNull();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

describe('createLocalHostIdResolver', () => {
  it('prefers the enrolled supervisor identity', () => {
    const readPersistedHostId = vi.fn(() => 'persisted');
    const resolve = createLocalHostIdResolver({ supervisorHostId: () => 'enrolled', devAttach: () => true, readPersistedHostId });
    expect(resolve()).toBe('enrolled');
    expect(readPersistedHostId).not.toHaveBeenCalled();
  });

  it('stays undefined outside dev attach until the supervisor enrolls', () => {
    let enrolled: string | undefined;
    const readPersistedHostId = vi.fn(() => 'persisted');
    const resolve = createLocalHostIdResolver({ supervisorHostId: () => enrolled, devAttach: () => false, readPersistedHostId });
    expect(resolve()).toBeUndefined();
    enrolled = 'late';
    expect(resolve()).toBe('late');
    expect(readPersistedHostId).not.toHaveBeenCalled();
  });

  it('reads and caches the attached daemon identity in dev attach', () => {
    const readPersistedHostId = vi.fn(() => 'daemon-host');
    const resolve = createLocalHostIdResolver({ supervisorHostId: () => undefined, devAttach: () => true, readPersistedHostId });
    expect(resolve()).toBe('daemon-host');
    expect(resolve()).toBe('daemon-host');
    expect(readPersistedHostId).toHaveBeenCalledTimes(1);
  });

  it('retries the read while the attached daemon has not persisted an identity', () => {
    const readPersistedHostId = vi.fn<() => string | null>().mockReturnValueOnce(null).mockReturnValue('daemon-host');
    const resolve = createLocalHostIdResolver({ supervisorHostId: () => undefined, devAttach: () => true, readPersistedHostId });
    expect(resolve()).toBeUndefined();
    expect(resolve()).toBe('daemon-host');
  });
});

describe('createLocalHostIdResolver dev-attach invalidation', () => {
  function setup(opts: { id?: string | null; token?: string | null } = {}) {
    const state = { id: opts.id ?? 'a' as string | null, token: opts.token === undefined ? 't1' : opts.token as string | null, sup: undefined as string | undefined };
    const read = vi.fn(() => state.id);
    const stat = vi.fn(() => state.token);
    const resolve = createLocalHostIdResolver({
      supervisorHostId: () => state.sup, devAttach: () => true, readPersistedHostId: read, statHostIdFile: stat
    });
    return { state, read, stat, resolve };
  }

  it('does not re-read while the token is unchanged', () => {
    const { resolve, read, stat } = setup();
    expect(resolve()).toBe('a');
    expect(resolve()).toBe('a');
    expect(read).toHaveBeenCalledTimes(1);
    expect(stat).toHaveBeenCalledTimes(2);
  });

  it('re-reads when the file is mutated or replaced', () => {
    const { resolve, state, read } = setup();
    expect(resolve()).toBe('a');
    state.id = 'b'; state.token = 't2';
    expect(resolve()).toBe('b');
    expect(resolve()).toBe('b');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('drops the id when the file goes missing and recovers on reappearance', () => {
    const { resolve, state, read } = setup();
    expect(resolve()).toBe('a');
    state.token = null;
    expect(resolve()).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
    state.id = 'c'; state.token = 't3';
    expect(resolve()).toBe('c');
  });

  it('re-reads after reappearance even with an identical token', () => {
    const { resolve, state } = setup();
    expect(resolve()).toBe('a');
    state.token = null;
    resolve();
    state.token = 't1'; state.id = 'z';
    expect(resolve()).toBe('z');
  });

  it('does not cache a failed or empty read and does not throw', () => {
    const { resolve, state, read } = setup();
    read.mockImplementationOnce(() => { throw new Error('EIO'); });
    expect(resolve()).toBeUndefined();
    state.id = null;
    expect(resolve()).toBeUndefined();
    state.id = 'd';
    expect(resolve()).toBe('d');
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('treats a throwing stat as missing', () => {
    const read = vi.fn(() => 'a');
    const resolve = createLocalHostIdResolver({
      supervisorHostId: () => undefined, devAttach: () => true, readPersistedHostId: read,
      statHostIdFile: () => { throw new Error('boom'); }
    });
    expect(resolve()).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('supervisor takeover wins immediately and skips stat/read', () => {
    const { resolve, state, read, stat } = setup();
    expect(resolve()).toBe('a');
    state.sup = 'enrolled';
    expect(resolve()).toBe('enrolled');
    expect(read).toHaveBeenCalledTimes(1);
    expect(stat).toHaveBeenCalledTimes(1);
  });
});

describe('statHostIdFileToken', () => {
  it('returns null when missing and a changing token on replacement', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hostid-'));
    try {
      expect(statHostIdFileToken(dir)).toBeNull();
      writeFileSync(join(dir, 'host.id'), 'one');
      const t1 = statHostIdFileToken(dir);
      expect(t1).toMatch(/^[\d.]+:3:\d+$/);
      writeFileSync(join(dir, 'host.id'), 'longer-id');
      expect(statHostIdFileToken(dir)).not.toBe(t1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
