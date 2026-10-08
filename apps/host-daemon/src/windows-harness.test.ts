import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';

vi.mock('node:path', async (original) => ({ ...await original<typeof import('node:path')>(), delimiter: ';' }));
const platform = process.platform;
Object.defineProperty(process, 'platform', { value: 'win32' });
afterAll(() => { Object.defineProperty(process, 'platform', { value: platform }); vi.unstubAllEnvs(); });

const { augmentPath, fallbackDirs, launchedPathOverrides } = await import('./env.js');
const { resolveHarnessCommand } = await import('./harness/harness-verify.js');

it('preserves Windows drive letters, PATH order and npm global directory', () => {
  vi.stubEnv('APPDATA', 'C:\\Users\\tester\\AppData\\Roaming');
  const original = 'C:\\Windows\\System32;C:\\Program Files\\nodejs';
  const result = augmentPath(original).split(';');
  expect(result.slice(0, 2)).toEqual(original.split(';'));
  expect(result).toContain(join(process.env.APPDATA!, 'npm'));
  expect(fallbackDirs()).not.toContain('/opt/homebrew/bin');
  expect(launchedPathOverrides('C:\\Windows', 'C:\\Tools;C:\\Windows')).toBe('C:\\Tools');
});

it('resolves a cmd shim rather than the extensionless Unix shim', () => {
  const dir = mkdtempSync(join(tmpdir(), 'windows-harness-'));
  vi.stubEnv('PATHEXT', '.EXE;.CMD');
  try {
    writeFileSync(join(dir, 'opencode'), '#!/bin/sh\n', { mode: 0o700 });
    writeFileSync(join(dir, 'opencode.cmd'), '@echo off\r\n', { mode: 0o700 });
    expect(resolveHarnessCommand('opencode', `"${dir}"`)).toBe(join(dir, 'opencode.cmd'));
    expect(resolveHarnessCommand('absent', dir, { uid: 0 })).toBe('absent');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
