import { describe, expect, it } from 'vitest';
import {
  MAX_PATH_DEPTH,
  MAX_PATH_LENGTH,
  codeLanguageOf,
  comparePaths,
  extensionOf,
  fileKindOf,
  imageMediaTypeOf,
  isBinaryKind,
  normalizeDocPath
} from './paths.js';

describe('normalizeDocPath', () => {
  it('canonicalises agent-style paths', () => {
    expect(normalizeDocPath(' ./././docs\\Flow v2.md ')).toBe('docs/Flow v2.md');
  });

  it.each([
    [42, /must be a string/],
    ['  ', /required/],
    ['./', /required/],
    ['/etc/passwd', /relative/],
    ['a/../b.md', /"\."/],
    ['a/./b.md', /"\."/],
    ['.env', /invalid path segment/],
    ['a//b.md', /invalid path segment/],
    ['trailing. ', /invalid path segment/],
    ['name.', /invalid path segment/],
    ['x'.repeat(MAX_PATH_LENGTH + 1), /at most 160 characters/],
    [Array.from({ length: MAX_PATH_DEPTH + 1 }, () => 'd').join('/'), /levels deep/]
  ])('rejects %j', (input, message) => {
    expect(() => normalizeDocPath(input)).toThrow(message);
  });
});

describe('file kinds', () => {
  it('classifies by extension', () => {
    expect(extensionOf('a/.hidden')).toBe('');
    expect(extensionOf('Makefile')).toBe('');
    expect(fileKindOf('README.MD')).toBe('markdown');
    expect(fileKindOf('flow.mmd')).toBe('mermaid');
    expect(fileKindOf('mock.html')).toBe('html');
    expect(fileKindOf('logo.svg')).toBe('svg');
    expect(fileKindOf('shot.webp')).toBe('image');
    expect(fileKindOf('api.yaml')).toBe('code');
    expect(fileKindOf('LICENSE')).toBe('text');
    expect(codeLanguageOf('Account.cls')).toBe('apex');
    expect(codeLanguageOf('notes.txt')).toBe('');
    expect(isBinaryKind('image')).toBe(true);
    expect(isBinaryKind('svg')).toBe(false);
    expect(imageMediaTypeOf('a.JPG')).toBe('image/jpeg');
    expect(imageMediaTypeOf('a.svg')).toBeNull();
  });

  it('sorts files before subfolders, naturally', () => {
    const paths = ['b/x.md', 'README.md', 'a/z.md', 'a/b/c.md', 'file10.md', 'file2.md'];
    expect([...paths].sort(comparePaths)).toEqual(['file2.md', 'file10.md', 'README.md', 'a/z.md', 'a/b/c.md', 'b/x.md']);
    expect(comparePaths('a/b', 'a/b')).toBe(0);
  });
});
