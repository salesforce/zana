import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRuntime } from './runtime.js';
const fake = vi.hoisted(() => ({ supervise: vi.fn(), execute: vi.fn(), previewClose: vi.fn() }));
vi.mock('./process.js', () => ({ supervise: fake.supervise, execute: fake.execute }));
vi.mock('./preview.js', () => ({ createPreview: () => ({ close: fake.previewClose }) }));
const roots: string[] = [];
const children: { alive: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] = [];
const done = (exitCode = 0) => JSON.stringify({ type: 'done', exitCode, durationMs: 1 });
let port = '12345\n/devtools/browser/test-id';
let readiness = true, alive = true;
beforeEach(() => {
  vi.clearAllMocks(); children.length = 0; readiness = true; alive = true; port = '12345\n/devtools/browser/test-id';
  fake.execute.mockImplementation(async (_binary, args: string[]) => args.at(-1) === 'JSON.stringify(await browser.listPages())'
    ? JSON.stringify({ type: 'result', value: JSON.stringify([{ id: 'A'.repeat(32) }]) }) + '\n' + done()
    : done());
  fake.supervise.mockImplementation((_command, args: string[], env) => {
    const child = { alive: vi.fn(() => alive), close: vi.fn(async () => {}) }; children.push(child);
    if (readiness) {
      if (args[0] === 'daemon') void writeFile(join(env.DEV_BROWSER_HOME, 'daemon.pid'), '1');
      else {
        const profile = args.find(arg => arg.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length);
        void mkdir(profile, { recursive: true }).then(() => writeFile(join(profile, 'DevToolsActivePort'), port));
      }
    }
    return child;
  });
});
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function args(connectionUrl?: string) {
  const root = await mkdtemp('/tmp/zcc-browser-runtime-test-'); roots.push(root);
  await mkdir(join(root, 'runtime')); await writeFile(join(root, 'runtime/chrome'), 'fake', { mode: 0o700 });
  return { dataDir: root, tempDir: join(root, 'sessions'), runtime: { binary: '/fake/dev-browser', version: 'test', source: 'developer-artifact' as const }, signal: new AbortController().signal, ...(connectionUrl ? { connectionUrl } : {}) };
}
it('starts locally, serializes commands, creates preview and removes its runtime on close', async () => {
  const input = await args(); const runtime = await createRuntime(input);
  expect(children).toHaveLength(2); expect(runtime.preview).not.toBeNull();
  expect(fake.supervise.mock.calls[0][1]).toContain('--use-mock-keychain');
  let release!: (value: string) => void;
  fake.execute.mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve; }));
  const first = runtime.run('first', 1000, input.signal), second = runtime.run('second', 1000, input.signal);
  await vi.waitFor(() => expect(fake.execute).toHaveBeenCalledTimes(2));
  release(done()); await Promise.all([first, second]); expect(fake.execute).toHaveBeenCalledTimes(3);
  await Promise.all([runtime.close(), runtime.stop()]);
  expect(children.every(child => child.close.mock.calls.length === 1)).toBe(true); expect(fake.previewClose).toHaveBeenCalledOnce();
  expect(await readdir(input.tempDir)).toEqual([]);
  await expect(runtime.run('after close', 1000, input.signal)).rejects.toThrow();
});
it('attaches only to private loopback endpoints without starting another browser', async () => {
  for (const endpoint of ['ws://localhost:1234/cdp', 'ws://[::1]:1234/cdp']) {
    const runtime = await createRuntime(await args(endpoint)); expect(runtime.preview).toBeNull(); await runtime.close();
  }
  for (const endpoint of ['wss://localhost:1234/cdp', 'ws://external.example/cdp']) {
    const input = await args(endpoint); await expect(createRuntime(input)).rejects.toThrow('private loopback'); expect(await readdir(input.tempDir)).toEqual([]);
  }
});
it.each(['broken', 'timeout', 'exit'])('cleans up after a %s command', async failure => {
  const input = await args('ws://127.0.0.1:1234/cdp'); const runtime = await createRuntime(input);
  if (failure === 'broken') fake.execute.mockResolvedValueOnce('invalid frame');
  else if (failure === 'timeout') fake.execute.mockResolvedValueOnce(done(124));
  else alive = false;
  const result = runtime.run('work', 1000, input.signal);
  if (failure === 'timeout') expect((await result).exitCode).toBe(124);
  else await expect(result).rejects.toThrow();
  await runtime.close(); expect(await readdir(input.tempDir)).toEqual([]);
});
it('names startup readiness failures and removes failed sessions', async () => {
  readiness = false; alive = false;
  const input = await args(); await expect(createRuntime(input)).rejects.toThrow('Chrome debugging port');
  expect(await readdir(input.tempDir)).toEqual([]);
  alive = true;
  const controller = new AbortController(); controller.abort();
  await expect(createRuntime({ ...input, signal: controller.signal })).rejects.toThrow('startup stopped');
});
it.each(['bad-port\n/devtools/browser/id', '1234\n/invalid'])('rejects invalid Chrome readiness %s', async invalid => {
  port = invalid; const input = await args(); await expect(createRuntime(input)).rejects.toThrow(); expect(await readdir(input.tempDir)).toEqual([]);
});
it('cleans up a session whose actual socket path exceeds the Unix limit', async () => {
  const input = await args(); input.tempDir = join(input.dataDir, 'x'.repeat(85));
  await expect(createRuntime(input)).rejects.toThrow('socket path is too long'); expect(await readdir(input.tempDir)).toEqual([]);
});

it('rejects failed or malformed initial page discovery and cleans up its worker', async () => {
  for (const response of [done(1), JSON.stringify({ type: 'result', value: 'invalid JSON' }) + '\n' + done(), JSON.stringify({ type: 'result', value: JSON.stringify([{ id: 'not-a-target' }]) }) + '\n' + done()]) {
    fake.execute.mockResolvedValueOnce(response);
    const input = await args('ws://127.0.0.1:1234/cdp');
    await expect(createRuntime(input)).rejects.toThrow();
    expect(await readdir(input.tempDir)).toEqual([]);
  }
});

it('does not arbitrarily choose an initial page when multiple targets exist', async () => {
  fake.execute.mockResolvedValueOnce(JSON.stringify({ type: 'result', value: JSON.stringify([{ id: 'A'.repeat(32) }, { id: 'B'.repeat(32) }]) }) + '\n' + done());
  const input = await args('ws://127.0.0.1:1234/cdp');
  const runtime = await createRuntime(input);
  await runtime.run('work', 1000, input.signal);
  expect(fake.execute.mock.calls.at(-1)![1].at(-1)).toBe('work');
  await runtime.close();
});
