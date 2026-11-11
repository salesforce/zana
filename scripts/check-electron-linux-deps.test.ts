import { describe, expect, it, vi } from 'vitest';
import { checkElectronLinuxDeps } from './check-electron-linux-deps.mjs';

function fixture() {
  return {
    platform: 'linux',
    electronPath: vi.fn(() => '/build with spaces/node_modules/electron/dist/electron'),
    execute: vi.fn(() => ({ status: 0, stdout: 'libnss3.so => /lib/libnss3.so (0x1)\n', stderr: '' })),
    log: vi.fn(),
    error: vi.fn(),
  };
}

describe('Linux Electron dependency preflight', () => {
  it('checks the installed binary and Xvfb without starting an app or package manager', () => {
    const io = fixture();
    expect(checkElectronLinuxDeps(io)).toBe(0);
    expect(io.execute.mock.calls).toEqual([
      ['xvfb-run', ['--help'], { encoding: 'utf8', timeout: 15_000, maxBuffer: 65536 }],
      ['ldd', ['/build with spaces/node_modules/electron/dist/electron'], { encoding: 'utf8', timeout: 15_000, maxBuffer: 65536 }],
    ]);
    expect(io.log).toHaveBeenCalledOnce();
    expect(io.error).not.toHaveBeenCalled();
  });

  it('resolves the installed Electron package without launching it', () => {
    const { electronPath: _electronPath, ...io } = fixture();
    expect(checkElectronLinuxDeps(io)).toBe(0);
    expect(io.execute.mock.calls[1]).toEqual([
      'ldd', [expect.stringMatching(/electron/)],
      { encoding: 'utf8', timeout: 15_000, maxBuffer: 65536 },
    ]);
  });

  it('refuses a different OS without executing native commands', () => {
    const io = { ...fixture(), platform: 'darwin' };
    expect(checkElectronLinuxDeps(io)).toBe(1);
    expect(io.execute).not.toHaveBeenCalled();
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining('requires Linux'));
  });

  it.each([undefined, 1, '', ' '])('rejects an invalid Electron path: %s', (path) => {
    const io = { ...fixture(), electronPath: () => path };
    expect(checkElectronLinuxDeps(io)).toBe(1);
    expect(io.execute).not.toHaveBeenCalled();
  });

  it('reports a missing Electron installation', () => {
    const io = { ...fixture(), electronPath: () => { throw new Error('Cannot find module electron'); } };
    expect(checkElectronLinuxDeps(io)).toBe(1);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining('Cannot find module electron'));
  });

  it.each(['xvfb-run', 'ldd'])('fails closed when %s is unavailable or times out', (command) => {
    const io = fixture();
    io.execute.mockImplementation((name) => name === command
      ? { status: null, error: new Error('spawn timeout'), stdout: '', stderr: '' }
      : { status: 0, stdout: '', stderr: '' });
    expect(checkElectronLinuxDeps(io)).toBe(1);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining(`${command} failed: spawn timeout`));
  });

  it('reports native command errors and stops before the next check', () => {
    const io = fixture();
    io.execute.mockReturnValue({ status: 1, stdout: '', stderr: 'not an executable' });
    expect(checkElectronLinuxDeps(io)).toBe(1);
    expect(io.execute).toHaveBeenCalledTimes(1);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining('not an executable'));
  });

  it('reports a failed command with no diagnostic output', () => {
    const io = fixture();
    io.execute.mockReturnValue({ status: 2, stdout: '', stderr: '' });
    expect(checkElectronLinuxDeps(io)).toBe(1);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining('exit 2'));
  });

  it.each(['', '  ', undefined])('rejects empty library information: %s', (stdout) => {
    const io = fixture();
    io.execute.mockReturnValue({ status: 0, stdout, stderr: '' });
    expect(checkElectronLinuxDeps(io)).toBe(1);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining('no Electron library information'));
  });

  it('rejects missing shared libraries even when ldd exits successfully', () => {
    const io = fixture();
    io.execute.mockReturnValue({ status: 0, stdout: 'libnss3.so => not found\n', stderr: '' });
    expect(checkElectronLinuxDeps(io)).toBe(1);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining('libnss3.so => not found'));
  });
});
