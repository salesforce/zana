import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { reconcileHarnessConfig } from '../ipc/config-harness-refresh.js';

const configIpc = readFileSync(new URL('../ipc/config.ts', import.meta.url), 'utf8');

describe('harness verify cache invalidation', () => {
  it('connects committed config reconciliation to the actual verification cache', () => {
    expect(configIpc).toContain('reconcileHarnessConfig(previous, next, {');
    expect(configIpc).toContain('invalidate: () => { harnessVerifyState.cache = undefined; }');
  });

  it.each([
    'claudeBinary', 'cursorBinary', 'codexBinary', 'piBinary', 'opencodeBinary',
    'grokBinary', 'mastracodeBinary', 'afcodeBinary',
    'harnessCursorEnabled', 'harnessCodexEnabled', 'harnessPiEnabled',
    'harnessOpenCodeEnabled', 'harnessGrokEnabled', 'harnessMastracodeEnabled', 'harnessAfcodeEnabled'
  ] as const)('invalidates when %s is changed or cleared, and retains unchanged config', (key) => {
    const previous = { version: 1, theme: 'dark' } as AppConfig;
    const next = { ...previous, [key]: key.endsWith('Binary') ? '/configured/binary' : true };
    const effects = { invalidate: vi.fn() };
    reconcileHarnessConfig(previous, next, effects);
    expect(effects.invalidate).toHaveBeenCalledTimes(1);
    reconcileHarnessConfig(next, { ...next }, effects);
    expect(effects.invalidate).toHaveBeenCalledTimes(1);
    reconcileHarnessConfig(next, previous, effects);
    expect(effects.invalidate).toHaveBeenCalledTimes(2);
  });
});
