import { describe, expect, it } from 'vitest';
import { parseHostUpdate, sanitizeDefaultWorkspacePath } from './host-public.js';

describe('sanitizeDefaultWorkspacePath', () => {
  it('clears blank values and requires an absolute POSIX path', () => {
    expect(sanitizeDefaultWorkspacePath('')).toBeNull();
    expect(sanitizeDefaultWorkspacePath('   ')).toBeNull();
    expect(sanitizeDefaultWorkspacePath(null)).toBeNull();
    expect(sanitizeDefaultWorkspacePath('/opt/workspace/core')).toBe('/opt/workspace/core');
    expect(sanitizeDefaultWorkspacePath('  /home/sfwork/core  ')).toBe('/home/sfwork/core');
    expect(() => sanitizeDefaultWorkspacePath('opt/workspace')).toThrow(/absolute/);
    expect(() => sanitizeDefaultWorkspacePath('/x\n/y')).toThrow(/control/);
    expect(() => sanitizeDefaultWorkspacePath(`/${'a'.repeat(256)}`)).toThrow(/too long/);
  });
});

describe('parseHostUpdate', () => {
  it('accepts rename, path, or both and rejects an empty body', () => {
    expect(parseHostUpdate({ name: 'Studio' })).toEqual({ name: 'Studio' });
    expect(parseHostUpdate({ defaultWorkspacePath: '/opt/core' })).toEqual({
      defaultWorkspacePath: '/opt/core'
    });
    expect(parseHostUpdate({ defaultWorkspacePath: '' })).toEqual({
      defaultWorkspacePath: null
    });
    expect(parseHostUpdate({ defaultWorkspacePath: null })).toEqual({
      defaultWorkspacePath: null
    });
    expect(parseHostUpdate({ name: 'Studio', defaultWorkspacePath: '/opt/core' })).toEqual({
      name: 'Studio',
      defaultWorkspacePath: '/opt/core'
    });
    expect(parseHostUpdate({})).toBeNull();
    expect(parseHostUpdate({ name: 'Studio', extra: true })).toBeNull();
    expect(parseHostUpdate({ defaultWorkspacePath: 'relative' })).toBeNull();
  });
});
