import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { SERVER_RUNTIME_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/runtime';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { consumePeerBootKey, PeerKeyReasonError, peerKeyReasonSuffix, createProtectedPeerKeyProvider, DEV_PEER_KEY_FILE_ENV, PEER_BOOT_KEY_ENV, PEER_KEY_REASON_ENV, readDevPeerKeyFile, type PeerCryptoProvider } from './protected-key.js';

const roots: string[] = [];
const root = () => { const dir = mkdtempSync(join(tmpdir(), 'zcc-peer-key-')); roots.push(dir); return dir; };
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });
// Simulates OS wrapping with authenticated encryption; tests never touch Keychain.
const wrappingKey = randomBytes(32);
const cryptoProvider: PeerCryptoProvider = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: value => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
    return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]);
  },
  decryptString: value => {
    const cipher = createDecipheriv('aes-256-gcm', wrappingKey, value.subarray(0, 12));
    cipher.setAuthTag(value.subarray(-16));
    return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString();
  }
};

it('persists only protected bytes, reuses one 32-byte key across concurrent providers and restart', async () => {
  const dir = root();
  const keys = await Promise.all(Array.from({ length: 6 }, () => createProtectedPeerKeyProvider(dir, cryptoProvider).getKey()));
  const key = Buffer.from(keys[0]!);
  expect(key.length).toBe(32);
  for (const other of keys) expect(Buffer.from(other!)).toEqual(key);
  const path = join(dir, 'peer-key', 'key.bin');
  const sealed = readFileSync(path);
  expect(sealed.includes(key)).toBe(false);
  expect(sealed.includes(Buffer.from(key.toString('base64url')))).toBe(false);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(statSync(join(dir, 'peer-key')).mode & 0o777).toBe(0o700);
  expect(readdirSync(join(dir, 'peer-key'))).toEqual(['key.bin']);
  key.fill(0);
  expect(Buffer.from((await createProtectedPeerKeyProvider(dir, cryptoProvider).getKey())!)).toEqual(keys[0]);
  expect(Buffer.from((await createProtectedPeerKeyProvider(root(), cryptoProvider).getKey())!)).not.toEqual(keys[0]);
});

it.each(['absent', 'unavailable', 'basic_text', 'unknown'])('fails closed without disk writes when protection is %s', async mode => {
  const dir = root(), encrypt = vi.fn(cryptoProvider.encryptString);
  const provider = mode === 'absent' ? undefined : { ...cryptoProvider, encryptString: encrypt,
    isEncryptionAvailable: () => mode !== 'unavailable', getSelectedStorageBackend: () => mode };
  await expect(createProtectedPeerKeyProvider(dir, provider).getKey()).rejects.toMatchObject({ reason: mode === 'absent' || mode === 'unavailable' ? 'encryption-unavailable' : 'insecure-backend' });
  expect(encrypt).not.toHaveBeenCalled();
  expect(readdirSync(dir)).toEqual([]);
});

it.each(['corrupt', 'oversized', 'public', 'symlink', 'directory'])('rejects %s key without replacing it', async mode => {
  const dir = root(), directory = join(dir, 'peer-key');
  mkdirSync(directory, { mode: 0o700 });
  const path = join(directory, 'key.bin');
  if (mode === 'directory') mkdirSync(path);
  else if (mode === 'symlink') symlinkSync(join(dir, 'missing'), path);
  else { writeFileSync(path, mode === 'oversized' ? Buffer.alloc(4097) : 'bad', { mode: 0o600 }); if (mode === 'public') chmodSync(path, 0o644); }
  await expect(createProtectedPeerKeyProvider(dir, cryptoProvider).getKey()).rejects.toThrow('protected peer storage key unavailable');
  expect(readdirSync(directory)).toEqual(['key.bin']);
});

it('rejects unsafe base and key directory and missing established key', async () => {
  const dir = root(); chmodSync(dir, 0o777);
  await expect(createProtectedPeerKeyProvider(dir, cryptoProvider).getKey()).rejects.toThrow('protected peer storage key unavailable');
  chmodSync(dir, 0o700); mkdirSync(join(dir, 'peer-key'), { mode: 0o755 });
  await expect(createProtectedPeerKeyProvider(dir, cryptoProvider).getKey()).rejects.toThrow('protected peer storage key unavailable');
  chmodSync(join(dir, 'peer-key'), 0o700); mkdirSync(join(dir, 'peer-pairs'), { mode: 0o700 });
  await expect(createProtectedPeerKeyProvider(dir, cryptoProvider).getKey()).rejects.toThrow('protected peer storage key unavailable');
  expect(existsSync(join(dir, 'peer-key', 'key.bin'))).toBe(false);
});

