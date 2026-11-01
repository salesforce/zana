import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('abandons only the requested call, releases its environment once, and accepts the next call', async () => {
  directory = await mkdtemp(join(tmpdir(), 'zcc-worker-cancellation-'));
  const artifact = join(directory, 'entry.mjs');
  const envKey = 'ZCC_PLUGIN_WORKER_CANCELLATION_FIXTURE';
  vi.stubEnv(envKey, 'original');
  await writeFile(artifact, `
    export const calls = new Map();
    export default function(api) {
      api.methods.register('hold', (id, context) => new Promise(resolve => {
        calls.set(id, { signal: context.signal, finish: () => resolve(id) });
      }));
      api.methods.register('read', () => process.env.${envKey});
    }
  `);
  const messages: Record<string, unknown>[] = [];
  process.argv = ['node', 'worker', artifact, 'fixture', 'generation-1', directory, directory, '5000'];
  Object.defineProperty(process, 'connected', { configurable: true, value: true });
  Object.defineProperty(process, 'send', { configurable: true, value: (message: Record<string, unknown>) => messages.push(message) });
  Object.defineProperty(process, 'disconnect', { configurable: true, value: () => {} });
  vi.resetModules();
  await import('./plugin-host-worker.js');
  const { calls } = await import(pathToFileURL(artifact).href);
  const emit = (message: Record<string, unknown>) => process.emit('message', message, null);
  const call = (callId: string, method: string, value: string) => emit({
    type: 'call', callId, method, input: callId, envVars: { [envKey]: value },
  });
  call('first', 'hold', 'shared');
  call('second', 'hold', 'shared');
  await vi.waitFor(() => expect(calls.size).toBe(2));
  emit({ type: 'cancel', callId: 'first' });
  expect(calls.get('first').signal.aborted).toBe(true);
  expect(calls.get('second').signal.aborted).toBe(false);
  expect(process.env[envKey]).toBe('shared');

  emit({ type: 'abandon', callId: 'first' });
  emit({ type: 'abandon', callId: 'missing' });
  emit({ type: 'abandon', callId: 42 });
  emit({ type: 'watch-ready', watchId: 'missing' });
  expect(calls.get('second').signal.aborted).toBe(false);
  expect(process.env[envKey]).toBe('shared');
  calls.get('second').finish();
  await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ callId: 'second', ok: true })));
  expect(process.env[envKey]).toBe('original');

  call('probe', 'read', 'next');
  await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ callId: 'probe', ok: true, output: 'next' })));
  expect(process.env[envKey]).toBe('original');
  calls.get('first').finish();
  await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ callId: 'first', ok: true })));
  emit({ type: 'abandon', callId: 'first' });
  expect(process.env[envKey]).toBe('original');
});

it('confines project roots in worker IPC and supplies valid scope to handlers', async () => {
  directory = await mkdtemp(join(tmpdir(), 'zcc-worker-coverage-'));
  const artifact = join(directory, 'entry.mjs');
  await writeFile(artifact, `export default function(api) {
    api.methods.register('paths', (_, context) => context.experimental_paths);
  }`);
  const messages: Record<string, unknown>[] = [];
  process.argv = ['node', 'worker', artifact, 'fixture', 'generation-1', directory, directory, '5000'];
  Object.defineProperty(process, 'connected', { configurable: true, value: true });
  Object.defineProperty(process, 'send', { configurable: true, value: (message: Record<string, unknown>) => messages.push(message) });
  Object.defineProperty(process, 'disconnect', { configurable: true, value: () => {} });
  vi.resetModules();
  await import('./plugin-host-worker.js');
  expect(messages).toContainEqual(expect.objectContaining({ type: 'ready', pluginId: 'fixture' }));

  const call = (callId: string, projectRoot?: unknown) => process.emit('message', {
    type: 'call', callId, method: 'paths', input: null, envVars: {},
    ...(projectRoot === undefined ? {} : { projectRoot }),
  }, null);
  call('relative', '../escape');
  call('number', 42);
  call('default');
  call('absolute', directory);
  await vi.waitFor(() => expect(messages.filter(message => message.type === 'result')).toHaveLength(2));
  expect(messages).not.toContainEqual(expect.objectContaining({ callId: 'relative' }));
  expect(messages).not.toContainEqual(expect.objectContaining({ callId: 'number' }));
  expect(messages).toContainEqual(expect.objectContaining({ callId: 'default', ok: true, output: expect.objectContaining({ projectRoot: null }) }));
  expect(messages).toContainEqual(expect.objectContaining({ callId: 'absolute', ok: true, output: expect.objectContaining({ projectRoot: directory }) }));
});
