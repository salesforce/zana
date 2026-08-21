import { describe, expect, it } from 'vitest';
import { isWithin, resolveContained } from './index.js';

describe('path-confine', () => {
  it('accepts a nested absolute child and rejects escape / relative paths', () => {
    expect(isWithin('/repo/ext/file.ts', '/repo/ext')).toBe(true);
    expect(isWithin('/repo/ext', '/repo/ext')).toBe(true);
    expect(isWithin('/repo/other/file.ts', '/repo/ext')).toBe(false);
    expect(isWithin('relative/file.ts', '/repo/ext')).toBe(false);
  });

  it('resolves an entry only when it stays inside dir', () => {
    expect(resolveContained('/repo/ext', 'dist/renderer.js')).toBe('/repo/ext/dist/renderer.js');
    expect(resolveContained('/repo/ext', '../../evil.js')).toBeNull();
  });
});
