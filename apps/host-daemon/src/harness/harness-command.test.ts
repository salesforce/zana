import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveHarnessCommand } from './harness-command.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function toolDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'harness-command-'));
  dirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, '#!/bin/sh\n');
  chmodSync(file, 0o755);
  return dir;
}

describe('resolveHarnessCommand', () => {
  it('falls back to a PATH lookup by basename for a stale absolute override', () => {
    const dir = toolDir('zana-test-tool');
    expect(resolveHarnessCommand('/gone/elsewhere/zana-test-tool', dir)).toBe(join(dir, 'zana-test-tool'));
    expect(resolveHarnessCommand('C:\\gone\\zana-test-tool', dir)).toBe(join(dir, 'zana-test-tool'));
  });

  it('strips one pair of quotes from a PATH entry', () => {
    const dir = toolDir('zana-test-tool');
    expect(resolveHarnessCommand('zana-test-tool', `"${dir}"`)).toBe(join(dir, 'zana-test-tool'));
  });

  it('is linear on a long path with no separator after the first character', () => {
    const started = performance.now();
    resolveHarnessCommand(`/${'a'.repeat(100_000)}`, '/nonexistent-dir', { home: '/nonexistent-home', uid: 0 });
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
