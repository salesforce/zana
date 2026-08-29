import { describe, expect, it } from 'vitest';
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
});
