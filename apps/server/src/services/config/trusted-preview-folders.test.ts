import { describe, expect, it } from 'vitest';
import {
  TRUSTED_PREVIEW_FOLDERS_MAX,
  TRUSTED_PREVIEW_FOLDER_MAX_PATH,
  TrustedPreviewFolderError,
  addTrustedPreviewFolder,
  canonicalTrustedPreviewFolder,
  normalizeTrustedPreviewFolders,
  removeTrustedPreviewFolder,
  sanitizeStoredTrustedPreviewFolders
} from './trusted-preview-folders.js';

const many = (n: number) => Array.from({ length: n }, (_, i) => `/trusted/f${i}`);

describe('canonicalTrustedPreviewFolder', () => {
  it('normalizes absolute paths and strips a trailing slash', () => {
    expect(canonicalTrustedPreviewFolder('/a/b/../c/')).toBe('/a/c');
    expect(canonicalTrustedPreviewFolder('/a//b')).toBe('/a/b');
  });
  it.each([
    ['non-string', 42], ['empty', ''], ['relative', 'a/b'], ['home', '~/x'], ['var', '/a/$HOME'],
    ['backtick', '/a/`id`'], ['nul', '/a\0b'], ['root', '/'], ['root via dots', '/a/..'],
    ['too long', `/${'a'.repeat(TRUSTED_PREVIEW_FOLDER_MAX_PATH)}`]
  ])('rejects %s', (_name, value) => {
    expect(canonicalTrustedPreviewFolder(value)).toBeNull();
  });
});

describe('normalizeTrustedPreviewFolders (strict)', () => {
  it('treats null/undefined as empty and dedupes', () => {
    expect(normalizeTrustedPreviewFolders(undefined)).toEqual([]);
    expect(normalizeTrustedPreviewFolders(null)).toEqual([]);
    expect(normalizeTrustedPreviewFolders(['/a', '/a/', '/b'])).toEqual(['/a', '/b']);
  });
  it('throws invalid-path for non-arrays and bad entries', () => {
    expect(() => normalizeTrustedPreviewFolders('/a')).toThrow(TrustedPreviewFolderError);
    expect(() => normalizeTrustedPreviewFolders(['/a', 'rel'])).toThrow(/canonical absolute/);
  });
  it('throws too-many over the cap and accepts exactly the cap', () => {
    expect(normalizeTrustedPreviewFolders(many(TRUSTED_PREVIEW_FOLDERS_MAX))).toHaveLength(TRUSTED_PREVIEW_FOLDERS_MAX);
    try {
      normalizeTrustedPreviewFolders(many(TRUSTED_PREVIEW_FOLDERS_MAX + 1));
      expect.unreachable();
    } catch (error) {
      expect((error as TrustedPreviewFolderError).code).toBe('too-many');
      expect((error as Error).message).toMatch(/At most 20/);
    }
  });
});

describe('sanitizeStoredTrustedPreviewFolders (lenient)', () => {
  it('returns empty for non-arrays and drops invalid/duplicate entries', () => {
    expect(sanitizeStoredTrustedPreviewFolders('x')).toEqual([]);
    expect(sanitizeStoredTrustedPreviewFolders(['/a', 7, 'rel', '/a/', '/'])).toEqual(['/a']);
  });
  it('truncates at the cap', () => {
    expect(sanitizeStoredTrustedPreviewFolders(many(50))).toEqual(many(TRUSTED_PREVIEW_FOLDERS_MAX));
  });
});

describe('add/remove', () => {
  it('adds, dedupes and handles undefined current', () => {
    expect(addTrustedPreviewFolder(undefined, '/a')).toEqual(['/a']);
    expect(addTrustedPreviewFolder(['/a'], '/a/')).toEqual(['/a']);
  });
  it('fails closed when the cap would be exceeded and for invalid picks', () => {
    const full = many(TRUSTED_PREVIEW_FOLDERS_MAX);
    expect(() => addTrustedPreviewFolder(full, '/new')).toThrow(/At most 20/);
    expect(() => addTrustedPreviewFolder(['/a'], 'rel')).toThrow(TrustedPreviewFolderError);
  });
  it('removes by canonical form and ignores unknown or invalid roots', () => {
    expect(removeTrustedPreviewFolder(['/a', '/b'], '/a/')).toEqual(['/b']);
    expect(removeTrustedPreviewFolder(['/a'], '/zzz')).toEqual(['/a']);
    expect(removeTrustedPreviewFolder(undefined, '/a')).toEqual([]);
    expect(removeTrustedPreviewFolder(['/a'], 'rel')).toEqual(['/a']);
  });
});