it.each(['throw', 'empty', 'huge', 'invalid-key', 'noncanonical-key'])('redacts %s wrapping failures without plaintext fallback', async mode => {
  const provider = { ...cryptoProvider,
    encryptString: (value: string) => {
      if (mode === 'throw') throw new Error(value);
      if (mode === 'empty') return Buffer.alloc(0);
      if (mode === 'huge') return Buffer.alloc(4097);
      return cryptoProvider.encryptString(value);
    },
    decryptString: () => mode === 'invalid-key' ? 'secret' : 'A'.repeat(42) + 'B'
  };
  await expect(createProtectedPeerKeyProvider(root(), provider).getKey()).rejects.toThrow(/^protected peer storage key unavailable: (keychain-denied|key-corrupt)$/);
});

it('checks availability again after initialization; never decrypts when OS protection disappears', async () => {
  const dir = root(); await createProtectedPeerKeyProvider(dir, cryptoProvider).getKey();
  const decrypt = vi.fn(cryptoProvider.decryptString);
  await expect(createProtectedPeerKeyProvider(dir, { ...cryptoProvider, isEncryptionAvailable: () => false, decryptString: decrypt }).getKey()).rejects.toMatchObject({ reason: 'encryption-unavailable' });
  expect(decrypt).not.toHaveBeenCalled();
});

it('recovers bounded interrupted protected writes, including publication hard-link crash', async () => {
  const dir = root(), provider = createProtectedPeerKeyProvider(dir, cryptoProvider), key = await provider.getKey();
  const directory = join(dir, 'peer-key');
  linkSync(join(directory, 'key.bin'), join(directory, 'key-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.tmp'));
  writeFileSync(join(directory, 'key-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.tmp'), 'interrupted ciphertext', { mode: 0o600 });
  await expect(provider.getKey()).resolves.toEqual(key);
  expect(readdirSync(directory)).toEqual(['key.bin']);
});

it.each(['unexpected', 'capacity', 'hardlink', 'directory-symlink'])('rejects %s private storage state', async mode => {
  const dir = root(), provider = createProtectedPeerKeyProvider(dir, cryptoProvider);
  await provider.getKey();
  const directory = join(dir, 'peer-key');
  if (mode === 'unexpected') writeFileSync(join(directory, 'extra'), 'unexpected');
  if (mode === 'capacity') for (let i = 0; i < 33; i++) writeFileSync(join(directory, `key-${i.toString(16).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa.tmp`), 'ciphertext');
  if (mode === 'hardlink') linkSync(join(directory, 'key.bin'), join(dir, 'outside'));
  if (mode === 'directory-symlink') { rmSync(directory, { recursive: true }); symlinkSync(root(), directory); }
  await expect(provider.getKey()).rejects.toThrow('protected peer storage key unavailable');
});

it('ignores legacy environment key material and scrubs it', async () => {
  const text = randomBytes(32).toString('base64url'), env = { [PEER_BOOT_KEY_ENV]: text };
  const provider = consumePeerBootKey(env);
  expect(env).toEqual({});
  await expect(provider.getKey()).resolves.toBeNull();
  provider.dispose();
  await expect(provider.getKey()).resolves.toBeNull();
});

it('reads a dev key only from the named owner-only file when no parent port exists, and scrubs the path', async () => {
  const dir = root(), path = join(dir, 'dev-peer-key'), text = randomBytes(32).toString('base64url');
  writeFileSync(path, `${text}\n`, { mode: 0o600 });
  const env: NodeJS.ProcessEnv = { [DEV_PEER_KEY_FILE_ENV]: path };
  const provider = consumePeerBootKey(env);
  expect(env).toEqual({});
  await expect(provider.getKey()).resolves.toEqual(Buffer.from(text, 'base64url'));
  // Read once: later file changes cannot rekey a running server.
  writeFileSync(path, randomBytes(32).toString('base64url'));
  await expect(provider.getKey()).resolves.toEqual(Buffer.from(text, 'base64url'));
  provider.dispose();
  await expect(provider.getKey()).resolves.toBeNull();
});

