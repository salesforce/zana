import { describe, it, expect } from 'vitest';
import { computeMaxLiveSessions, resolveMaxLiveSessions, applyHeapCeiling } from '../pty.js';
import { SESSION_MEMORY_DEFAULTS } from '@zana-ai/zcc-domain/product';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

const GB = 1024 * 1024 * 1024;

function config(patch: Partial<AppConfig> = {}): AppConfig {
  return {
    version: 1,
    theme: 'dark',
    shell: '/bin/zsh',
    claudeBinary: 'claude',
    fontSize: 13,
    lastProjectId: null,
    ...patch
  };
}

describe('computeMaxLiveSessions (memory-aware cap)', () => {
  it('scales the cap down on small-RAM machines', () => {
    // 8GB: half (4GB) / 1GB-per-session = 4.
    expect(computeMaxLiveSessions(8 * GB)).toBe(4);
    // 16GB: half (8GB) / 1GB = 8.
    expect(computeMaxLiveSessions(16 * GB)).toBe(8);
    // 64GB: half (32GB) / 1GB = 32 → clamped to the roomy-box default.
    expect(computeMaxLiveSessions(64 * GB)).toBe(SESSION_MEMORY_DEFAULTS.defaultLiveSessions);
  });

  it('never falls below the floor or exceeds the roomy-box default', () => {
    expect(computeMaxLiveSessions(1 * GB)).toBe(SESSION_MEMORY_DEFAULTS.minLiveSessions);
    // A huge box derives far more, but the default is clamped to defaultLiveSessions;
    // going above that requires an explicit operator override (resolveMaxLiveSessions).
    expect(computeMaxLiveSessions(1024 * GB)).toBe(SESSION_MEMORY_DEFAULTS.defaultLiveSessions);
  });
});

describe('resolveMaxLiveSessions (config override)', () => {
  it('uses the memory-aware default when no override is set', () => {
    expect(resolveMaxLiveSessions(config())).toBe(resolveMaxLiveSessions(config({})));
    expect(resolveMaxLiveSessions(undefined)).toBeGreaterThanOrEqual(
      SESSION_MEMORY_DEFAULTS.minLiveSessions
    );
  });

  it('honors an explicit override', () => {
    expect(resolveMaxLiveSessions(config({ maxLiveSessions: 6 }))).toBe(6);
  });

  it('lets an explicit override exceed the roomy-box default, up to the fd ceiling', () => {
    // 40 is above defaultLiveSessions (30) but under the ceiling (50) — allowed.
    expect(resolveMaxLiveSessions(config({ maxLiveSessions: 40 }))).toBe(40);
  });

  it('clamps an out-of-band override to the safe band', () => {
    expect(resolveMaxLiveSessions(config({ maxLiveSessions: 9999 }))).toBe(
      SESSION_MEMORY_DEFAULTS.maxLiveSessionsCeiling
    );
    // 0 / negative is treated as "unset" → falls back to the derived default.
    expect(resolveMaxLiveSessions(config({ maxLiveSessions: 0 }))).toBeGreaterThanOrEqual(
      SESSION_MEMORY_DEFAULTS.minLiveSessions
    );
  });
});

describe('applyHeapCeiling (per-session NODE_OPTIONS)', () => {
  it('injects --max-old-space-size for claude profiles', () => {
    const env: Record<string, string> = {};
    applyHeapCeiling(env, true, config());
    expect(env.NODE_OPTIONS).toBe(
      `--max-old-space-size=${SESSION_MEMORY_DEFAULTS.claudeMaxOldSpaceMB}`
    );
  });

  it('uses the configured ceiling when set', () => {
    const env: Record<string, string> = {};
    applyHeapCeiling(env, true, config({ claudeMaxOldSpaceMB: 2048 }));
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size=2048');
  });

  it('is a no-op for non-claude profiles', () => {
    const env: Record<string, string> = {};
    applyHeapCeiling(env, false, config());
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it('is a no-op when the ceiling is disabled (0)', () => {
    const env: Record<string, string> = {};
    applyHeapCeiling(env, true, config({ claudeMaxOldSpaceMB: 0 }));
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it('appends to existing NODE_OPTIONS, preserving other flags', () => {
    const env: Record<string, string> = { NODE_OPTIONS: '--enable-source-maps' };
    applyHeapCeiling(env, true, config({ claudeMaxOldSpaceMB: 4096 }));
    expect(env.NODE_OPTIONS).toBe('--enable-source-maps --max-old-space-size=4096');
  });

  it('respects an existing --max-old-space-size (operator choice wins)', () => {
    const env: Record<string, string> = { NODE_OPTIONS: '--max-old-space-size=8192' };
    applyHeapCeiling(env, true, config({ claudeMaxOldSpaceMB: 4096 }));
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size=8192');
  });
});
