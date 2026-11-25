import { describe, expect, it } from 'vitest';
import { LINEAR_TIME_BUDGET_MS } from './__tests__/linear-time.js';
import { BUILTIN_NAV_SENTINEL, derivePluginId, isPluginId } from './plugin-id.js';

describe('derivePluginId', () => {
  it('strips a zcc-plugin- prefix', () => {
    expect(derivePluginId('zcc-plugin-tasks')).toBe('tasks');
  });

  it('uses the unscoped tail of a scoped package', () => {
    expect(derivePluginId('@zana/tasks')).toBe('tasks');
  });

  it('rejects the host chrome sentinel', () => {
    expect(() => derivePluginId(BUILTIN_NAV_SENTINEL)).toThrow(/cannot derive/);
  });

  it('isPluginId rejects the sentinel', () => {
    expect(isPluginId('tasks')).toBe(true);
    expect(isPluginId(BUILTIN_NAV_SENTINEL)).toBe(false);
  });

  it('stays linear on a long run of dashes', () => {
    const started = performance.now();
    expect(derivePluginId(`${'-'.repeat(200_000)}x`)).toBe('x');
    expect(derivePluginId(`x${'-'.repeat(200_000)}y`)).toBe(`x${'-'.repeat(200_000)}y`);
    expect(performance.now() - started).toBeLessThan(LINEAR_TIME_BUDGET_MS);
  });
});
