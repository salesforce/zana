import { describe, expect, it } from 'vitest';
import { parentPath, relativeUnder } from './path.js';

describe('relativeUnder', () => {
  it('accepts either separator after a Windows or POSIX root', () => {
    expect(relativeUnder('C:\\repo', 'C:\\repo\\src\\a.ts')).toBe('src/a.ts');
    expect(relativeUnder('C:\\repo', 'C:\\repo/src/a.ts')).toBe('src/a.ts');
    expect(relativeUnder('C:\\repo\\', 'C:\\repo\\a.ts')).toBe('a.ts');
    expect(relativeUnder('/repo', '/repo/src/a.ts')).toBe('src/a.ts');
    expect(relativeUnder('/repo/', '/repo/a.ts')).toBe('a.ts');
  });

  it('rejects the root itself, siblings sharing a prefix, and paths outside', () => {
    expect(relativeUnder('/repo', '/repo')).toBeNull();
    expect(relativeUnder('/repo', '/repo/')).toBeNull();
    expect(relativeUnder('C:\\repo', 'C:\\repo-two\\a.ts')).toBeNull();
    expect(relativeUnder('/repo', '/other/a.ts')).toBeNull();
  });
});

describe('parentPath', () => {
  it('splits on the last separator of either kind', () => {
    expect(parentPath('C:\\repo\\src\\a.ts')).toBe('C:\\repo\\src');
    expect(parentPath('C:\\repo/src/a.ts')).toBe('C:\\repo/src');
    expect(parentPath('/repo/a.ts')).toBe('/repo');
    expect(parentPath('a.ts')).toBe('');
  });
});
