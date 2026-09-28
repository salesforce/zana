import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  probeClaudeIdentity,
  resetClaudeIdentityCacheForTests,
  resolveGenuineClaudeFromPath
} from '../claude/binary-identity.js';

const tmpDirs: string[] = [];

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writeFixture(dir: string, name: string, script: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

afterEach(() => {
  resetClaudeIdentityCacheForTests();
  while (tmpDirs.length) {
    rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe('probeClaudeIdentity', () => {
  it('classifies a genuine Claude Code --version banner as genuine', () => {
    const dir = makeDir('claude-genuine-');
    const bin = writeFixture(dir, 'claude', 'echo "2.1.270 (Claude Code)"');
    expect(probeClaudeIdentity(bin)).toBe(true);
  });

  it('classifies an afcode-style banner as not genuine', () => {
    const dir = makeDir('claude-afcode-');
    const bin = writeFixture(dir, 'claude', 'echo "afcode 0.9.2"');
    expect(probeClaudeIdentity(bin)).toBe(false);
  });

  it('classifies a commander-style wrapper (unknown-flag banner) as not genuine', () => {
    const dir = makeDir('claude-wrapper-');
    const bin = writeFixture(dir, 'claude', 'echo "unknown command: --version" >&2; exit 1');
    expect(probeClaudeIdentity(bin)).toBe(false);
  });

  it('never throws for a missing binary', () => {
    expect(probeClaudeIdentity('/nonexistent/claude')).toBe(false);
  });

  it('caches the verdict per path — only probes once', () => {
    const dir = makeDir('claude-cache-');
    const bin = writeFixture(dir, 'claude', 'echo "2.1.270 (Claude Code)"');
    let calls = 0;
    const exec = () => {
      calls++;
      return '2.1.270 (Claude Code)';
    };
    expect(probeClaudeIdentity(bin, exec)).toBe(true);
    expect(probeClaudeIdentity(bin, exec)).toBe(true);
    expect(calls).toBe(1);
  });
});

describe('resolveGenuineClaudeFromPath', () => {
  // These exercise PATH-order candidate discovery (accessSync filtering),
  // not the real --version spawn — that's probeClaudeIdentity's own
  // coverage above. Real subprocess timing under a full, heavily parallel
  // suite run made a spawn-based version of this test flaky (800ms probe
  // timeout contending with dozens of concurrently-spawning test files), so
  // identity is injected here instead.
  it('prefers a later genuine PATH candidate over an earlier shim', () => {
    const shimDir = makeDir('claude-path-shim-');
    const realDir = makeDir('claude-path-real-');
    writeFixture(shimDir, 'claude', 'exit 1');
    const genuine = writeFixture(realDir, 'claude', 'exit 0');

    const pathVar = `${shimDir}:${realDir}`;
    const probe = (bin: string) => bin === genuine;
    expect(resolveGenuineClaudeFromPath('claude', pathVar, probe)).toBe(genuine);
  });

  it('falls back to the caller-supplied fallback unchanged when none probe genuine', () => {
    const shimDir = makeDir('claude-path-allshim-');
    writeFixture(shimDir, 'claude', 'exit 0');

    expect(resolveGenuineClaudeFromPath('claude', shimDir, () => false)).toBe('claude');
  });

  it('falls back unchanged when PATH has no claude candidate at all', () => {
    const emptyDir = makeDir('claude-path-empty-');
    expect(resolveGenuineClaudeFromPath('claude', emptyDir)).toBe('claude');
  });

  it('uses an injected probe instead of spawning', () => {
    const dir = makeDir('claude-path-injected-');
    const bin = writeFixture(dir, 'claude', 'exit 1');
    expect(resolveGenuineClaudeFromPath('claude', dir, () => true)).toBe(bin);
  });

  it('reproduces the reported bug end-to-end: a wrong-binary shim ahead on PATH is skipped via real spawn, the genuine CLI further down is picked', () => {
    const shimDir = makeDir('claude-e2e-shim-');
    const realDir = makeDir('claude-e2e-real-');
    // The exact failure text from the Slack report: a shim that rejects a
    // claude-only flag rather than a --version banner.
    writeFixture(shimDir, 'claude', 'echo "unknown command: --allowedTools" >&2; exit 1');
    const genuine = writeFixture(realDir, 'claude', 'echo "2.1.270 (Claude Code)"');
    const pathVar = `${shimDir}:${realDir}`;

    // Real execFileSync spawn end-to-end (not the fast injected-probe stubs
    // above), with a generous timeout instead of the tight 800ms production
    // default so this stays deterministic under a heavily parallel full
    // suite run rather than racing the production timeout.
    const exec = (command: string, args: readonly string[]) =>
      execFileSync(command, [...args], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore']
      });
    const probe = (bin: string) => probeClaudeIdentity(bin, exec);

    expect(resolveGenuineClaudeFromPath('claude', pathVar, probe)).toBe(genuine);
  });
});
