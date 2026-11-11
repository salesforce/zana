import { mkdtemp, readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNamedCheckDiscovery } from '../../../named-check-registry.js';
import { createNamedCheckRunner } from '../check-runner.js';
import { createProjectSettingsStore } from '../../../project-settings-store.js';

vi.mock('node:child_process', { spy: true });
vi.mock('node:fs/promises', { spy: true });

const roots: string[] = [];
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(command: string, options: Record<string, unknown> = {}) {
  const module = await import('../check-runner.js');
  expect(module).toHaveProperty('createNamedCheckRunner', expect.any(Function));
  const root = await mkdtemp(join(tmpdir(), 'named-check-runner-test-'));
  roots.push(root);
  const store = createProjectSettingsStore({ projectSettingsFile: join(root, 'settings.json') });
  await store.setNamedChecks({ kind: 'global' }, [{ name: 'test', command }]);
  const runner = module.createNamedCheckRunner({ store, tempRoot: root, resolveCwd: async () => root, ...options });
  return { root, store, runner, run: (signal?: AbortSignal) => runner.run({ projectId: 'p1', reference: 'check:test', cwd: root, signal }) };
}
const node = (script: string) => `'${process.execPath.replaceAll("'", "'\\''")}' -e '${script.replaceAll("'", "'\\''")}'`;

it('run rejects Windows before resolving cwd, creating capture, spawning, or checking shell', async () => {
  const resolveCwd = vi.fn(async () => 'unreachable');
  const { root, run } = await fixture('exit 0', { resolveCwd });
  vi.mocked(fsPromises.mkdtemp).mockClear();
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

  await expect(run()).rejects.toThrow('Named checks require process-group and file-limit support');

  expect(resolveCwd).not.toHaveBeenCalled();
  expect(fsPromises.mkdtemp).not.toHaveBeenCalled();
  expect(fsPromises.access).not.toHaveBeenCalled();
  expect(childProcess.spawn).not.toHaveBeenCalled();
  expect(await readdir(root)).toEqual(['settings.json']);
});

it('runResolved rejects Windows before resolving cwd, creating capture, spawning, or checking shell', async () => {
  const resolveCwd = vi.fn(async () => 'unreachable');
  const { root, runner } = await fixture('exit 0', { resolveCwd });
  vi.mocked(fsPromises.mkdtemp).mockClear();
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

  await expect(runner.runResolved({ projectId: 'p1', check: { name: 'test', command: 'exit 0' }, cwd: root }))
    .rejects.toThrow('Named checks require process-group and file-limit support');

  expect(resolveCwd).not.toHaveBeenCalled();
  expect(fsPromises.mkdtemp).not.toHaveBeenCalled();
  expect(fsPromises.access).not.toHaveBeenCalled();
  expect(childProcess.spawn).not.toHaveBeenCalled();
  expect(await readdir(root)).toEqual(['settings.json']);
});

