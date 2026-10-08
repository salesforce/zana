import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
import { runGitClone } from './git-clone-process.js';

function start(onProgress?: (line: string) => void) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn()
  });
  mocks.spawn.mockReturnValueOnce(child);
  const result = runGitClone('https://example.test/private/repo.git', '/tmp/clone/repo', onProgress);
  return { child, result };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Git clone diagnostics', () => {
  it('uses host HOME, resolves Git through PATH, sets the parent cwd, and disables prompts', async () => {
    vi.stubEnv('HOME', '/tmp/isolated-home');
    vi.stubEnv('GIT_DIR', '/outer-repo/.git');
    vi.stubEnv('GIT_TERMINAL_PROMPT', '1');
    const { child, result } = start();
    expect(mocks.spawn).toHaveBeenCalledWith('git',
      ['clone', '--progress', '--', 'https://example.test/private/repo.git', '/tmp/clone/repo'],
      expect.objectContaining({ cwd: '/tmp/clone', stdio: ['ignore', 'pipe', 'pipe'],
        env: expect.objectContaining({ HOME: '/tmp/isolated-home', PATH: process.env.PATH, GIT_TERMINAL_PROMPT: '0' }) }));
    expect(mocks.spawn.mock.calls[0][2].env).not.toHaveProperty('GIT_DIR');
    child.emit('close', 0);
    await expect(result).resolves.toBeUndefined();
  });

  it('preserves repository access errors and keeps stdout and stderr lines separate', async () => {
    const progress = vi.fn();
    const { child, result } = start(progress);
    child.stdout.write('stdout partial');
    child.stderr.write('remote: Repository not found.\r\nfatal: Authentication failed');
    child.emit('close', 128);
    await expect(result).rejects.toThrow('remote: Repository not found.\r\nfatal: Authentication failed');
    expect(progress.mock.calls.map(([line]) => line)).toEqual([
      'remote: Repository not found.', 'stdout partial', 'fatal: Authentication failed'
    ]);
  });

  it('retains errors beyond 8192 bytes while bounding diagnostics and partial progress', async () => {
    const progress = vi.fn();
    const { child, result } = start(progress);
    child.stderr.write('x'.repeat(40_000));
    child.stderr.write('\nfatal: Repository not found.\n');
    child.emit('close', 128);
    const error = await result.catch(error => error);
    expect(error.code).toBe('git_failed');
    expect(error.message.length).toBeLessThanOrEqual(16_384);
    expect(error.message).toContain('fatal: Repository not found.');
    expect(progress.mock.calls.every(([line]) => line.length <= 4096)).toBe(true);
  });

  it('decodes UTF-8 split across buffers and flushes the last stderr line', async () => {
    const { child, result } = start();
    const bytes = Buffer.from('fatal: accès refusé');
    const split = bytes.indexOf(Buffer.from('è')) + 1;
    child.stderr.write(bytes.subarray(0, split));
    child.stderr.write(bytes.subarray(split));
    child.emit('close', 128);
    await expect(result).rejects.toThrow('fatal: accès refusé');
  });

  it('redacts URL passwords and tokens in errors and progress', async () => {
    const progress = vi.fn();
    const { child, result } = start(progress);
    child.stderr.write("fatal: Authentication failed for 'https://user:private-token@example.test/repo/'\n");
    child.emit('close', 128);
    const error = await result.catch(error => error);
    expect(error.message).toContain('https://[redacted]@example.test/repo/');
    expect(error.message).not.toContain('private-token');
    expect(progress).toHaveBeenCalledWith(error.message);
  });

  it('redacts credentials before trimming diagnostics, including passwords containing @', async () => {
    const { child, result } = start();
    const line = "fatal: Authentication failed for 'https://user:private@token@example.test/repo/'\n";
    child.stderr.write(line + 'x'.repeat(16_384 - line.length + line.indexOf('https') + 1));
    child.emit('close', 128);
    const error = await result.catch(error => error);
    expect(error.message).not.toContain('private');
    expect(error.message).not.toContain('token');
    expect(error.message.length).toBeLessThanOrEqual(16_384);
  });

  it('redacts a URL whose credential is split across buffers', async () => {
    const progress = vi.fn();
    const { child, result } = start(progress);
    child.stderr.write('fatal: https://user:private-');
    child.stderr.write('token@example.test/repo/\n');
    child.emit('close', 128);
    const error = await result.catch(error => error);
    expect(error.message).toBe('fatal: https://[redacted]@example.test/repo/');
    expect(progress).toHaveBeenCalledWith(error.message);
  });

  it.each([128, null])('keeps an exit-code fallback when stderr is empty (%s)', async code => {
    const { child, result } = start();
    child.stdout.write('stdout is not an error');
    child.emit('close', code);
    await expect(result).rejects.toThrow(`git clone exited ${code ?? 'null'}`);
  });

  it('reports executable errors and clears its timeout', async () => {
    vi.useFakeTimers();
    const { child, result } = start();
    child.emit('error', new Error('spawn git ENOENT'));
    child.emit('close', -2);
    await expect(result).rejects.toThrow('spawn git ENOENT');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('kills a timed-out clone and ignores later output and close events', async () => {
    vi.useFakeTimers();
    const progress = vi.fn();
    const { child, result } = start(progress);
    const rejection = expect(result).rejects.toThrow('git clone timed out');
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    await rejection;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.stderr.write('late output\n');
    child.emit('close', null);
    expect(progress).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
