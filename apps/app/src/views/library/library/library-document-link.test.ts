import { expect, it } from 'vitest';
import type { LibraryDoc } from '@zana-ai/zcc-domain/product';
import { findLinkedLibraryDocument } from './library-document-link.js';

const source: LibraryDoc = { id: 'a', title: 'A', scope: 'project', projectId: 'p1', kind: 'md', relPath: 'notes/a.md', createdAt: 0, updatedAt: 0 };
const target: LibraryDoc = { ...source, id: 'b', relPath: 'notes/b.md', absPath: '/project/.zcc/library/notes/b.md' };
const otherProject = { ...target, projectId: 'p2' };
const global = { ...target, scope: 'global' as const, projectId: undefined };
it.each(['notes/b.md', '/notes/b.md', target.absPath!])('matches %s in the same library scope', path => {
  expect(findLinkedLibraryDocument([otherProject, global, target], source, { path, fragment: 'section-2' })).toBe(target);
});
it('does not cross projects or global/project scope, guess missing files, or normalize escaping traversal', () => {
  for (const path of ['notes/b.md', '../notes/b.md', '/outside.md']) {
    expect(findLinkedLibraryDocument([otherProject, global], source, { path, fragment: '' })).toBeUndefined();
  }
});
it('handles older global documents with no explicit scope', () => {
  expect(findLinkedLibraryDocument([global], { ...global, scope: undefined }, { path: global.relPath, fragment: '' })).toBe(global);
});
