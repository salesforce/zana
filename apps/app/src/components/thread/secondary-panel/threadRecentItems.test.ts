import { describe, expect, it } from 'vitest';
import {
  formatRecentRelativeTime,
  recentItemLabel,
  recordRecentItem,
  tabInputFromRecentItem,
  type ThreadRecentItem
} from './threadRecentItems.js';

describe('recordRecentItem', () => {
  it('prepends a newly opened item so the list reads newest-first', () => {
    const items: ThreadRecentItem[] = [
      { kind: 'file', source: 'workspace', path: 'src/a.ts', openedAt: 10 }
    ];
    const next = recordRecentItem(items, {
      kind: 'file',
      source: 'thread-storage',
      path: 'plans/b.md',
      openedAt: 20
    });
    expect(next[0]).toMatchObject({ path: 'plans/b.md' });
    expect(next[1]).toMatchObject({ path: 'src/a.ts' });
  });

  it('dedupes files by source+path', () => {
    const items: ThreadRecentItem[] = [
      { kind: 'file', source: 'workspace', path: 'src/a.ts', openedAt: 10 },
      { kind: 'file', source: 'thread-storage', path: 'plans/b.md', openedAt: 20 }
    ];
    const next = recordRecentItem(items, {
      kind: 'file',
      source: 'workspace',
      path: 'src/a.ts',
      openedAt: 30
    });
    expect(next).toHaveLength(2);
    expect(next[0]?.openedAt).toBe(30);
  });

  it('dedupes browser recents by URL and plugin recents by module+action', () => {
    const withBrowser = recordRecentItem(
      [{ kind: 'browser', url: 'https://a.test', title: 'A', openedAt: 1 }],
      { kind: 'browser', url: 'https://a.test', title: 'A2', openedAt: 2 }
    );
    expect(withBrowser).toHaveLength(1);
    expect(withBrowser[0]).toMatchObject({ title: 'A2' });
    const withPlugin = recordRecentItem(
      [{ kind: 'plugin', moduleId: 'docs', title: 'Docs', openedAt: 1 }],
      { kind: 'plugin', moduleId: 'docs', title: 'Library', openedAt: 2 }
    );
    expect(withPlugin).toHaveLength(1);
    expect(withPlugin[0]).toMatchObject({ title: 'Library' });
  });

  it('caps the list to the limit, dropping the oldest', () => {
    const items: ThreadRecentItem[] = [
      { kind: 'file', source: 'workspace', path: 'a', openedAt: 3 },
      { kind: 'file', source: 'workspace', path: 'b', openedAt: 2 },
      { kind: 'file', source: 'workspace', path: 'c', openedAt: 1 }
    ];
    const next = recordRecentItem(
      items,
      { kind: 'file', source: 'workspace', path: 'd', openedAt: 4 },
      3
    );
    expect(next.map((item) => item.kind === 'file' ? item.path : '')).toEqual(['d', 'a', 'b']);
  });
});

describe('formatRecentRelativeTime', () => {
  it('formats compact relative labels', () => {
    expect(formatRecentRelativeTime(1_000, 1_000)).toBe('just now');
    expect(formatRecentRelativeTime(0, 120_000)).toBe('2m ago');
  });
});

describe('recentItemLabel', () => {
  it('uses the basename for files and a title fallback for browser tabs', () => {
    expect(recentItemLabel({
      kind: 'file',
      source: 'workspace',
      path: 'src/a.ts',
      openedAt: 1
    })).toBe('a.ts');
    expect(recentItemLabel({
      kind: 'browser',
      url: 'https://a.test',
      title: null,
      openedAt: 1
    })).toBe('https://a.test');
    expect(recentItemLabel({
      kind: 'plugin',
      moduleId: 'docs',
      title: 'Docs',
      openedAt: 1
    })).toBe('Docs');
    expect(tabInputFromRecentItem({
      kind: 'file',
      source: 'thread-storage',
      path: 'notes/a.md',
      openedAt: 1
    })).toEqual({ kind: 'storage-preview', title: 'a.md', path: 'notes/a.md' });
    expect(tabInputFromRecentItem({
      kind: 'browser',
      url: 'https://a.test',
      title: 'A',
      openedAt: 1
    })).toEqual({ kind: 'browser', title: 'A', url: 'https://a.test' });
  });
});
