import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
  it('resolves a basename against PATH without mutating process.env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-harness-path-'));
    try {
      const binary = join(dir, 'claude');
      writeFileSync(binary, '#!/bin/sh\n');
      chmodSync(binary, 0o755);
      expect(resolveHarnessCommand('claude', dir)).toBe(binary);
      expect(resolveHarnessCommand('/opt/custom/claude', dir)).toBe(binary);
      expect(resolveHarnessCommand('/opt/missing-bin', dir)).toBe('/opt/missing-bin');
      expect(resolveHarnessCommand('missing-bin', dir)).toBe('missing-bin');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to PATH when a configured absolute binary is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-harness-missing-'));
    try {
      const binary = join(dir, 'claude');
      writeFileSync(binary, '#!/bin/sh\n');
      chmodSync(binary, 0o755);
      expect(resolveHarnessCommand('/opt/claude', dir)).toBe(binary);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
