import { describe, it, expect } from 'vitest';
import { buildLibraryTree, libraryBucketKey, libraryNodeKey } from './libraryTree';
import type { LibraryDoc } from '@shared/types';

function doc(overrides: Partial<LibraryDoc>): LibraryDoc {
  return {
    id: overrides.id ?? Math.random().toString(36),
    relPath: 'note.md',
    title: 'Untitled',
    kind: 'md',
    createdAt: 0,
    updatedAt: 0,
    scope: 'global',
    ...overrides
  };
}

describe('buildLibraryTree', () => {
  it('builds one root per scope bucket, Global first', () => {
    const docs = [
      doc({ relPath: 'a.md', scope: 'global' }),
      doc({ relPath: 'b.md', scope: 'project', projectId: 'p2', projectName: 'Zeta' }),
      doc({ relPath: 'c.md', scope: 'project', projectId: 'p1', projectName: 'Alpha' })
    ];
    const tree = buildLibraryTree(docs);
    expect(tree.map((r) => r.key)).toEqual(['global', 'project:p1', 'project:p2']);
    expect(tree.every((r) => r.isBucketRoot)).toBe(true);
  });

  it('nests docs into real folders derived from relPath', () => {
    const docs = [
      doc({ relPath: 'findings/auth.md' }),
      doc({ relPath: 'findings/nested/deep.md' }),
      doc({ relPath: 'root.md' })
    ];
    const tree = buildLibraryTree(docs);
    const global = tree[0];
    expect(global.children?.map((c) => c.name).sort()).toEqual(['findings', 'root.md']);
    const findings = global.children!.find((c) => c.name === 'findings')!;
    expect(findings.kind).toBe('dir');
    expect(findings.count).toBe(2);
    expect(findings.children?.map((c) => c.name).sort()).toEqual(['auth.md', 'nested']);
    const nested = findings.children!.find((c) => c.name === 'nested')!;
    expect(nested.children?.[0].name).toBe('deep.md');
  });

  it('sorts directories before files, then alphabetically', () => {
    const docs = [
      doc({ relPath: 'z.md' }),
      doc({ relPath: 'a.md' }),
      doc({ relPath: 'mid/x.md' })
    ];
    const tree = buildLibraryTree(docs);
    expect(tree[0].children?.map((c) => c.name)).toEqual(['mid', 'a.md', 'z.md']);
  });

  it('materializes an empty phantom folder that has no doc yet', () => {
    const docs = [doc({ relPath: 'existing.md' })];
    const tree = buildLibraryTree(docs, [{ scope: 'global', relPath: 'empty-dir' }]);
    const global = tree[0];
    const empty = global.children?.find((c) => c.name === 'empty-dir');
    expect(empty).toBeDefined();
    expect(empty?.kind).toBe('dir');
    expect(empty?.count).toBe(0);
  });

  it('drops a phantom for a bucket that has no real docs', () => {
    const tree = buildLibraryTree([], [{ scope: 'project', projectId: 'ghost', relPath: 'x' }]);
    expect(tree).toEqual([]);
  });

  it('keys are stable and unique per bucket+relPath', () => {
    expect(libraryBucketKey('global')).toBe('global');
    expect(libraryBucketKey('project', 'p1')).toBe('project:p1');
    expect(libraryNodeKey('global', 'a/b.md')).toBe('global:a/b.md');
  });
});
