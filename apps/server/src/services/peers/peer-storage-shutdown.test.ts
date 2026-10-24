import { mkdtemp, realpath, rm, access, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { PrivatePeerStorage } from './peer-auth.js';

it('fences queued/new storage work and drains admitted atomic writes before root deletion', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'peer-storage-close-')));
  const storage = new PrivatePeerStorage(join(root, 'store'), 'test', { getKey: async () => Buffer.alloc(32, 1) },
    'app', () => ({}), value => value as object);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const entered = vi.fn();
  try {
    const first = storage.transaction(async (_state, save) => { entered(); await held; await save(); });
    await vi.waitFor(() => expect(entered).toHaveBeenCalled());
    const queued = storage.transaction(async () => { throw new Error('must not run'); }).catch(error => error as Error);
    storage.dispose();
    await expect(storage.transaction(async () => {})).rejects.toThrow('disposed');
    let idle = false;
    const closing = storage.whenIdle().then(() => { idle = true; });
    await Promise.resolve(); expect(idle).toBe(false);
    release(); await first;
    expect((await queued).message).toMatch(/disposed/);
    await closing;
    await rm(root, { recursive: true });
    await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' });
    await storage.whenIdle();
  } finally { release?.(); await storage.whenIdle(); await rm(root, { recursive: true, force: true }); }
});

it('ignores retired-version files beside a renamed store, but still rejects unknown entries', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'peer-storage-retired-')));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const dir = join(root, 'store');
    await mkdir(dir, { mode: 0o700 });
    for (const name of ['links-v1.bin', 'links-v1.initialized', 'links-v1.bin.abc123.tmp']) await writeFile(join(dir, name), 'old', { mode: 0o600 });
    const open = () => new PrivatePeerStorage(dir, 'links-v2', { getKey: async () => Buffer.alloc(32, 1) }, 'app', () => ({ n: 0 }), value => value as { n: number });
    const storage = open();
    await storage.transaction(async (state, save) => { state.n = 1; await save(); });
    expect(await storage.transaction(async state => state.n)).toBe(1);
    expect(await readdir(dir)).toEqual(expect.arrayContaining(['links-v1.bin', 'links-v1.initialized', 'links-v2.bin']));
    expect(warn.mock.calls.filter(call => String(call[0]).includes('links-v1.bin '))).toHaveLength(1);
    // Same-version leftovers and unrelated files remain a migration error.
    await writeFile(join(dir, 'other.bin'), 'x', { mode: 0o600 });
    await expect(open().transaction(async () => 0)).rejects.toThrow('explicit host migration');
    await rm(join(dir, 'other.bin'));
    await writeFile(join(dir, 'links-v2.bin.abc.tmp.bak'), 'x', { mode: 0o600 });
    await expect(open().transaction(async () => 0)).rejects.toThrow('explicit host migration');
    storage.dispose();
  } finally { warn.mockRestore(); await rm(root, { recursive: true, force: true }); }
});