describe.skipIf(process.platform === 'win32')('POSIX named-check runner', () => {

it('captures more than 8192 bytes and nonzero exit without returning a file path', async () => {
  const { run, root } = await fixture(node('process.stdout.write("x".repeat(20000)); process.stderr.write("failure"); process.exitCode=7'));
  const result = await run();
  expect(result).toMatchObject({ status: 'failed', exitCode: 7, output: 'x'.repeat(20000) + 'failure', untrusted: true });
  expect(result).not.toHaveProperty('outputPath');
  expect(await readdir(root)).toEqual(['settings.json']);
});

it('uses actual cwd/env and project override, and names-only discovery', async () => {
  const { runner, root, store, run } = await fixture('exit 9', { env: { ...process.env, CHECK_TEST: 'configured' } });
  await store.setNamedChecks({ kind: 'project', projectId: 'p1' }, [{ name: 'test', command: node('process.stdout.write(process.cwd()+"|"+process.env.CHECK_TEST)') }]);
  expect(runner.listNames('p1')).toEqual(['test']);
  expect(createNamedCheckDiscovery(store)).toEqual({ listNames: expect.any(Function) });
  expect(createNamedCheckDiscovery(store).listNames('p1')).toEqual(['test']);
  expect(runner.resolve('p1', 'check:test')).toEqual({ name: 'test', command: expect.any(String) });
  expect(await run()).toMatchObject({ status: 'passed', exitCode: 0, output: await realpath(root) + '|configured' });
  await expect(runner.run({ projectId: 'p1', reference: 'check:missing', cwd: root })).rejects.toThrow('Unknown check');
  await expect(runner.run({ projectId: 'p1', reference: 'echo injected', cwd: root })).rejects.toThrow('Invalid check reference');
  await expect(runner.run({ projectId: 'p1', reference: 'check:test', cwd: root, command: 'exit 0' } as never)).rejects.toThrow('command');
});

it('caps output and cleans capture files', async () => {
  const { root, run } = await fixture(node('for (;;) process.stdout.write("x".repeat(4096))'), { maxBytes: 8192 });
  const result = await run();
  expect(result.status).toBe('output-limit');
  expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(8192);
  expect(await readdir(root)).toEqual(['settings.json']);
});

it('preserves output below configured byte cap', async () => {
  const { run } = await fixture(node('process.stdout.write("x".repeat(6000))'), { maxBytes: 8192 });
  expect(await run()).toMatchObject({ status: 'passed', output: 'x'.repeat(6000) });
});

it('kills timed out process groups and cleans files', async () => {
  const { root, run } = await fixture('sleep 10 & echo $! > child.pid; wait', { timeoutMs: 100 });
  expect(await run()).toMatchObject({ status: 'timeout', exitCode: null });
  const pid = Number(await readFile(join(root, 'child.pid'), 'utf8'));
  let alive = true;
  for (let i = 0; i < 100 && alive; i++) {
    try { process.kill(pid, 0); await new Promise((resolve) => setTimeout(resolve, 5)); }
    catch { alive = false; }
  }
  expect(alive).toBe(false);
  expect((await readdir(root)).sort()).toEqual(['child.pid', 'settings.json']);
});

it('uses 0600 capture, bounds concurrency, cancels active work and shuts down', async () => {
  const { root, run, runner } = await fixture('sleep 10', { maxConcurrent: 1 });
  const controller = new AbortController();
  const pending = run(controller.signal);
  let dirs: string[] = [];
  for (let i = 0; i < 100; i++) {
    dirs = (await readdir(root)).filter((name) => name !== 'settings.json');
    if (dirs.length && (await readdir(join(root, dirs[0]))).length) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(dirs).toHaveLength(1);
  expect((await stat(join(root, dirs[0], 'output'))).mode & 0o777).toBe(0o600);
  const queued = run();
  controller.abort();
  expect(await pending).toMatchObject({ status: 'cancelled' });
  await runner.dispose();
  expect(await queued).toMatchObject({ status: 'cancelled' });
  expect(await readdir(root)).toEqual(['settings.json']);
  await expect(run()).rejects.toThrow('closed');
});

it('cleans spawn errors and pre-cancelled work; rejects unconfined cwd', async () => {
  const { root, run } = await fixture('echo hello', { shell: '/no-such-shell' });
  expect(await run()).toMatchObject({ status: 'spawn-error' });
  expect(await readdir(root)).toEqual(['settings.json']);
  expect(await run(AbortSignal.abort())).toMatchObject({ status: 'cancelled' });
  const other = await fixture('exit 0', { resolveCwd: async () => { throw new Error('unconfined cwd'); } });
  await expect(other.run()).rejects.toThrow('unconfined cwd');
  expect(await readdir(other.root)).toEqual(['settings.json']);
});

it('rejects invalid runner bounds without spawning', async () => {
  const { store, root } = await fixture('exit 0');
  for (const bounds of [{ timeoutMs: 0 }, { maxBytes: 0 }, { maxConcurrent: 0 }, { maxQueued: 0 }, { maxQueued: 257 }, { maxQueued: 1.5 }]) {
    expect(() => createNamedCheckRunner({ store, resolveCwd: async () => root, ...bounds })).toThrow('bounds');
  }
});

it('executes admission snapshot after registry changes without consulting live commands', async () => {
  const { runner, store, root, run } = await fixture('printf frozen');
  expect(runner).toHaveProperty('runResolved', expect.any(Function));
  const check = runner.resolve('p1', 'check:test');
  await store.setNamedChecks({ kind: 'global' }, [{ name: 'test', command: 'printf changed; exit 7' }]);
  expect(await runner.runResolved({ projectId: 'p1', check, cwd: root })).toMatchObject({ status: 'passed', output: 'frozen' });
  const pending = runner.runResolved({ projectId: 'p1', check, cwd: root });
  check.command = 'printf mutated';
  expect(await pending).toMatchObject({ status: 'passed', output: 'frozen' });
  check.command = 'printf frozen';
  expect(await run()).toMatchObject({ status: 'failed', exitCode: 7, output: 'changed' });
  await store.setNamedChecks({ kind: 'global' }, []);
  expect(await runner.runResolved({ projectId: 'p1', check, cwd: root })).toMatchObject({ status: 'passed', output: 'frozen' });
  expect(await readdir(root)).toEqual(['settings.json']);
});

it('validates frozen commands and parser-aligned names before allocating capture', async () => {
  const { runner, root } = await fixture('exit 0');
  expect(runner).toHaveProperty('runResolved', expect.any(Function));
  for (const check of [
    { name: 'test', command: '' }, { name: 'test', command: 'x'.repeat(16_385) },
    { name: 'test', command: 'echo\0bad' }, { name: 'test', command: '  ' },
    { name: '1test', command: 'exit 0' }, { name: 'test.dot', command: 'exit 0' },
    { name: 'a'.repeat(101), command: 'exit 0' },
    { name: 'test', command: 'exit 0', owner: true }
  ]) await expect(runner.runResolved({ projectId: 'p1', check, cwd: root } as never)).rejects.toThrow();
  await expect(runner.runResolved({ projectId: '$globalNamedChecks', check: { name: 'test', command: 'exit 0' }, cwd: root })).rejects.toThrow();
  await expect(runner.runResolved({ projectId: 'p1', check: { name: 'test', command: 'exit 0' }, cwd: root, owner: true } as never)).rejects.toThrow('unknown input');
  expect(await runner.runResolved({ projectId: 'p1', check: { name: '_' + 'a'.repeat(99), command: 'exit 0' }, cwd: root })).toMatchObject({ status: 'passed' });
  await expect(runner.run({ projectId: 'p1', reference: 'check:1test', cwd: root })).rejects.toThrow('Invalid check reference');
  expect(await readdir(root)).toEqual(['settings.json']);
  await runner.dispose();
  await expect(runner.runResolved({ projectId: 'p1', check: { name: 'test', command: 'exit 0' }, cwd: root })).rejects.toThrow('closed');
});

it('shares concurrency, cancellation and cap cleanup between frozen and live execution', async () => {
  const { runner, root, run } = await fixture('exit 0', { maxConcurrent: 1, maxBytes: 8192 });
  expect(runner).toHaveProperty('runResolved', expect.any(Function));
  const controller = new AbortController();
  const pending = runner.runResolved({ projectId: 'p1', check: { name: 'wait', command: 'sleep 10' }, cwd: root, signal: controller.signal });
  const queued = run();
  controller.abort();
  expect(await pending).toMatchObject({ status: 'cancelled' });
  expect(await queued).toMatchObject({ status: 'passed' });
  const oversized = await runner.runResolved({ projectId: 'p1', check: { name: 'large', command: node('for (;;) process.stdout.write("x".repeat(4096))') }, cwd: root });
  expect(oversized.status).toBe('output-limit');
  expect(Buffer.byteLength(oversized.output)).toBeLessThanOrEqual(8192);
  expect(await readdir(root)).toEqual(['settings.json']);
});

it('keeps nonexistent shell failures stable under concurrent frozen execution', async () => {
  const { runner, root } = await fixture('echo hello', { shell: '/no-such-shell', maxConcurrent: 8 });
  expect(runner).toHaveProperty('runResolved', expect.any(Function));
  const results = await Promise.all(Array.from({ length: 8 }, () => runner.runResolved({ projectId: 'p1', check: { name: 'test', command: 'echo hello' }, cwd: root })));
  for (const result of results) expect(result).toMatchObject({ status: 'spawn-error', exitCode: null, output: '' });
  expect(await readdir(root)).toEqual(['settings.json']);
});

it('queues third command behind two active commands without transient failure', async () => {
  const { runner, root } = await fixture('exit 0', { maxConcurrent: 2 });
  const results = await Promise.all(Array.from({ length: 3 }, (_, i) => runner.runResolved({
    projectId: 'p1', check: { name: `test${i}`, command: `sleep 0.05; printf ${i}` }, cwd: root
  })));
  expect(results.map((result) => result.status)).toEqual(['passed', 'passed', 'passed']);
  expect(results.map((result) => result.output)).toEqual(['0', '1', '2']);
  expect(await readdir(root)).toEqual(['settings.json']);
});

it('bounds FIFO waiters, cancels without spawn and excludes waiting from child timeout', async () => {
  // Only deadline clock is virtual; children, capture, and cwd remain real.
  // No child receives a short wall-clock deadline under arbitrary machine load.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const starts: string[] = [];
  const { runner, root } = await fixture('exit 0', {
    maxConcurrent: 1, maxQueued: 2, timeoutMs: 50,
    resolveCwd: async (_id: string, cwd: string) => { starts.push(cwd); if (starts.length === 1) await gate; return root; }
  });
  const submit = (name: string, signal?: AbortSignal) => runner.runResolved({ projectId: 'p1', check: { name, command: `printf ${name}` }, cwd: name, signal });
  const active = submit('active');
  const controller = new AbortController();
  const cancelled = submit('cancelled', controller.signal);
  const waiting = submit('waiting');
  await expect(submit('overflow')).rejects.toThrow('Named-check wait queue full (maxQueued=2)');
  controller.abort();
  expect(await cancelled).toMatchObject({ status: 'cancelled', output: '', exitCode: null });
  const last = submit('last');
  await vi.advanceTimersByTimeAsync(100);
  expect(vi.getTimerCount()).toBe(0);
  expect(starts).toEqual(['active']);
  expect(await readdir(root)).toEqual(['settings.json']);
  release();
  const results = await Promise.all([active, waiting, last]);
  expect(results.map((result) => result.status)).toEqual(['passed', 'passed', 'passed']);
  expect(starts).toEqual(['active', 'waiting', 'last']);
  expect(await readdir(root)).toEqual(['settings.json']);
});

it('arms child deadline only after spawn event, not queued or launch setup time', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const child = new EventEmitter();
  // No pid: this fixture checks launch clock, not process-group termination.
  const spawn = vi.mocked(childProcess.spawn).mockReturnValueOnce(child as childProcess.ChildProcess);
  const { run, root } = await fixture('exit 0', { timeoutMs: 50 });
  const pending = run();
  await vi.waitFor(() => expect(spawn).toHaveReturnedWith(child));
  await vi.advanceTimersByTimeAsync(100);
  expect(vi.getTimerCount()).toBe(0);
  child.emit('spawn');
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(49);
  child.emit('close', 0, null);
  expect(await pending).toMatchObject({ status: 'passed' });
  expect(vi.getTimerCount()).toBe(0);
  expect(await readdir(root)).toEqual(['settings.json']);
});

it('shutdown drains queued waiters without resolving cwd or allocating capture', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let starts = 0;
  const { runner, root, run } = await fixture('exit 0', { maxConcurrent: 1, resolveCwd: async () => { starts++; await gate; return root; } });
  const active = run();
  const waiting = run();
  const controller = new AbortController();
  const waitingWithSignal = run(controller.signal);
  const disposed = runner.dispose();
  expect(await waiting).toMatchObject({ status: 'cancelled' });
  expect(await waitingWithSignal).toMatchObject({ status: 'cancelled' });
  controller.abort();
  expect(starts).toBe(1);
  release();
  expect(await active).toMatchObject({ status: 'cancelled' });
  await disposed;
  expect(await readdir(root)).toEqual(['settings.json']);
  await expect(run()).rejects.toThrow('closed');
});

it('starts queued snapshots after active errors and frees slots for later work', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let starts = 0;
  const { runner, root } = await fixture('exit 0', { maxConcurrent: 1, resolveCwd: async () => {
    if (++starts === 1) { await gate; throw new Error('cwd authorization failed'); }
    return root;
  } });
  const active = runner.runResolved({ projectId: 'p1', check: { name: 'active', command: 'exit 0' }, cwd: root });
  const failed = expect(active).rejects.toThrow('cwd authorization failed');
  const check = { name: 'queued', command: 'printf frozen' };
  const queued = runner.runResolved({ projectId: 'p1', check, cwd: root });
  check.command = 'printf mutated';
  release();
  await failed;
  expect(await queued).toMatchObject({ status: 'passed', output: 'frozen' });
  expect(await runner.runResolved({ projectId: 'p1', check: { name: 'later', command: 'exit 0' }, cwd: root })).toMatchObject({ status: 'passed' });
  expect(await readdir(root)).toEqual(['settings.json']);
});

