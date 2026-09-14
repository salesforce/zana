import { describe, expect, it } from 'vitest';
import {
  filterLibraryMentionDocs,
  formatLibraryMentionContext,
  libraryMentionId,
  parseLibraryMentionId
} from './library-mentions.js';

const docs = [
  { scope: 'global', relPath: 'ideas/note.md', title: 'Personal note', summary: 'inbox' },
  { scope: 'project', projectId: 'p1', relPath: 'findings/auth.md', title: 'Auth findings', summary: 'oauth' },
  { scope: 'project', projectId: 'p2', relPath: 'findings/other.md', title: 'Other project' }
];

describe('library mentions', () => {
  it('builds and parses mention ids', () => {
    expect(libraryMentionId(docs[1]!)).toBe('project:p1:findings/auth.md');
    expect(parseLibraryMentionId('project:p1:findings/auth.md')).toEqual({
      scope: 'project',
      projectId: 'p1',
      relPath: 'findings/auth.md'
    });
    expect(parseLibraryMentionId('global:global:ideas/note.md')).toEqual({
      scope: 'global',
      relPath: 'ideas/note.md'
    });
    expect(parseLibraryMentionId('nope')).toBeNull();
  });

  it('searches the mention project plus global docs', () => {
    expect(filterLibraryMentionDocs(docs, { query: 'auth', projectId: 'p1' })).toEqual([
      { id: 'project:p1:findings/auth.md', label: 'Auth findings' }
    ]);
    expect(filterLibraryMentionDocs(docs, { query: 'note', projectId: 'p1' })).toEqual([
      { id: 'global:global:ideas/note.md', label: 'Personal note' }
    ]);
    expect(filterLibraryMentionDocs(docs, { query: 'other', projectId: 'p1' })).toEqual([]);
  });

  it('formats resolve context from the document body', () => {
    expect(formatLibraryMentionContext('Auth findings', 'Use PKCE.')).toContain('Use PKCE.');
  });
});
