import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  harnessEnabledFromProbe,
  normalizeHarnessVersion,
  resolveHarnessCommand,
  verifiableHarnessVersion
} from '../harness-verify.js';

describe('harnessEnabledFromProbe', () => {
  it('keeps always-on families available regardless of install or config', () => {
    expect(harnessEnabledFromProbe({ alwaysEnabled: true, installed: false })).toBe(true);
    expect(harnessEnabledFromProbe({ alwaysEnabled: true, configEnabled: false, installed: true })).toBe(true);
  });

  it('auto-activates an installed CLI when the enable flag is unset', () => {
    expect(harnessEnabledFromProbe({ installed: true })).toBe(true);
    expect(harnessEnabledFromProbe({ configEnabled: undefined, installed: true })).toBe(true);
  });

  it('does not advertise a missing CLI until the operator opts in', () => {
    expect(harnessEnabledFromProbe({ installed: false })).toBe(false);
    expect(harnessEnabledFromProbe({ configEnabled: true, installed: false })).toBe(true);
  });

  it('respects an explicit hide even when the CLI is present', () => {
    expect(harnessEnabledFromProbe({ configEnabled: false, installed: true })).toBe(false);
  });
});

describe('normalizeHarnessVersion', () => {
  it('extracts the numeric CLI version from a Claude Code banner', () => {
    expect(normalizeHarnessVersion('2.1.270 (Claude Code)')).toBe('2.1.270');
  });
});

describe('resolveHarnessCommand', () => {
  const tmpDirs: string[] = [];

  function makeDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  }

  function writeExecutable(path: string): string {
    writeFileSync(path, '#!/bin/sh\n');
    chmodSync(path, 0o755);
    return path;
  }

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('resolves a basename against PATH without mutating process.env', () => {
    const dir = makeDir('zcc-harness-path-');
    const binary = writeExecutable(join(dir, 'claude'));
    expect(resolveHarnessCommand('claude', dir)).toBe(binary);
    expect(resolveHarnessCommand('/opt/custom/claude', dir)).toBe(binary);
    expect(resolveHarnessCommand('/opt/missing-bin', dir)).toBe('/opt/missing-bin');
    expect(resolveHarnessCommand('missing-bin', dir)).toBe('missing-bin');
  });

  it('falls back to PATH when a configured absolute binary is missing', () => {
    const dir = makeDir('zcc-harness-missing-');
    const binary = writeExecutable(join(dir, 'claude'));
    expect(resolveHarnessCommand('/opt/claude', dir)).toBe(binary);
  });

  it('keeps an existing executable absolute override', () => {
    const configured = writeExecutable(join(makeDir('zcc-harness-abs-'), 'claude'));
    const otherDir = makeDir('zcc-harness-abs-path-');
    writeExecutable(join(otherDir, 'claude'));
    expect(resolveHarnessCommand(configured, otherDir)).toBe(configured);
  });

  it('prefers PATH over a well-known native install', () => {
    const pathDir = makeDir('zcc-harness-path-win-');
    const home = makeDir('zcc-harness-home-');
    const pathHit = writeExecutable(join(pathDir, 'zcc-harness-wk'));
    mkdirSync(join(home, '.zcc-harness-wk', 'local'), { recursive: true });
    writeExecutable(join(home, '.zcc-harness-wk', 'local', 'zcc-harness-wk'));
    expect(resolveHarnessCommand('zcc-harness-wk', pathDir, { home })).toBe(pathHit);
  });

  it('falls back to ~/.<cmd>/local/<cmd> when PATH has no executable', () => {
    const home = makeDir('zcc-harness-native-');
    mkdirSync(join(home, '.zcc-harness-wk', 'local'), { recursive: true });
    const native = writeExecutable(join(home, '.zcc-harness-wk', 'local', 'zcc-harness-wk'));
    expect(
      resolveHarnessCommand('zcc-harness-wk', '/nonexistent-zcc-harness-path', { home })
    ).toBe(native);
  });

  it('skips a non-executable PATH entry', () => {
    const dir = makeDir('zcc-harness-noexec-');
    const blocked = join(dir, 'zcc-harness-noexec');
    writeFileSync(blocked, '#!/bin/sh\n');
    chmodSync(blocked, 0o644);
    expect(
      resolveHarnessCommand('zcc-harness-noexec', dir, { home: makeDir('zcc-harness-noexec-home-') })
    ).toBe('zcc-harness-noexec');
  });

  it('falls back to PATH when an absolute override exists but is not executable', () => {
    const pathDir = makeDir('zcc-harness-stale-exec-');
    const pathHit = writeExecutable(join(pathDir, 'zcc-harness-stale'));
    const stale = join(makeDir('zcc-harness-stale-abs-'), 'zcc-harness-stale');
    writeFileSync(stale, '#!/bin/sh\n');
    chmodSync(stale, 0o644);
    expect(resolveHarnessCommand(stale, pathDir)).toBe(pathHit);
  });

  it('does not use well-known locations when uid is 0', () => {
    const home = makeDir('zcc-harness-root-');
    mkdirSync(join(home, '.zcc-harness-wk', 'local'), { recursive: true });
    writeExecutable(join(home, '.zcc-harness-wk', 'local', 'zcc-harness-wk'));
    expect(
      resolveHarnessCommand('zcc-harness-wk', '/nonexistent-zcc-harness-path', { home, uid: 0 })
    ).toBe('zcc-harness-wk');
  });

  it('finds an npm-global CLI next to the real node behind a ~/.<tool>/bin/node shim', () => {
    const home = makeDir('zcc-harness-npm-prefix-');
    const prefixBin = join(home, 'prefix', 'bin');
    const shimBin = join(home, '.tool', 'bin');
    mkdirSync(prefixBin, { recursive: true });
    mkdirSync(shimBin, { recursive: true });
    writeExecutable(join(prefixBin, 'node'));
    writeExecutable(join(prefixBin, 'mastracode'));
    symlinkSync(join(prefixBin, 'node'), join(shimBin, 'node'));
    expect(
      resolveHarnessCommand('mastracode', '/nonexistent-zcc-harness-path', { home })
    ).toBe(join(realpathSync(prefixBin), 'mastracode'));
  });
});

describe('verifiableHarnessVersion', () => {
  it('prefers the parsed version and still treats an installed CLI as present', () => {
    expect(verifiableHarnessVersion({
      installed: true,
      normalizedVersion: '2.1.270',
      version: '2.1.270 (Claude Code)'
    })).toBe('2.1.270');
    expect(verifiableHarnessVersion({
      installed: true,
      version: '2.1.270 (Claude Code)'
    })).toBe('2.1.270');
    expect(verifiableHarnessVersion({
      installed: true,
      version: 'dev-build'
    })).toBe('dev-build');
    expect(verifiableHarnessVersion({ installed: false, version: '1.0.0' })).toBeUndefined();
  });
});
