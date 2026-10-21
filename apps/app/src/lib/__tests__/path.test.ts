import { describe, it, expect } from 'vitest';
import { folderPathPlaceholder, tildify, shortenProjectPath } from '../path.js';

describe('folderPathPlaceholder', () => {
  const WIN = 'C:\\path\\to\\project';
  const POSIX = '/path/to/project';

  it('follows a Windows home dir reported by the daemon', () => {
    expect(folderPathPlaceholder({ homeDir: 'C:\\Users\\me', isPrimary: true }, 'MacIntel')).toBe(WIN);
    expect(folderPathPlaceholder({ homeDir: 'D:/Users/me', isPrimary: false }, 'Linux x86_64')).toBe(WIN);
    expect(folderPathPlaceholder({ homeDir: '\\\\server\\home\\me', isPrimary: false }, '')).toBe(WIN);
  });
  it('follows a POSIX home dir even when the renderer runs on Windows', () => {
    expect(folderPathPlaceholder({ homeDir: '/home/me', isPrimary: false }, 'Win32')).toBe(POSIX);
  });
  it('falls back to the renderer platform for this machine when home is unknown', () => {
    expect(folderPathPlaceholder({ homeDir: null, isPrimary: true }, 'Win32')).toBe(WIN);
    expect(folderPathPlaceholder({ isPrimary: true }, 'MacIntel')).toBe(POSIX);
    expect(folderPathPlaceholder(undefined, 'Win32')).toBe(WIN);
    expect(folderPathPlaceholder(undefined, 'Linux x86_64')).toBe(POSIX);
  });
  it('assumes POSIX for a remote machine with no reported home', () => {
    expect(folderPathPlaceholder({ homeDir: null, isPrimary: false }, 'Win32')).toBe(POSIX);
  });
  it('reads navigator.platform by default', () => {
    expect(folderPathPlaceholder(undefined)).toBe(
      navigator.platform.toUpperCase().startsWith('WIN') ? WIN : POSIX
    );
  });
});

describe('tildify', () => {
  it('replaces a leading home prefix with ~', () => {
    expect(tildify('/Users/me/Documents/foo', '/Users/me')).toBe('~/Documents/foo');
  });
  it('maps the home dir itself to ~', () => {
    expect(tildify('/Users/me', '/Users/me')).toBe('~');
  });
  it('tolerates a trailing slash on home', () => {
    expect(tildify('/Users/me/foo', '/Users/me/')).toBe('~/foo');
  });
  it('leaves a path outside home untouched', () => {
    expect(tildify('/opt/srv/app', '/Users/me')).toBe('/opt/srv/app');
  });
  it('is a no-op when home is unknown', () => {
    expect(tildify('/Users/me/foo', '')).toBe('/Users/me/foo');
    expect(tildify('/Users/me/foo', undefined)).toBe('/Users/me/foo');
  });
});

describe('shortenProjectPath', () => {
  it('keeps the distinguishing tail and tildifies home', () => {
    expect(shortenProjectPath('/Users/me/Documents/work/parrot', '/Users/me')).toBe(
      '~/…/work/parrot'
    );
  });
  it('does not collapse when the tail is short enough', () => {
    expect(shortenProjectPath('/Users/me/parrot', '/Users/me')).toBe('~/parrot');
    expect(shortenProjectPath('/Users/me', '/Users/me')).toBe('~');
  });
  it('preserves the filesystem root anchor when home is unknown', () => {
    expect(shortenProjectPath('/opt/srv/apps/a/b/c', undefined)).toBe('/opt/…/b/c');
  });
  it('respects a custom keepTail', () => {
    expect(shortenProjectPath('/Users/me/Documents/work/parrot', '/Users/me', 1)).toBe(
      '~/…/parrot'
    );
  });
});
