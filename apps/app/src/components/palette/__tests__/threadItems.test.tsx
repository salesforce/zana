import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { ThreadListItem } from '../../../thread-store.js';
import { buildThreadPaletteItems } from '../threadItems.js';

const projects = [{ id: 'p1', name: 'Design system', path: '/design' }, { id: 'p2', name: 'Storefront', path: '/shop' }] as Project[];
const thread = (id: string, extra: Partial<ThreadListItem> = {}): ThreadListItem => ({
  id, title: `Review ${id}`, projectId: 'p1', hostId: 'host', environmentId: null, providerId: 'codex',
  createdAt: 10, status: 'idle', cwd: null, branchName: null, isWorktree: false, ...extra
});

describe('thread palette destinations', () => {
  it('includes unarchived threads from the visible roster in known projects only', () => {
    const items = buildThreadPaletteItems([
      thread('visible'), thread('archived', { archivedAt: 20 }), thread('child', { parentThreadId: 'visible' }),
      thread('unknown', { projectId: 'deleted' }), thread('other', { projectId: 'p2' })
    ], projects.slice(0, 1), vi.fn());
    expect(items.map((item) => item.key)).toEqual(['thread:visible', 'thread:child']);
  });

  it('honors a dedicated project window even if the roster contains other projects', () => {
    const items = buildThreadPaletteItems([thread('local'), thread('other', { projectId: 'p2' })], projects, vi.fn(), 'p1');
    expect(items.map((item) => item.key)).toEqual(['thread:local']);
  });

  it('sorts by latest activity with creation time as a fallback without mutating the roster', () => {
    const threads = [thread('old'), thread('new', { createdAt: 20 }), thread('active', { updatedAt: 30 })];
    expect(buildThreadPaletteItems(threads, projects, vi.fn()).map((item) => item.key)).toEqual(['thread:active', 'thread:new', 'thread:old']);
    expect(threads.map((t) => t.id)).toEqual(['old', 'new', 'active']);
  });

  it('provides project context, searchable branch/directory, and a safe empty-title fallback', () => {
    const source = thread('review', { title: '  ', branchName: 'feature/palette', cwd: '/design/ui' });
    const open = vi.fn();
    const [row] = buildThreadPaletteItems([source, thread('null', { title: null })], projects, open);
    expect(row.label).toBe('Untitled thread');
    expect(row.hint).toBe('Design system · codex');
    expect(row.keywords).toEqual(['feature/palette', '/design/ui']);
    expect(row.category).toBe('Threads');
    expect(open).not.toHaveBeenCalled();
    row.run();
    expect(open).toHaveBeenCalledWith(source);
  });
});
