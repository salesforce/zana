import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { isExecutableGitHook } from '../git-hook-mode.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'zcc-hook-mode-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('preserves Windows hook scripts whose filesystem reports no executable bits', () => {
  const path = join(root, 'pre-push');
  writeFileSync(path, '#!/bin/sh\nexit 0\n');
  expect(isExecutableGitHook(path, 0o666, 'win32')).toBe(true);
});

it.each(['', '#', 'plain text'])('does not proxy Windows data files containing %j', (text) => {
  const path = join(root, 'commit-msg');
  writeFileSync(path, text);
  expect(isExecutableGitHook(path, 0o777, 'win32')).toBe(false);
});

it('accepts Windows executables and rejects unreadable script paths', () => {
  const path = join(root, 'hook.exe');
  writeFileSync(path, 'MZ');
  expect(isExecutableGitHook(path, 0o666, 'win32')).toBe(true);
  expect(isExecutableGitHook(join(root, 'missing'), 0o666, 'win32')).toBe(false);
});

it.each(['linux', 'darwin'] as const)('requires executable bits on %s', (platform) => {
  expect(isExecutableGitHook('pre-push', 0o666, platform)).toBe(false);
  for (const permission of [0o100, 0o010, 0o001]) {
    expect(isExecutableGitHook('pre-push', 0o600 | permission, platform)).toBe(true);
  }
});