it('does not signal reaped child PID when deadline precedes pending close callback', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate'] });
  const child = Object.assign(new EventEmitter(), { pid: 123456, exitCode: null as number | null, signalCode: null });
  const spawn = vi.mocked(childProcess.spawn).mockReturnValueOnce(child as unknown as childProcess.ChildProcess);
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' }); });
  const { run, root } = await fixture('exit 0', { timeoutMs: 50 });
  const pending = run();
  await vi.waitFor(() => expect(spawn).toHaveReturnedWith(child));
  child.emit('spawn');
  child.exitCode = 0; // Node has reaped child; close callback still pending.
  await vi.advanceTimersByTimeAsync(75);
  child.emit('exit', 0, null);
  child.emit('close', 0, null);
  expect(await pending).toMatchObject({ status: 'passed', exitCode: 0 });
  expect(kill).not.toHaveBeenCalled();
  expect(await readdir(root)).toEqual(['settings.json']);
});

it('reports genuine live process-group EPERM as failure and cleans capture without unhandled error', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate'] });
  const child = Object.assign(new EventEmitter(), { pid: 123456, exitCode: null, signalCode: null });
  const spawn = vi.mocked(childProcess.spawn).mockReturnValueOnce(child as unknown as childProcess.ChildProcess);
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' }); });
  const { run, root } = await fixture('sleep 10', { timeoutMs: 50 });
  const pending = run();
  await vi.waitFor(() => expect(spawn).toHaveReturnedWith(child));
  child.emit('spawn');
  await vi.advanceTimersByTimeAsync(75);
  expect(await pending).toMatchObject({ status: 'failed', error: 'Named-check process-group termination failed: EPERM' });
  expect(kill).toHaveBeenCalledTimes(1);
  expect(kill).toHaveBeenCalledWith(-123456, 'SIGKILL');
  expect(await readdir(root)).toEqual(['settings.json']);
  child.emit('close', 0, null);
  expect(kill).toHaveBeenCalledTimes(1);
});

