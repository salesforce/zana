import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExecSf, runCli, type CliProcessDeps } from '../lib/sf-cli.js';

function fakeChild() {
  return Object.assign(new EventEmitter(), { pid: 42, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
}

function deps(overrides: Partial<CliProcessDeps> = {}) {
  const child = fakeChild();
  const value: CliProcessDeps = {
    spawn: vi.fn(() => child as unknown as ChildProcess),
    platform: 'linux',
    resolveWindowsSf: vi.fn(() => null),
    killTree: vi.fn(),
    ...overrides
  };
  return { child, deps: value };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => vi.useRealTimers());

describe('createExecSf', () => {
  it('launches the resolved install on Windows with its shim env and reports a missing CLI as 127', async () => {
    const launch = {
      command: 'C:\\sf\\client\\bin\\node.exe',
      args: ['--no-deprecation', 'C:\\sf\\client\\bin\\run.js'],
      env: { SF_BINPATH: 'C:\\sf\\bin\\sf.cmd' }
    };
    const { child, deps: d } = deps({ platform: 'win32', resolveWindowsSf: vi.fn(() => launch) });
    const utterance = 'say "hi" & 50%';
    const result = createExecSf(d)(['agent', 'preview', 'send', '--utterance', utterance], { cwd: 'C:\\proj' });
    child.stdout.write('out');
    child.stderr.write('err');
    await tick();
    child.emit('close', 2);
    await expect(result).resolves.toEqual({ code: 2, stdout: 'out', stderr: 'err' });
    expect(d.spawn).toHaveBeenCalledWith(launch.command, [...launch.args, 'agent', 'preview', 'send', '--utterance', utterance], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, SF_BINPATH: 'C:\\sf\\bin\\sf.cmd' },
      cwd: 'C:\\proj'
    });

    const missing = deps({ platform: 'win32' });
    await expect(createExecSf(missing.deps)(['--version'])).resolves.toEqual({ code: 127, stdout: '', stderr: 'Salesforce CLI (sf) was not found on PATH.' });
    expect(missing.deps.spawn).not.toHaveBeenCalled();
  });
});

describe('runCli', () => {
  it('maps spawn errors to exit codes', async () => {
    const cases: Array<[Error, number]> = [
      [Object.assign(new Error('missing'), { code: 'ENOENT' }), 127],
      [Object.assign(new Error('status'), { status: 9 }), 9],
      [Object.assign(new Error('numeric'), { code: 3 }), 3],
      [new Error('plain'), 1]
    ];
    for (const [error, code] of cases) {
      const { child, deps: d } = deps();
      const result = runCli('sf', [], {}, d);
      child.emit('error', error);
      child.emit('close', null);
      await expect(result).resolves.toMatchObject({ code });
    }
  });

  it('treats a close without an exit code as failure and a throwing spawn as its error code', async () => {
    const { child, deps: d } = deps();
    const result = runCli('sf', [], {}, d);
    child.emit('close', null);
    await expect(result).resolves.toMatchObject({ code: 1 });
    const throwing = deps({ spawn: vi.fn(() => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }) });
    await expect(runCli('sf', [], {}, throwing.deps)).resolves.toMatchObject({ code: 127 });
  });

  it('kills the child on timeout and the whole tree on a Windows abort', async () => {
    vi.useFakeTimers();
    const posix = deps();
    const timedOut = runCli('sf', [], { timeoutMs: 50 }, posix.deps);
    vi.advanceTimersByTime(50);
    await expect(timedOut).resolves.toMatchObject({ code: 1 });
    expect(posix.child.kill).toHaveBeenCalledWith('SIGTERM');

    const win = deps({ platform: 'win32' });
    const controller = new AbortController();
    const aborted = runCli('node.exe', [], { signal: controller.signal }, win.deps);
    controller.abort();
    await expect(aborted).resolves.toMatchObject({ code: 1 });
    expect(win.deps.killTree).toHaveBeenCalledTimes(1);
    expect(win.deps.killTree).toHaveBeenCalledWith(42);
  });

  it('does not spawn when the signal is already aborted', async () => {
    const { deps: d } = deps();
    const controller = new AbortController();
    controller.abort();
    await expect(runCli('sf', [], { signal: controller.signal }, d)).resolves.toEqual({ code: 1, stdout: '', stderr: '' });
    expect(d.spawn).not.toHaveBeenCalled();
  });

  it('stops a child whose output exceeds the cap and ignores later output', async () => {
    const { child, deps: d } = deps();
    const result = runCli('sf', [], {}, d);
    child.stdout.write('x'.repeat(2_000_001));
    await tick();
    child.stderr.write('late');
    await tick();
    await expect(result).resolves.toEqual({ code: 1, stdout: '', stderr: '' });
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('runs a real process and passes quotes, ampersands and percents through verbatim', async () => {
    const arg = 'say "hi" & echo PWNED %PATH% 50%';
    const result = await runCli(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', arg]);
    expect(result).toEqual({ code: 0, stdout: JSON.stringify([arg]), stderr: '' });
  });
});
