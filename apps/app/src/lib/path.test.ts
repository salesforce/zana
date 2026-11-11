import { describe, expect, it } from 'vitest';
import { parentPath, relativeUnder } from './path.js';

describe('relativeUnder', () => {
  it('accepts either separator under a Windows root', () => {
    expect(relativeUnder('C:\\repo', 'C:\\repo\\src\\a.ts')).toBe('src/a.ts');
    expect(relativeUnder('C:\\repo', 'C:\\repo/src/a.ts')).toBe('src/a.ts');
    expect(relativeUnder('C:\\repo\\', 'C:\\repo\\a.ts')).toBe('a.ts');
    expect(relativeUnder('\\\\server\\share', '\\\\server\\share\\a.ts')).toBe('a.ts');
  });

  it('matches host keys under a Windows root registered with forward slashes', () => {
    expect(relativeUnder('C:/repo', 'C:\\repo\\src\\a.ts')).toBe('src/a.ts');
    expect(relativeUnder('C:/repo/', 'C:\\repo\\a.ts')).toBe('a.ts');
  });

  it('ignores case in a Windows root prefix and keeps the file name as given', () => {
    expect(relativeUnder('C:\\Repo', 'c:\\repo\\Src\\A.ts')).toBe('Src/A.ts');
    expect(relativeUnder('/Repo', '/repo/a.ts')).toBeNull();
  });

  it('keeps a backslash in a POSIX file name', () => {
    expect(relativeUnder('/repo', '/repo/src/a.ts')).toBe('src/a.ts');
    expect(relativeUnder('/repo/', '/repo/a.ts')).toBe('a.ts');
    expect(relativeUnder('/repo', '/repo/dir/a\\b.ts')).toBe('dir/a\\b.ts');
    expect(relativeUnder('/repo', '/repo\\other/a.ts')).toBeNull();
  });

  it('rejects the root itself, siblings sharing a prefix, and paths outside', () => {
    expect(relativeUnder('/repo', '/repo')).toBeNull();
    expect(relativeUnder('/repo', '/repo/')).toBeNull();
    expect(relativeUnder('C:\\repo', 'C:\\repo-two\\a.ts')).toBeNull();
    expect(relativeUnder('/repo', '/other/a.ts')).toBeNull();
  });
});

describe('parentPath', () => {
  it('splits on either separator under a Windows root', () => {
    expect(parentPath('C:\\repo\\src\\a.ts', 'C:\\repo')).toBe('C:\\repo\\src');
    expect(parentPath('C:\\repo/src/a.ts', 'C:\\repo')).toBe('C:\\repo/src');
  });

  it('splits only on / under a POSIX root', () => {
    expect(parentPath('/repo/a.ts', '/repo')).toBe('/repo');
    expect(parentPath('/repo/dir/a\\b.ts', '/repo')).toBe('/repo/dir');
    expect(parentPath('a.ts', '/repo')).toBe('');
  });
});
