import { describe, expect, it } from 'vitest';
import { normalizeThreadProviderDefault, resolveThreadProviderDefault } from './launch-provider.js';

describe('thread defaults', () => {
  it('uses the project override or inherits the global provider', () => {
    expect(resolveThreadProviderDefault('plugin/custom', 'codex')).toEqual({ providerId: 'plugin/custom', source: 'project' });
    expect(resolveThreadProviderDefault(null, 'codex')).toEqual({ providerId: 'codex', source: 'global' });
    expect(resolveThreadProviderDefault(undefined, undefined)).toEqual({ providerId: null, source: 'global' });
  });
  it('accepts bounded opaque registration keys and explicit inheritance', () => {
    expect(normalizeThreadProviderDefault(' custom-provider ')).toBe('custom-provider');
    expect(normalizeThreadProviderDefault(null)).toBeNull();
    expect(normalizeThreadProviderDefault('a'.repeat(256))).toHaveLength(256);
  });
  it.each([undefined, 1, {}, [], '', '   ', 'a'.repeat(257), 'bad\nkey', 'bad\u0000key', 'bad\u007fkey'])('rejects malformed ids (%j)', value => {
    expect(normalizeThreadProviderDefault(value)).toBeUndefined();
  });
});
