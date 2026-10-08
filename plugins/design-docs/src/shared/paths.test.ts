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
  mediaTypeOf,
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
    expect(fileKindOf('fonts/Inter.woff2')).toBe('font');
    expect(fileKindOf('favicon.ico')).toBe('image');
    expect(isBinaryKind('font')).toBe(true);
  });

  it('accepts site-depth paths', () => {
    const deep = 'starting/org-metadata/force-app/main/default/objects/Flight__c/fields/Seat__c.field-meta.xml';
    expect(normalizeDocPath(deep)).toBe(deep);
    expect(MAX_PATH_DEPTH).toBeGreaterThanOrEqual(9);
  });

  it('names a media type for serving each file', () => {
    expect(mediaTypeOf('a.png')).toBe('image/png');
    expect(mediaTypeOf('f/a.woff2')).toBe('font/woff2');
    expect(mediaTypeOf('data.json')).toBe('application/json;charset=utf-8');
    expect(mediaTypeOf('app.mjs')).toBe('text/javascript;charset=utf-8');
    expect(mediaTypeOf('style.css')).toBe('text/css;charset=utf-8');
    expect(mediaTypeOf('runs/final.md')).toBe('text/markdown;charset=utf-8');
    expect(mediaTypeOf('LICENSE')).toBe('text/plain;charset=utf-8');
  });

  it('sorts files before subfolders, naturally', () => {
    const paths = ['b/x.md', 'README.md', 'a/z.md', 'a/b/c.md', 'file10.md', 'file2.md'];
    expect([...paths].sort(comparePaths)).toEqual(['file2.md', 'file10.md', 'README.md', 'a/z.md', 'a/b/c.md', 'b/x.md']);
    expect(comparePaths('a/b', 'a/b')).toBe(0);
  });
});