it.each(['missing', 'mode', 'symlink', 'hardlink', 'malformed', 'non-canonical', 'oversized', 'directory'])('rejects a %s dev key file', async mode => {
  const dir = root(), path = join(dir, 'dev-peer-key'), text = randomBytes(32).toString('base64url');
  if (mode !== 'missing' && mode !== 'symlink' && mode !== 'directory') writeFileSync(path, text, { mode: 0o600 });
  if (mode === 'mode') chmodSync(path, 0o640);
  if (mode === 'symlink') { writeFileSync(join(dir, 'real'), text, { mode: 0o600 }); symlinkSync(join(dir, 'real'), path); }
  if (mode === 'hardlink') linkSync(path, join(dir, 'other'));
  if (mode === 'malformed') writeFileSync(path, 'short');
  if (mode === 'non-canonical') writeFileSync(path, `${text.slice(0, 42)}_`);
  if (mode === 'oversized') writeFileSync(path, 'A'.repeat(200));
  if (mode === 'directory') mkdirSync(path);
  await expect(readDevPeerKeyFile(path)).resolves.toBeNull();
  await expect(consumePeerBootKey({ [DEV_PEER_KEY_FILE_ENV]: path }).getKey()).resolves.toBeNull();
});

it('ignores a dev key file under an Electron parent port', async () => {
  const dir = root(), path = join(dir, 'dev-peer-key');
  writeFileSync(path, randomBytes(32).toString('base64url'), { mode: 0o600 });
  const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort');
  Object.defineProperty(process, 'parentPort', { configurable: true, value: new EventEmitter() });
  try {
    const env: NodeJS.ProcessEnv = { [DEV_PEER_KEY_FILE_ENV]: path };
    const provider = consumePeerBootKey(env);
    expect(env).toEqual({});
    await expect(provider.getKey()).resolves.toBeNull();
    provider.dispose();
  } finally {
    if (descriptor) Object.defineProperty(process, 'parentPort', descriptor);
    else Reflect.deleteProperty(process, 'parentPort');
  }
});

it('consumes first start IPC payload once, scrubs bytes before dispatch and zeros provider on disposal', async () => {
  const port = new EventEmitter();
  const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort');
  Object.defineProperty(process, 'parentPort', { configurable: true, value: port });
  try {
    const provider = consumePeerBootKey({});
    const duplicate = consumePeerBootKey({});
    const bytes = randomBytes(32), expected = Buffer.from(bytes);
    const payload = { type: 'start', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, peerBootKey: bytes };
    port.on('message', ({ data }) => {
      expect(data).not.toHaveProperty('peerBootKey');
      expect(bytes).toEqual(Buffer.alloc(32));
    });
    port.emit('message', { data: payload });
    await expect(provider.getKey()).resolves.toEqual(expected);
    await expect(duplicate.getKey()).resolves.toBeNull();
    const copy = await provider.getKey();
    copy!.fill(0);
    await expect(provider.getKey()).resolves.toEqual(expected);
    provider.dispose();
    await expect(provider.getKey()).resolves.toBeNull();
    duplicate.dispose();
  } finally {
    if (descriptor) Object.defineProperty(process, 'parentPort', descriptor);
    else Reflect.deleteProperty(process, 'parentPort');
  }
});

it.each(['wrong-version', 'short', 'oversized', 'string', 'absent'])('fails closed on %s first boot payload and cannot be rekeyed', async mode => {
  const port = new EventEmitter();
  const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort');
  Object.defineProperty(process, 'parentPort', { configurable: true, value: port });
  try {
    const provider = consumePeerBootKey({});
    port.emit('message', { data: null });
    port.emit('message', { data: 'invalid' });
    port.emit('message', { data: { type: 'request' } });
    expect(port.listenerCount('message')).toBe(1);
    const bytes = mode === 'string' ? randomBytes(32).toString('base64url') : mode === 'absent' ? undefined
      : new Uint8Array(mode === 'short' ? 31 : mode === 'oversized' ? 33 : 32).fill(19);
    const payload = { type: 'start', protocolVersion: mode === 'wrong-version' ? -1 : SERVER_RUNTIME_PROTOCOL_VERSION, peerBootKey: bytes };
    port.emit('message', { data: payload });
    expect(payload).not.toHaveProperty('peerBootKey');
    if (bytes instanceof Uint8Array) expect(bytes.every(byte => byte === 0)).toBe(true);
    expect(port.listenerCount('message')).toBe(0);
    await expect(provider.getKey()).resolves.toBeNull();
    port.emit('message', { data: { type: 'start', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, peerBootKey: randomBytes(32) } });
    await expect(provider.getKey()).resolves.toBeNull();
    provider.dispose();
  } finally {
    if (descriptor) Object.defineProperty(process, 'parentPort', descriptor); else Reflect.deleteProperty(process, 'parentPort');
  }
});

