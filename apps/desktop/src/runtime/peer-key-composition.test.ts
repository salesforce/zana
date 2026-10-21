import { EventEmitter } from 'node:events';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { SERVER_RUNTIME_PROTOCOL_VERSION as protocolVersion } from '@zana-ai/zcc-contracts/runtime';
import { PEER_BOOT_KEY_ENV, PEER_KEY_REASON_ENV } from '@zana-ai/zcc-server/services/peers/protected-key';

const mocks = vi.hoisted(() => ({ fork: vi.fn(), available: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn(), backend: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: mocks.fork }, safeStorage: {
  isEncryptionAvailable: mocks.available, encryptString: mocks.encrypt,
  decryptString: mocks.decrypt, getSelectedStorageBackend: mocks.backend
} }));
vi.mock('@zana-ai/zcc-server/plugins/plugin-service', () => ({ defaultBundledRoot: () => '/test/plugins' }));
import { startRuntimeSupervisor, type RuntimeSupervisor } from './runtime-supervisor.js';

const roots: string[] = [], runtimes: RuntimeSupervisor[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs(); vi.resetAllMocks();
});
function setup() {
  vi.stubEnv('ZCC_E2E_HOME', '');
  vi.stubEnv(PEER_BOOT_KEY_ENV, 'must-not-reach-daemon');
  const dir = mkdtempSync(join(tmpdir(), 'zcc-peer-composition-')); roots.push(dir);
  writeFileSync(join(dir, 'host-enroll.token'), 'test-enrollment-token-test-enrollment');
  const plainKeys: string[] = [], wrappingKey = randomBytes(32);
  mocks.available.mockReturnValue(true); mocks.backend.mockReturnValue('gnome_libsecret');
  mocks.encrypt.mockImplementation((plain: string) => {
    plainKeys.push(plain);
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
    return Buffer.concat([iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  });
  mocks.decrypt.mockImplementation(() => plainKeys[0]);
  mocks.fork.mockImplementation((entry: string) => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), postMessage: vi.fn(), bootKeys: [] as (Uint8Array | undefined)[] });
    child.postMessage.mockImplementation((message: { type: string; peerBootKey?: Uint8Array }) => {
      // The supplier zeroes the buffer right after postMessage returns, so snapshot the bytes now.
      if (message.type === 'start') child.bootKeys.push(message.peerBootKey ? Uint8Array.from(message.peerBootKey) : undefined);
      if (message.type === 'start') queueMicrotask(() => child.emit('message', {
        type: 'ready', protocolVersion, url: entry.includes('host-runtime') ? 'http://127.0.0.1:40100' : 'http://127.0.0.1:40101/',
        hostId: randomUUID(), instanceId: randomUUID()
      }));
      if (message.type === 'enroll') queueMicrotask(() => child.emit('message', { type: 'enrolled', protocolVersion, hostId: randomUUID() }));
      if (message.type === 'stop') queueMicrotask(() => child.emit('message', { type: 'stopped', protocolVersion }));
    });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  });
  return { dir, plainKeys };
}
async function start(dir: string) {
  const runtime = await startRuntimeSupervisor({ dataDir: dir, runtimeDir: '/test/runtime', rendererRoot: '/test/renderer',
    extraEnv: { [PEER_BOOT_KEY_ENV]: 'must-not-override-host-key', ZCC_PRODUCT_SERVER_CREDENTIAL: 'ui-secret' } });
  runtimes.push(runtime);
  return runtime;
}
it('passes protected key only to product utility; daemon excludes inherited key; restart reuses ciphertext', async () => {
  const { dir, plainKeys } = setup();
  await start(dir);
  const [daemon, server] = mocks.fork.mock.calls;
  const [daemonChild, serverChild] = mocks.fork.mock.results.map(r => r.value as { bootKeys: (Uint8Array | undefined)[] });
  // Boot key never travels through env (process listings) — the daemon never receives it, and the server gets it only over the structured-clone start message.
  expect(daemon[2].env[PEER_BOOT_KEY_ENV]).toBeUndefined();
  expect(server[2].env[PEER_BOOT_KEY_ENV]).toBeUndefined();
  expect(daemonChild.bootKeys[0]).toBeUndefined();
  expect(serverChild.bootKeys[0]).toEqual(new Uint8Array(Buffer.from(plainKeys[0], 'base64url')));
  expect(serverChild.bootKeys[0]).toHaveLength(32);
  expect(server[2].env.ZCC_PRODUCT_SERVER_CREDENTIAL).toBe('ui-secret');
  expect(process.env[PEER_BOOT_KEY_ENV]).toBe('must-not-reach-daemon');
  const ciphertext = readFileSync(join(dir, 'peer-key', 'key.bin'));
  expect(ciphertext.includes(Buffer.from(plainKeys[0]))).toBe(false);
  await start(dir);
  expect(mocks.encrypt).toHaveBeenCalledOnce();
  const restartServer = mocks.fork.mock.results[3].value as { bootKeys: (Uint8Array | undefined)[] };
  expect(restartServer.bootKeys[0]).toEqual(new Uint8Array(Buffer.from(plainKeys[0], 'base64url')));
  expect(readFileSync(join(dir, 'peer-key', 'key.bin'))).toEqual(ciphertext);
  if (process.platform !== 'linux') expect(mocks.backend).not.toHaveBeenCalled();
});
it.each(['unavailable', 'e2e', 'backend-error', ...(process.platform === 'linux' ? ['basic_text', 'unknown'] : [])])('never sends fallback key when protection is %s', async mode => {
  const { dir } = setup();
  if (mode === 'unavailable') mocks.available.mockReturnValue(false);
  if (mode === 'basic_text' || mode === 'unknown') mocks.backend.mockReturnValue(mode);
  if (mode === 'e2e') vi.stubEnv('ZCC_E2E_HOME', dir);
  if (mode === 'backend-error') mocks.available.mockImplementation(() => { throw new Error('private Keychain detail'); });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await start(dir);
  const [daemonChild, serverChild] = mocks.fork.mock.results.map(r => r.value as { bootKeys: (Uint8Array | undefined)[] });
  // No protected key: neither child is handed boot-key bytes, and env stays clear of it.
  expect(mocks.fork.mock.calls[0][2].env[PEER_BOOT_KEY_ENV]).toBeUndefined();
  expect(mocks.fork.mock.calls[1][2].env[PEER_BOOT_KEY_ENV]).toBeUndefined();
  expect(daemonChild.bootKeys[0]).toBeUndefined();
  expect(serverChild.bootKeys[0]).toBeUndefined();
  const reason = mocks.fork.mock.calls[1][2].env[PEER_KEY_REASON_ENV];
  if (mode === 'e2e') { expect(reason).toBe(''); expect(warn).not.toHaveBeenCalled(); }
  else {
    expect(reason).toBe({ unavailable: 'encryption-unavailable', 'backend-error': 'keychain-denied' }[mode] ?? 'insecure-backend');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`unavailable: ${reason}`));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private Keychain detail');
  }
  warn.mockRestore();
  expect(mocks.encrypt).not.toHaveBeenCalled();
  expect(existsSync(join(dir, 'peer-key'))).toBe(false);
  if (mode === 'e2e') expect(mocks.available).not.toHaveBeenCalled();
});