it('handles real short-lived child completion after 75ms parent stall with safe cleanup', async () => {
  const { run, root } = await fixture('printf complete', { timeoutMs: 50 });
  const spawn = vi.mocked(childProcess.spawn);
  const before = spawn.mock.calls.length;
  const pending = run();
  await vi.waitFor(() => expect(spawn.mock.calls.length).toBe(before + 1));
  const until = performance.now() + 75;
  while (performance.now() < until) { /* reproduce delayed parent event delivery */ }
  expect(await pending).toMatchObject({ status: 'passed', exitCode: 0, output: 'complete' });
  expect(await readdir(root)).toEqual(['settings.json']);
});

it('treats vanished process group ESRCH as normal timeout cleanup', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate'] });
  const child = Object.assign(new EventEmitter(), { pid: 123456, exitCode: null, signalCode: null });
  const spawn = vi.mocked(childProcess.spawn).mockReturnValueOnce(child as unknown as childProcess.ChildProcess);
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' }); });
  const { run, root } = await fixture('sleep 10', { timeoutMs: 50 });
  const pending = run();
  await vi.waitFor(() => expect(spawn).toHaveReturnedWith(child));
  child.emit('spawn');
  await vi.advanceTimersByTimeAsync(75);
  child.emit('close', null, 'SIGKILL');
  expect(await pending).toMatchObject({ status: 'timeout', exitCode: null });
  expect(kill).toHaveBeenCalledTimes(1);
  expect(await readdir(root)).toEqual(['settings.json']);
});
});
