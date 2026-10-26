import { randomBytes } from 'node:crypto';
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivatePeerStorage } from './peer-auth.js';
import { createProtectedPeerKeyProvider, readDevPeerKeyFile, type PeerCryptoProvider } from './protected-key.js';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
const root = async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'zcc-peer-windows-')));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
};
/** Windows: no process.getuid, uid 0, and synthetic modes (directories 0o777/0o666, writable files 0o666). */
function simulateWindows(): void {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  const getuid = Object.getOwnPropertyDescriptor(process, 'getuid');
  Object.defineProperty(process, 'getuid', { value: undefined, configurable: true });
  cleanup.push(() => { if (getuid) Object.defineProperty(process, 'getuid', getuid); else delete (process as { getuid?: unknown }).getuid; });
}
// Stands in for DPAPI; Windows never reports a storage backend.
const cryptoProvider: PeerCryptoProvider = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`sealed:${value}`),
  decryptString: value => value.toString().replace(/^sealed:/, '')
};
const store = (dir: string) => new PrivatePeerStorage(dir, 'links-v2', { getKey: async () => Buffer.alloc(32, 1) }, 'app',
  () => ({ n: 0 }), value => value as { n: number });

describe('peer storage under Windows-reported permissions', () => {
  it('creates and reuses the protected peer key despite permissive modes, but still rejects hard links and oversize keys', async () => {
    simulateWindows();
    const dir = await root();
    await chmod(dir, 0o777);
    const key = Buffer.from((await createProtectedPeerKeyProvider(dir, cryptoProvider).getKey())!);
    expect(key).toHaveLength(32);
    const path = join(dir, 'peer-key', 'key.bin');
    await chmod(join(dir, 'peer-key'), 0o777);
    await chmod(path, 0o666);
    expect(Buffer.from((await createProtectedPeerKeyProvider(dir, cryptoProvider).getKey())!)).toEqual(key);
    await link(path, join(dir, 'key-copy'));
    await expect(createProtectedPeerKeyProvider(dir, cryptoProvider).getKey()).rejects.toThrow('storage-permissions');
    await rm(join(dir, 'key-copy'));
    const sealed = await readFile(path);
    await writeFile(path, Buffer.alloc(4097));
    await expect(createProtectedPeerKeyProvider(dir, cryptoProvider).getKey()).rejects.toThrow('storage-permissions');
    await writeFile(path, sealed);
    await rm(join(dir, 'peer-key'), { recursive: true });
    await writeFile(join(dir, 'peer-key'), '');
    await expect(createProtectedPeerKeyProvider(dir, cryptoProvider).getKey()).rejects.toThrow('storage-permissions');
  });

  it('reads a permissive dev key file but never a hard-linked one', async () => {
    simulateWindows();
    const dir = await root(), path = join(dir, 'dev-peer-key'), text = randomBytes(32).toString('base64url');
    await writeFile(path, text, { mode: 0o666 });
    await chmod(path, 0o666);
    await expect(readDevPeerKeyFile(path)).resolves.toEqual(Buffer.from(text, 'base64url'));
    await link(path, join(dir, 'other'));
    await expect(readDevPeerKeyFile(path)).resolves.toBeNull();
  });

  it('commits and reopens encrypted peer state, keeping the symlink and hard-link checks', async () => {
    simulateWindows();
    const dir = join(await root(), 'store');
    await store(dir).transaction(async (state, save) => { state.n = 1; await save(); });
    await chmod(dir, 0o777);
    await chmod(join(dir, 'links-v2.bin'), 0o666);
    await chmod(join(dir, 'links-v2.initialized'), 0o666);
    expect(await store(dir).transaction(async state => state.n)).toBe(1);
    await link(join(dir, 'links-v2.bin'), join(dir, '..', 'copy.bin'));
    await expect(store(dir).transaction(async state => state.n)).rejects.toThrow('unsafe peer storage file');
    await rm(join(dir, '..', 'copy.bin'));
    const elsewhere = join(dir, '..', 'elsewhere');
    await mkdir(elsewhere);
    await symlink(elsewhere, join(dir, '..', 'linked'), 'junction');
    await expect(store(join(dir, '..', 'linked')).transaction(async state => state.n)).rejects.toThrow('unsafe peer storage directory');
  });
});

describe.skipIf(process.platform === 'win32')('peer storage on POSIX', () => {
  it('still rejects group/other-accessible storage directories and files', async () => {
    const dir = join(await root(), 'store');
    await store(dir).transaction(async (state, save) => { state.n = 1; await save(); });
    await chmod(join(dir, 'links-v2.bin'), 0o644);
    await expect(store(dir).transaction(async state => state.n)).rejects.toThrow('unsafe peer storage file');
    await chmod(join(dir, 'links-v2.bin'), 0o600);
    await chmod(dir, 0o755);
    await expect(store(dir).transaction(async state => state.n)).rejects.toThrow('unsafe peer storage directory');
    await chmod(dir, 0o700);
    expect(await store(dir).transaction(async state => state.n)).toBe(1);
  });
});
