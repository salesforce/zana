import { describe, expect, it } from 'vitest';
import { resolveShellLoadPath, shellPathFromUrl } from './shell-path';

const serverUrl = 'https://mac.example';

describe('resolveShellLoadPath', () => {
  it('reloads where the user is, not where the shell first opened', () => {
    expect(
      resolveShellLoadPath({ visitedPath: '/threads/new', requestedPath: '/threads/notified' })
    ).toBe('/threads/new');
  });
  it('opens a requested thread before the page reports where it is', () => {
    expect(resolveShellLoadPath({ visitedPath: null, requestedPath: '/threads/notified' })).toBe(
      '/threads/notified'
    );
  });
  it('opens the new-thread page on a cold start', () => {
    expect(resolveShellLoadPath({ visitedPath: null, requestedPath: undefined })).toBe('/');
    expect(resolveShellLoadPath({ visitedPath: null, requestedPath: '' })).toBe('/');
  });
});

describe('shellPathFromUrl', () => {
  it('remembers the confined path of a same-server navigation', () => {
    expect(shellPathFromUrl('https://mac.example/threads/t1?tab=diff', serverUrl)).toBe(
      '/threads/t1?tab=diff'
    );
    expect(shellPathFromUrl('https://mac.example', serverUrl)).toBe('/');
    expect(shellPathFromUrl('https://mac.example/', serverUrl)).toBe('/');
  });
  it('refuses to remember another server or a blocked route', () => {
    expect(shellPathFromUrl('https://evil.example/threads/t1', serverUrl)).toBeNull();
    expect(shellPathFromUrl('https://u:p@mac.example/threads/t1', serverUrl)).toBeNull();
    expect(shellPathFromUrl('not a url', serverUrl)).toBeNull();
    // Same-server but blocked path collapses to the safe root rather than leaking through.
    expect(shellPathFromUrl('https://mac.example/api/v1/threads', serverUrl)).toBe('/');
  });
});
