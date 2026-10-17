import { describe, expect, it, vi } from 'vitest';
import { createStateDigest } from './state-digest.js';
import { DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';

const USER = { kind: 'user', label: 'You', threadId: null } as const;

describe('convergence-stable state digest', () => {
  it('is null before a local repository exists', () => {
    expect(createStateDigest({ list: () => [], readAllFiles: () => [] }, { localRepository: () => null, head: () => null })()).toBeNull();
  });

  it('ignores per-replica heads but follows document ids and file content', () => {
    const store = new DesignDocStore(createTestDatabase());
    const doc = store.create({ title: 'A', template: 'blank' }, USER);
    let head = 'h1';
    const digest = createStateDigest(store, { localRepository: () => ({ repoId: 'r' }), head: () => head });
    const first = digest()!;
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    // A merge moved the head but converged content is identical: a fresh computation matches.
    head = 'h2-after-merge';
    const merged = createStateDigest(store, { localRepository: () => ({ repoId: 'r' }), head: () => head })();
    expect(merged).toBe(first);
    store.writeFile(doc.id, { path: 'README.md', content: 'changed' }, USER);
    head = 'h3';
    expect(digest()).not.toBe(first);
  });

  it('caches against the head fingerprint and recomputes when it moves', () => {
    const readAllFiles = vi.fn(() => [{ path: 'a.md', encoding: 'utf8', content: 'x' }]);
    let head = 'h1';
    const digest = createStateDigest({ list: () => [{ id: 'd2' }, { id: 'd1' }], readAllFiles }, { localRepository: () => ({ repoId: 'r' }), head: () => head });
    const first = digest();
    digest();
    expect(readAllFiles).toHaveBeenCalledTimes(2);
    head = 'h2';
    expect(digest()).toBe(first);
    expect(readAllFiles).toHaveBeenCalledTimes(4);
  });

  it('differs when a document is added or content differs, regardless of listing order', () => {
    const files = new Map([['d1', 'one'], ['d2', 'two']]);
    const make = (ids: string[]) => createStateDigest({ list: () => ids.map((id) => ({ id })), readAllFiles: (id) => [{ path: 'a', encoding: 'utf8', content: files.get(id)! }] },
      { localRepository: () => ({ repoId: 'r' }), head: () => null })();
    expect(make(['d1', 'd2'])).toBe(make(['d2', 'd1']));
    expect(make(['d1'])).not.toBe(make(['d1', 'd2']));
  });
});
