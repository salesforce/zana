import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { guardTestFiles, verifyFast } from './verify-fast.mjs';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zcc-verify-fast-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  mkdirSync(join(root, 'source folder'));
  writeFileSync(join(root, 'tracked.guard.test.ts'), '');
  execFileSync('git', ['add', '.'], { cwd: root });
  writeFileSync(join(root, 'source folder', 'untracked.guard.test.ts'), '');
  writeFileSync(join(root, 'ordinary.test.ts'), '');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('collects tracked and untracked guards without a shell or fd dependency', () => {
  expect(guardTestFiles(root)).toEqual(['source folder/untracked.guard.test.ts', 'tracked.guard.test.ts']);
});

it('runs typecheck, changed tests and guards with literal argument boundaries', () => {
  const run = vi.fn().mockReturnValue({ status: 0 });
  expect(verifyFast({ root, run })).toBe(0);
  expect(run.mock.calls.map((call) => call.slice(0, 2))).toEqual([
    ['pnpm', ['run', 'typecheck']],
    ['pnpm', ['exec', 'vitest', 'run', '--changed', 'origin/main']],
    ['pnpm', ['exec', 'vitest', 'run', 'source folder/untracked.guard.test.ts', 'tracked.guard.test.ts']]
  ]);
});

it.each([0, 1, 2])('stops after failed check %s', (failed) => {
  let call = 0;
  const run = vi.fn(() => ({ status: call++ === failed ? 7 : 0 }));
  expect(verifyFast({ root, run })).toBe(7);
  expect(run).toHaveBeenCalledTimes(failed + 1);
});

it('fails closed when a check cannot start', () => {
  expect(verifyFast({ root, run: vi.fn().mockReturnValue({ status: null }) })).toBe(1);
});

it('does not run the entire suite when a repository contains no guard tests', () => {
  rmSync(join(root, 'tracked.guard.test.ts'));
  rmSync(join(root, 'source folder', 'untracked.guard.test.ts'));
  const run = vi.fn().mockReturnValue({ status: 0 });
  expect(verifyFast({ root, run })).toBe(0);
  expect(run).toHaveBeenCalledTimes(2);
});
