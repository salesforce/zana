import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { consumePeerBootKey, PEER_BOOT_KEY_ENV } from '@zana-ai/zcc-server/services/peers/protected-key';
import { SERVER_RUNTIME_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/runtime';

const h = vi.hoisted(() => ({ key: Buffer.alloc(32, 19), forks: [] as any[], messages: [] as any[], port: undefined as any, provider: undefined as any, failure: '', denied: false }));
vi.mock('@zana-ai/zcc-server/services/peers/protected-key', async importOriginal => ({
  ...await importOriginal<any>(),
  createProtectedPeerKeyProvider: () => ({ getKey: async () => { if (h.denied) throw new Error('secret error text'); return h.key; } })
}));
vi.mock('electron', () => ({ utilityProcess: { fork: (entry: string, _args: string[], options: any) => {
  h.forks.push({ entry, options });
  if (entry.endsWith('server-runtime.js') && h.failure === 'fork') throw new Error('fork failed');
  const child = new EventEmitter() as any;
  child.kill = vi.fn(() => child.emit('exit'));
  child.postMessage = (message: any) => {
    if (entry.endsWith('server-runtime.js') && h.failure === 'send') throw new Error('secret error text');
    h.messages.push(structuredClone(message));
    if (message.type === 'start') {
      if (entry.endsWith('server-runtime.js')) h.port.emit('message', { data: structuredClone(message) });
      setImmediate(() => child.emit('message', { type: 'ready', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
        url: 'http://127.0.0.1:8780', hostId: 'host-1', instanceId: 'instance-1' }));
    }
    if (message.type === 'stop') setImmediate(() => child.emit('message', { type: 'stopped', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION }));
  };
  const spawn = () => {
    if (entry.endsWith('server-runtime.js')) {
      if (h.failure === 'exit') { child.emit('exit'); child.emit('spawn'); return; }
      if (h.failure === 'fatal') { child.emit('error', 'fatal', 'location', 'report'); return; }
      if (h.failure === 'timeout') return;
    }
    child.emit('spawn');
  };
  if (h.failure === 'timeout') queueMicrotask(spawn); else setImmediate(spawn);
  return child;
} }, safeStorage: {} }));
vi.mock('./enroll-host-utility.js', () => ({ enrollHostUtility: async () => 'host-1' }));
const { startRuntimeSupervisor } = await import('./runtime-supervisor.js');
const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); h.failure = ''; h.denied = false; h.forks.length = 0; h.messages.length = 0; for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('boots through IPC without putting decrypted key in either child environment', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-peer-boot-')); roots.push(dir);
  vi.stubEnv('ZCC_E2E_HOME', '');
  vi.stubEnv('ZCC_HOST_ENROLL_TOKEN', 'x'.repeat(32));
  vi.stubEnv(PEER_BOOT_KEY_ENV, 'inherited-secret');
  h.key = Buffer.alloc(32, 19);
  const expected = Buffer.from(h.key);
  h.port = new EventEmitter();
  const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort');
  Object.defineProperty(process, 'parentPort', { configurable: true, value: h.port });
  h.provider = consumePeerBootKey({});
  let runtime: Awaited<ReturnType<typeof startRuntimeSupervisor>> | undefined;
  try {
    runtime = await startRuntimeSupervisor({ rendererRoot: dir, runtimeDir: dir, dataDir: dir,
      extraEnv: { [PEER_BOOT_KEY_ENV]: 'extra-secret', KEEP: 'kept' } });
    for (const { options } of h.forks) {
      expect(options.env).not.toHaveProperty(PEER_BOOT_KEY_ENV);
      expect(Object.values(options.env)).not.toContain(expected.toString('base64url'));
    }
    expect(h.forks[1].options.env.KEEP).toBe('kept');
    expect(h.messages[0]).not.toHaveProperty('peerBootKey');
    await expect(h.provider.getKey()).resolves.toEqual(expected);
    expect(h.key).toEqual(Buffer.alloc(32));
    expect(runtime.rendererUrl).toBe('http://127.0.0.1:8780');
  } finally {
    await runtime?.close(); h.provider.dispose();
    if (descriptor) Object.defineProperty(process, 'parentPort', descriptor); else Reflect.deleteProperty(process, 'parentPort');
  }
});

it.each(['fork', 'send', 'exit', 'fatal', 'timeout'])('zeros pending key when boot fails at %s', async failure => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-peer-boot-')); roots.push(dir);
  vi.stubEnv('ZCC_E2E_HOME', '');
  h.key = Buffer.alloc(32, 19); h.failure = failure;
  if (failure === 'timeout') vi.useFakeTimers();
  const boot = startRuntimeSupervisor({ rendererRoot: dir, runtimeDir: dir, dataDir: dir });
  const assertion = expect(boot).rejects.toThrow(failure === 'fork' ? 'fork failed' : failure === 'send' ? 'runtime child boot delivery failed'
    : failure === 'exit' ? 'runtime child exited before ready' : failure === 'fatal' ? 'runtime child fatal error' : 'runtime child start timed out');
  if (failure === 'timeout') await vi.advanceTimersByTimeAsync(15_000);
  await assertion;
  expect(h.key).toEqual(Buffer.alloc(32));
  expect(h.messages.filter(message => message.peerBootKey)).toEqual([]);
});

it('boots without key when protection is unavailable and sends reason only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-peer-boot-')); roots.push(dir);
  vi.stubEnv('ZCC_E2E_HOME', ''); vi.stubEnv('ZCC_HOST_ENROLL_TOKEN', 'x'.repeat(32));
  h.denied = true; h.port = new EventEmitter();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const runtime = await startRuntimeSupervisor({ rendererRoot: dir, runtimeDir: dir, dataDir: dir });
  try {
    expect(h.messages.every(message => !('peerBootKey' in message))).toBe(true);
    expect(h.forks[1].options.env.ZCC_PEER_STORAGE_KEY_REASON).toBe('unknown');
    expect(warn).toHaveBeenCalledWith('[peers] protected peer key unavailable: unknown; peer links and invitations are off');
  } finally { await runtime.close(); }
});
