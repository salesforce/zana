import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const originalArgv = process.argv;
const originalSend = process.send;
const originalConnected = process.connected;
const originalDisconnect = process.disconnect;
const originalMessages = new Set(process.listeners('message'));
const originalDisconnects = new Set(process.listeners('disconnect'));
let directory: string | undefined;

afterEach(async () => {
  for (const listener of process.listeners('message')) {
    if (!originalMessages.has(listener)) process.removeListener('message', listener);
  }
  for (const listener of process.listeners('disconnect')) {
    if (!originalDisconnects.has(listener)) process.removeListener('disconnect', listener);
  }
  process.argv = originalArgv;
  Object.defineProperty(process, 'send', { configurable: true, value: originalSend });
  Object.defineProperty(process, 'connected', { configurable: true, value: originalConnected });
  Object.defineProperty(process, 'disconnect', { configurable: true, value: originalDisconnect });
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
  vi.restoreAllMocks();
});

async function startWorker(extraArgs: string[]) {
  directory = await mkdtemp(join(tmpdir(), 'zcc-worker-thread-storage-'));
  const artifact = join(directory, 'entry.mjs');
  await writeFile(artifact, `export default function(api) {
    api.methods.register('paths', (_, context) => context.experimental_paths);
  }`);
  const messages: Record<string, unknown>[] = [];
  process.argv = ['node', 'worker', artifact, 'fixture', 'generation-1', directory, directory, ...extraArgs];
  Object.defineProperty(process, 'connected', { configurable: true, value: true });
  Object.defineProperty(process, 'send', { configurable: true, value: (message: Record<string, unknown>) => messages.push(message) });
  Object.defineProperty(process, 'disconnect', { configurable: true, value: () => {} });
  vi.resetModules();
  await import('./plugin-host-worker.js');
  const call = async (callId: string) => {
    process.emit('message', { type: 'call', callId, method: 'paths', input: null, envVars: {} }, null);
    await vi.waitFor(() => expect(messages.some(message => message.callId === callId)).toBe(true));
    return messages.find(message => message.callId === callId);
  };
  return { messages, call };
}

it('exposes the daemon-computed thread-storage root to handlers', async () => {
  const root = join(tmpdir(), 'zcc-daemon-data', 'thread-storage');
  const { call } = await startWorker([`--thread-storage-root=${root}`]);
  expect(await call('with-root')).toMatchObject({ ok: true, output: { threadStorageRoot: root } });
});

it('reports a null thread-storage root when the daemon passed none', async () => {
  const { call } = await startWorker([]);
  expect(await call('without-root')).toMatchObject({ ok: true, output: { threadStorageRoot: null } });
});

it('keeps positional arguments working when the flag precedes the dispose timeout', async () => {
  const root = join(tmpdir(), 'zcc-daemon-data', 'thread-storage');
  const { call } = await startWorker([`--thread-storage-root=${root}`, '5000']);
  expect(await call('flag-then-timeout')).toMatchObject({ ok: true, output: { threadStorageRoot: root } });
});

it('rejects a relative thread-storage root instead of guessing', async () => {
  directory = await mkdtemp(join(tmpdir(), 'zcc-worker-thread-storage-'));
  const artifact = join(directory, 'entry.mjs');
  await writeFile(artifact, 'export default function() {}');
  process.argv = ['node', 'worker', artifact, 'fixture', 'generation-1', directory, directory, '--thread-storage-root=relative/thread-storage'];
  Object.defineProperty(process, 'connected', { configurable: true, value: true });
  Object.defineProperty(process, 'send', { configurable: true, value: () => {} });
  vi.resetModules();
  await expect(import('./plugin-host-worker.js')).rejects.toThrow('invalid host worker arguments');
});
