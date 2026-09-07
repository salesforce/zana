import { describe, expect, it } from 'vitest';
import { parseDocDirectiveAttributes } from './doc-directive.js';

describe('parseDocDirectiveAttributes', () => {
  it('requires a confined relative path', () => {
    expect(parseDocDirectiveAttributes({})).toBeNull();
    expect(parseDocDirectiveAttributes({ path: '../secret.md' })).toBeNull();
    expect(parseDocDirectiveAttributes({ path: '  ' })).toBeNull();
  });

  it('uses the filename when title is missing', () => {
    expect(parseDocDirectiveAttributes({ path: 'findings/auth.md' })).toEqual({
      path: 'findings/auth.md',
      title: 'auth.md',
      vault: null
    });
    expect(parseDocDirectiveAttributes({
      path: 'plans/release.md',
      title: 'Release plan',
      vault: 'personal'
    })).toEqual({
      path: 'plans/release.md',
      title: 'Release plan',
      vault: 'personal'
    });
  });
});
