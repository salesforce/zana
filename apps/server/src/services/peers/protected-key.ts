import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, opendir, realpath, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { peerKeyReasonSuffix, serializePeerStorage, type PeerKeyProvider } from './peer-auth.js';
import { SERVER_RUNTIME_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/runtime';

/** Injected by trusted host composition, never by HTTP or plugin code. */
export interface PeerCryptoProvider {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

export const PEER_BOOT_KEY_ENV = 'ZCC_PEER_STORAGE_BOOT_KEY';
/** Boot-only, secret-free: why the desktop could not derive the key (a `PeerKeyReason`). Scrubbed on consumption. */
export const PEER_KEY_REASON_ENV = 'ZCC_PEER_STORAGE_KEY_REASON';
const MAX_KEY_FILE_BYTES = 4096;

/** Why the protected peer key cannot be used. Codes only: never key material, paths or OS error text. */
export const PEER_KEY_REASONS = ['encryption-unavailable', 'insecure-backend', 'keychain-denied', 'storage-permissions', 'key-missing', 'key-corrupt', 'unknown'] as const;
export type PeerKeyReason = typeof PEER_KEY_REASONS[number];
export const isPeerKeyReason = (value: unknown): value is PeerKeyReason => typeof value === 'string' && (PEER_KEY_REASONS as readonly string[]).includes(value);

export class PeerKeyReasonError extends Error {
  constructor(readonly reason: PeerKeyReason) { super(`protected peer storage key unavailable: ${reason}`); }
}
export { peerKeyReasonSuffix };
const fail = (reason: PeerKeyReason): never => { throw new PeerKeyReasonError(reason); };
const crypto = <T>(run: () => T): T => { try { return run(); } catch { return fail('keychain-denied'); } };
const classify = (error: unknown): PeerKeyReason => {
  if (error instanceof PeerKeyReasonError) return error.reason;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EACCES' || code === 'EPERM' || code === 'ENOENT' || code === 'ENOTDIR' ? 'storage-permissions' : 'unknown';
};

export function createProtectedPeerKeyProvider(dataDir: string, cryptoProvider?: PeerCryptoProvider): PeerKeyProvider {
  return {
    getKey: async () => {
      let base: string;
      try { base = await realpath(dataDir); }
      catch { throw new PeerKeyReasonError('storage-permissions'); }
      return serializePeerStorage(join(base, 'peer-key'), async () => {
        try {
        if (!cryptoProvider || !crypto(() => cryptoProvider.isEncryptionAvailable())) return fail('encryption-unavailable');
        const backend = cryptoProvider.getSelectedStorageBackend?.();
        if (backend === 'basic_text' || backend === 'unknown' || (process.platform === 'linux' &&
          !['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(backend ?? ''))) return fail('insecure-backend');
        const baseInfo = await lstat(base);
        if (!baseInfo.isDirectory() || baseInfo.uid !== process.getuid?.() || (baseInfo.mode & 0o022) !== 0) fail('storage-permissions');
        const directory = join(base, 'peer-key');
        await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        const info = await lstat(directory);
        if (!info.isDirectory() || info.uid !== baseInfo.uid || (info.mode & 0o7777) !== 0o700) fail('storage-permissions');
        const entries = await opendir(directory), stale: string[] = [];
        let count = 0;
        for await (const entry of entries) {
          if (++count > 32) fail('storage-permissions');
          if (entry.name === 'key.bin') continue;
          if (!entry.isFile() || !/^key-[0-9a-f-]{36}\.tmp$/.test(entry.name)) fail('storage-permissions');
          stale.push(join(directory, entry.name));
        }
        for (const path of stale) await unlink(path);
        const path = join(directory, 'key.bin');
        const read = async (): Promise<Buffer | null> => {
          let handle;
          try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
          try {
            const metadata = await handle.stat();
            if (!metadata.isFile() || metadata.nlink !== 1 || metadata.uid !== baseInfo.uid ||
              (metadata.mode & 0o7777) !== 0o600 || metadata.size < 1 || metadata.size > MAX_KEY_FILE_BYTES) fail('storage-permissions');
            const bytes = Buffer.alloc(MAX_KEY_FILE_BYTES + 1);
            let length = 0;
            while (length < bytes.length) {
              const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
              if (!bytesRead) break;
              length += bytesRead;
            }
            if (length !== metadata.size) fail('key-corrupt');
            return bytes.subarray(0, length);
          } finally { await handle.close(); }
        };
        let sealed = await read();
        if (!sealed) {
          // Losing an established key must not silently reset encrypted pair authority.
          const pairs = await lstat(join(base, 'peer-pairs')).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
          if (pairs) fail('key-missing');
          const key = randomBytes(32);
          try { sealed = crypto(() => cryptoProvider.encryptString(key.toString('base64url'))); }
          finally { key.fill(0); }
          if (!sealed.length || sealed.length > MAX_KEY_FILE_BYTES) fail('keychain-denied');
          const temporary = join(directory, `key-${randomUUID()}.tmp`);
          try {
            const handle = await open(temporary, 'wx', 0o600);
            try { await handle.writeFile(sealed); await handle.sync(); } finally { await handle.close(); }
            // Publish without replacing another host process's complete key.
            await link(temporary, path).catch(error => { if (error.code !== 'EEXIST') throw error; });
          } finally { await unlink(temporary).catch(() => {}); }
          const handle = await open(directory, constants.O_RDONLY);
          try { await handle.sync(); } finally { await handle.close(); }
          sealed = await read();
        }
        if (!sealed) return fail('key-missing');
        const text = crypto(() => cryptoProvider.decryptString(sealed));
        if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return fail('key-corrupt');
        const key = Buffer.from(text, 'base64url');
        if (key.length !== 32 || key.toString('base64url') !== text) { key.fill(0); return fail('key-corrupt'); }
        return key;
        } catch (error) { throw new PeerKeyReasonError(classify(error)); }
      });
    }
  };
}

interface PeerBootPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  removeListener(event: 'message', listener: (event: { data: unknown }) => void): void;
}
const consumedBootPorts = new WeakSet<PeerBootPort>();

/** Keep in lockstep with `DEV_PEER_KEY_FILE_ENV` in scripts/dev-local.mjs. A path, never the key itself. */
export const DEV_PEER_KEY_FILE_ENV = 'ZCC_DEV_PEER_KEY_FILE';

/** Trusts the dev key only from a regular, single-link file this user owns that no one else can read or write. */
export async function readDevPeerKeyFile(path: string): Promise<Buffer | null> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch { return null; }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 128) return null;
    const text = (await handle.readFile('utf8')).trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return null;
    const key = Buffer.from(text, 'base64url');
    if (key.length === 32 && key.toString('base64url') === text) return key;
    key.fill(0);
    return null;
  } finally { await handle.close(); }
}

/** Register before runtime dispatch so secret bytes never reach plugin composition or logs. */
export function consumePeerBootKey(env: NodeJS.ProcessEnv = process.env): PeerKeyProvider & { dispose(): void } {
  // Legacy environment secrets are never authority, even if inherited from an older launcher.
  delete env[PEER_BOOT_KEY_ENV];
  const supplied = env[PEER_KEY_REASON_ENV];
  delete env[PEER_KEY_REASON_ENV];
  const reason: PeerKeyReason | null = isPeerKeyReason(supplied) ? supplied : null;
  let key: Buffer | null = null;
  let disposed = false;
  const port = (process as unknown as { parentPort?: PeerBootPort }).parentPort;
  const receive = ({ data }: { data: unknown }) => {
    if (!data || typeof data !== 'object') return;
    const message = data as { type?: unknown; protocolVersion?: unknown; peerBootKey?: unknown };
    if (message.type !== 'start') return;
    port!.removeListener('message', receive);
    const bytes = message.peerBootKey;
    delete message.peerBootKey;
    if (bytes instanceof Uint8Array) {
      try {
        if (message.protocolVersion === SERVER_RUNTIME_PROTOCOL_VERSION && bytes.length === 32) key = Buffer.from(bytes);
      } finally { bytes.fill(0); }
    }
  };
  if (port && !consumedBootPorts.has(port)) {
    consumedBootPorts.add(port);
    port.on('message', receive);
  }
  // `pnpm dev` runs the server as a plain Node child with no parent port: it names a 0600 dev-only key file instead.
  const devKeyFile = port ? undefined : env[DEV_PEER_KEY_FILE_ENV];
  delete env[DEV_PEER_KEY_FILE_ENV];
  let devKeyRead = false;
  return {
    getKey: async () => {
      if (disposed) return null;
      if (!key && devKeyFile && !devKeyRead) { devKeyRead = true; key = await readDevPeerKeyFile(devKeyFile); }
      if (key) return Buffer.from(key);
      // Absent key with a known cause: fail typed so the cause reaches plugins instead of a silent null.
      if (reason) throw new PeerKeyReasonError(reason);
      return null;
    },
    dispose: () => { disposed = true; port?.removeListener('message', receive); key?.fill(0); key = null; }
  };
}
