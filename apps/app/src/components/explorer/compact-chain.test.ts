import { describe, expect, it } from 'vitest';
import type { FsEntry } from '@zana-ai/zcc-domain/product';
import { compactAutoExpand, compactChain } from './compact-chain.js';

const dir = (path: string): FsEntry => ({ name: path.split('/').pop()!, kind: 'dir', path });
const file = (path: string): FsEntry => ({ name: path.split('/').pop()!, kind: 'file', path });

describe('compactChain', () => {
  const src = dir('/r/src');
  const main = dir('/r/src/main');
  const java = dir('/r/src/main/java');
  const entries = new Map<string, FsEntry[]>([
    ['/r/src', [main]],
    ['/r/src/main', [java]],
    ['/r/src/main/java', [file('/r/src/main/java/A.java')]]
  ]);

  it('follows sole-folder children through expanded folders', () => {
    const expanded = new Map([['/r/src', true], ['/r/src/main', true], ['/r/src/main/java', true]]);
    expect(compactChain(src, entries, expanded).map((e) => e.name)).toEqual(['src', 'main', 'java']);
  });

  it('stops at a collapsed or untouched folder', () => {
    expect(compactChain(src, entries, new Map()).map((e) => e.name)).toEqual(['src']);
    const expanded = new Map([['/r/src', true]]);
    expect(compactChain(src, entries, expanded).map((e) => e.name)).toEqual(['src', 'main']);
  });

  it('is broken by a sibling or a file child', () => {
    const expanded = new Map([['/r/src', true], ['/r/src/main', true]]);
    const withSibling = new Map(entries).set('/r/src', [main, dir('/r/src/test')]);
    expect(compactChain(src, withSibling, expanded)).toHaveLength(1);
    const withFile = new Map(entries).set('/r/src/main', [file('/r/src/main/x.ts')]);
    expect(compactChain(src, withFile, expanded).map((e) => e.name)).toEqual(['src', 'main']);
  });

  it('is a chain of one for files and unloaded folders', () => {
    const f = file('/r/a.txt');
    expect(compactChain(f, entries, new Map([['/r/a.txt', true]]))).toEqual([f]);
    expect(compactChain(src, new Map(), new Map([['/r/src', true]]))).toEqual([src]);
  });
});

describe('compactAutoExpand', () => {
  const entries = new Map<string, FsEntry[]>([
    ['/r/a', [dir('/r/a/b')]],
    ['/r/c', [dir('/r/c/d'), dir('/r/c/e')]],
    ['/r/f', [file('/r/f/x')]]
  ]);

  it('returns untouched sole-folder children of expanded folders', () => {
    const expanded = new Map([['/r/a', true], ['/r/c', true], ['/r/f', true]]);
    expect(compactAutoExpand(entries, expanded, new Set())).toEqual(['/r/a/b']);
  });

  it('skips collapsed parents, user-toggled and loading children', () => {
    expect(compactAutoExpand(entries, new Map(), new Set())).toEqual([]);
    expect(compactAutoExpand(entries, new Map([['/r/a', true], ['/r/a/b', false]]), new Set())).toEqual([]);
    expect(compactAutoExpand(entries, new Map([['/r/a', true]]), new Set(['/r/a/b']))).toEqual([]);
  });
});
