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
