import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultShellSetting,
  LAST_RESORT_SHELL,
  NoShellFoundError,
  resolveDefaultShell
} from './default-shell.js';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, userInfo: vi.fn(actual.userInfo) };
});

const only = (...present: string[]) => (path: string) => present.includes(path);

describe('resolveDefaultShell', () => {
  afterEach(() => {
    vi.mocked(os.userInfo).mockReset();
  });

  it('uses SHELL when it is executable', () => {
    expect(resolveDefaultShell({
      env: { SHELL: '/usr/local/bin/fish' },
      loginShell: () => '/bin/zsh',
      isExecutable: only('/usr/local/bin/fish', '/bin/zsh', '/bin/bash', '/bin/sh')
    })).toBe('/usr/local/bin/fish');
  });

  it('skips a SHELL that is set but missing and takes the login shell', () => {
    expect(resolveDefaultShell({
      env: { SHELL: '/bin/zsh' },
      loginShell: () => '/usr/bin/fish',
      isExecutable: only('/usr/bin/fish', '/bin/bash', '/bin/sh')
    })).toBe('/usr/bin/fish');
  });

  it('takes the login shell when SHELL is unset (macOS keeps zsh this way)', () => {
    expect(resolveDefaultShell({
      env: {},
      loginShell: () => '/bin/zsh',
      isExecutable: only('/bin/zsh', '/bin/bash', '/bin/sh')
    })).toBe('/bin/zsh');
  });

  it('falls back to /bin/bash when neither SHELL nor the login shell exists', () => {
    expect(resolveDefaultShell({
      env: {},
      loginShell: () => '/bin/zsh',
      isExecutable: only('/bin/bash', '/bin/sh')
    })).toBe('/bin/bash');
  });

  it('falls back to /bin/sh when it is the only shell', () => {
    expect(resolveDefaultShell({
      env: { SHELL: '/bin/zsh' },
      loginShell: () => null,
      isExecutable: only('/bin/sh')
    })).toBe('/bin/sh');
  });

  it('ignores relative and blank candidates', () => {
    const isExecutable = vi.fn(only('zsh', '/bin/sh'));
    expect(resolveDefaultShell({ env: { SHELL: 'zsh' }, loginShell: () => '  ', isExecutable })).toBe('/bin/sh');
    expect(isExecutable).not.toHaveBeenCalledWith('zsh');
  });

  it('throws a clear error naming every path tried, once each', () => {
    let error: unknown;
    try {
      resolveDefaultShell({ env: { SHELL: '/bin/bash' }, loginShell: () => '/bin/zsh', isExecutable: () => false });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(NoShellFoundError);
    expect((error as NoShellFoundError).tried).toEqual(['/bin/bash', '/bin/zsh', '/bin/sh']);
    expect((error as Error).message).toBe(
      'No usable shell found. Tried /bin/bash, /bin/zsh, /bin/sh. Set SHELL to an installed shell, or set the terminal shell in Settings.'
    );
  });

  it('reads the login shell from os.userInfo() by default', () => {
    vi.mocked(os.userInfo).mockReturnValue({ shell: '/opt/shells/ksh' } as os.UserInfo<string>);
    expect(resolveDefaultShell({ env: {}, isExecutable: only('/opt/shells/ksh', '/bin/sh') })).toBe('/opt/shells/ksh');
  });

  it('moves on when os.userInfo() throws (no passwd entry)', () => {
    vi.mocked(os.userInfo).mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory, uv_os_get_passwd');
    });
    expect(resolveDefaultShell({ env: {}, isExecutable: only('/bin/sh') })).toBe('/bin/sh');
  });

  it.skipIf(process.platform === 'win32')('checks the real filesystem by default: executable files only', () => {
    const dir = mkdtempSync(join(os.tmpdir(), 'zcc-default-shell-'));
    try {
      const plain = join(dir, 'not-executable');
      const runnable = join(dir, 'runnable');
      writeFileSync(plain, '#!/bin/sh\n', { mode: 0o600 });
      writeFileSync(runnable, '#!/bin/sh\n', { mode: 0o700 });
      expect(resolveDefaultShell({ env: { SHELL: plain }, loginShell: () => dir })).not.toBe(plain);
      expect(resolveDefaultShell({ env: { SHELL: dir }, loginShell: () => runnable })).toBe(runnable);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('defaultShellSetting', () => {
  it('returns the Windows value unchanged on win32 without probing', () => {
    const isExecutable = vi.fn(() => true);
    expect(defaultShellSetting({ platform: 'win32', windows: 'C:\\Git\\bin\\bash.exe', env: { SHELL: '/bin/bash' }, isExecutable }))
      .toBe('C:\\Git\\bin\\bash.exe');
    expect(isExecutable).not.toHaveBeenCalled();
  });

  it('resolves the first existing shell elsewhere', () => {
    expect(defaultShellSetting({ platform: 'linux', windows: '/bin/zsh', env: {}, loginShell: () => null, isExecutable: only('/bin/bash') }))
      .toBe('/bin/bash');
  });

  it('logs the error and returns /bin/sh when no shell exists', () => {
    const warn = vi.fn();
    expect(defaultShellSetting({ platform: 'linux', windows: '/bin/zsh', env: {}, loginShell: () => null, isExecutable: () => false, warn }))
      .toBe(LAST_RESORT_SHELL);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[shell] No usable shell found. Tried /bin/bash, /bin/sh.'));
  });

  it('logs with console.error by default', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(defaultShellSetting({ platform: 'darwin', windows: '/bin/zsh', env: {}, loginShell: () => null, isExecutable: () => false }))
        .toBe('/bin/sh');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('No usable shell found'));
    } finally {
      error.mockRestore();
    }
  });

  it('defaults the platform to process.platform', () => {
    const isExecutable = vi.fn(only('/bin/sh'));
    const result = defaultShellSetting({ windows: 'WINDOWS', env: {}, loginShell: () => null, isExecutable });
    expect(result).toBe(process.platform === 'win32' ? 'WINDOWS' : '/bin/sh');
  });
});