it('removes pending boot listener on disposal and prevents another consumer from claiming channel', async () => {
  const port = new EventEmitter();
  const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort');
  Object.defineProperty(process, 'parentPort', { configurable: true, value: port });
  try {
    const provider = consumePeerBootKey({ [PEER_KEY_REASON_ENV]: 'keychain-denied' });
    provider.dispose();
    expect(port.listenerCount('message')).toBe(0);
    const duplicate = consumePeerBootKey({});
    expect(port.listenerCount('message')).toBe(0);
    await expect(provider.getKey()).resolves.toBeNull();
    await expect(duplicate.getKey()).resolves.toBeNull();
    duplicate.dispose();
  } finally {
    if (descriptor) Object.defineProperty(process, 'parentPort', descriptor); else Reflect.deleteProperty(process, 'parentPort');
  }
});

it.each([undefined, '', 'plaintext', 'A'.repeat(42) + 'B'])('rejects invalid boot key %s', async text => {
  const env = { [PEER_BOOT_KEY_ENV]: text };
  const provider = consumePeerBootKey(env);
  expect(env).toEqual({});
  await expect(provider.getKey()).resolves.toBeNull();
  provider.dispose();
});

it.each([
  ['encryption unavailable', { ...cryptoProvider, isEncryptionAvailable: () => false }, 'encryption-unavailable'],
  ['no provider', undefined, 'encryption-unavailable'],
  ['keychain throws on availability', { ...cryptoProvider, isEncryptionAvailable: () => { throw new Error('denied'); } }, 'keychain-denied'],
  ['basic_text backend', { ...cryptoProvider, getSelectedStorageBackend: () => 'basic_text' }, 'insecure-backend'],
  ['encrypt denied', { ...cryptoProvider, encryptString: () => { throw new Error('locked'); } }, 'keychain-denied'],
  ['oversized wrapped key', { ...cryptoProvider, encryptString: () => Buffer.alloc(4097) }, 'keychain-denied'],
  ['decrypt garbage', { ...cryptoProvider, decryptString: () => 'secret' }, 'key-corrupt']
] as const)('reports reason code for %s', async (_name, provider, reason) => {
  const error = await createProtectedPeerKeyProvider(root(), provider as PeerCryptoProvider | undefined).getKey().catch(e => e);
  expect(error.reason).toBe(reason);
  expect(error.message).toBe(`protected peer storage key unavailable: ${reason}`);
});

it('reports storage-permissions and key-missing reasons', async () => {
  const dir = root(); chmodSync(dir, 0o777);
  await expect(createProtectedPeerKeyProvider(dir, cryptoProvider).getKey()).rejects.toMatchObject({ reason: 'storage-permissions' });
  chmodSync(dir, 0o700); mkdirSync(join(dir, 'peer-pairs'), { mode: 0o700 });
  await expect(createProtectedPeerKeyProvider(dir, cryptoProvider).getKey()).rejects.toMatchObject({ reason: 'key-missing' });
  await expect(createProtectedPeerKeyProvider(join(dir, 'missing'), cryptoProvider).getKey()).rejects.toMatchObject({ reason: 'storage-permissions' });
});

it('boot provider throws the supplied reason (never a secret), scrubs the env, and ignores unknown codes', async () => {
  const env: NodeJS.ProcessEnv = { [PEER_BOOT_KEY_ENV]: '', [PEER_KEY_REASON_ENV]: 'keychain-denied' };
  const provider = consumePeerBootKey(env);
  expect(env[PEER_KEY_REASON_ENV]).toBeUndefined();
  await expect(provider.getKey()).rejects.toMatchObject({ reason: 'keychain-denied' });
  await expect(consumePeerBootKey({ [PEER_KEY_REASON_ENV]: '../etc/passwd' }).getKey()).resolves.toBeNull();
  await expect(consumePeerBootKey({}).getKey()).resolves.toBeNull();
});

it('tags unavailable-key errors with a parseable reason and never with free text', () => {
  expect(peerKeyReasonSuffix(new PeerKeyReasonError('keychain-denied'))).toBe(' [reason=keychain-denied]');
  expect(peerKeyReasonSuffix(new Error('plain'))).toBe('');
  expect(peerKeyReasonSuffix({ reason: 'Bad Value; rm -rf' })).toBe('');
  expect(peerKeyReasonSuffix(null)).toBe('');
});
