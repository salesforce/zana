import { describe, expect, it } from 'vitest';
import { matchLibraryDeepLink, parseLibraryPanelSubPath } from './library-deep-link.js';
import type { LibraryDoc } from '@zana-ai/zcc-domain/product';

function doc(overrides: Partial<LibraryDoc> & Pick<LibraryDoc, 'id' | 'relPath'>): LibraryDoc {
  return {
    title: overrides.relPath,
    kind: 'md',
    createdAt: 1,
    updatedAt: 1,
    scope: 'project',
    ...overrides
  };
}

describe('library deep-link', () => {
  it('parses plugin panel subpaths', () => {
    expect(parseLibraryPanelSubPath('project/p1/findings/auth.md')).toEqual({
      scope: 'project',
      projectId: 'p1',
      relPath: 'findings/auth.md'
    });
    expect(parseLibraryPanelSubPath('global/ideas/note.md')).toEqual({
      scope: 'global',
      relPath: 'ideas/note.md'
    });
  });

  it('selects the matching library doc', () => {
    const docs = [
      doc({ id: 'g', relPath: 'ideas/note.md', scope: 'global' }),
      doc({ id: 'p', relPath: 'findings/auth.md', scope: 'project', projectId: 'p1' })
    ];
    expect(matchLibraryDeepLink(docs, {
      scope: 'project',
      projectId: 'p1',
      relPath: 'findings/auth.md'
    })?.id).toBe('p');
    expect(matchLibraryDeepLink(docs, { scope: 'global', relPath: 'ideas/note.md' })?.id).toBe('g');
    expect(matchLibraryDeepLink(docs, {
      scope: 'project',
      projectId: 'p2',
      relPath: 'findings/auth.md'
    })).toBeUndefined();
  });
});
