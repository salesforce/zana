import { describe, expect, it } from 'vitest';
import { parseDocDirectiveAttributes } from './doc-directive.js';

describe('parseDocDirectiveAttributes', () => {
  it('requires a confined relative path', () => {
    expect(parseDocDirectiveAttributes({})).toBeNull();
    expect(parseDocDirectiveAttributes({ path: '../secret.md' })).toBeNull();
    expect(parseDocDirectiveAttributes({ path: '/etc/passwd' })).toBeNull();
    expect(parseDocDirectiveAttributes({ path: '  ' })).toBeNull();
  });

  it('treats path as library-relative and defaults scope to project', () => {
    expect(parseDocDirectiveAttributes({ path: 'findings/auth.md' })).toEqual({
      path: 'findings/auth.md',
      title: 'auth.md',
      source: 'library',
      scope: 'project',
      vault: null
    });
  });

  it('keeps workspace source and global scope when set', () => {
    expect(parseDocDirectiveAttributes({
      path: 'docs/guide.md',
      title: 'Guide',
      source: 'workspace',
      scope: 'global',
      vault: 'personal'
    })).toEqual({
      path: 'docs/guide.md',
      title: 'Guide',
      source: 'workspace',
      scope: 'global',
      vault: 'personal'
    });
  });
});
