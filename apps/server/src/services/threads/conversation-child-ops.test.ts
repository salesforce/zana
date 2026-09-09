import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archiveAllConversationChildren,
  collectConversationArchiveDescendants,
  conversationChildSummary
} from './conversation-child-ops.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import type { ProductHttpContext } from '../../http/product-context.js';

const parent = {
  id: 'parent',
  projectId: 'p1',
  originKind: null,
  visibility: 'visible' as const,
  archivedAt: null,
  parentThreadId: null,
  status: 'idle' as const
};
const children = [
  {
    id: 'c-idle',
    parentThreadId: 'parent',
    status: 'idle',
    archivedAt: null,
    projectId: 'p1',
    originKind: null,
    visibility: 'visible' as const
  },
  {
    id: 'c-live',
    parentThreadId: 'parent',
    status: 'active',
    archivedAt: null,
    projectId: 'p1',
    originKind: null,
    visibility: 'visible' as const
  }
];

const projectThreads = [...children];

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn((_: unknown, id: string) => {
    if (id === 'parent') return parent;
    return projectThreads.find((row) => row.id === id) ?? null;
  }),
  listConversationThreadsByProject: vi.fn(() => projectThreads),
  archiveConversationThread: vi.fn((_: unknown, id: string) => {
    const row = projectThreads.find((child) => child.id === id);
    return row ? { ...row, archivedAt: 1, status: 'idle' } : null;
  })
}));

vi.mock('./conversation-create.js', () => ({
  conversationThreadView: vi.fn((_ctx: unknown, thread: unknown) => thread)
}));

describe('conversationChildSummary', () => {
  const ctx = { db: {}, hub: { emit: vi.fn() } } as unknown as ProductHttpContext;

  beforeEach(() => {
    projectThreads.splice(0, projectThreads.length, ...children);
  });

  it('counts live vs idle children', () => {
    expect(conversationChildSummary(ctx, 'parent')).toMatchObject({
      total: 2,
      live: 1,
      archived: 0,
      byStatus: { idle: 1, active: 1, error: 0, starting: 0, stopping: 0 }
    });
  });

  it('refuses archive-all while children are live unless confirmed', () => {
    expect(() => archiveAllConversationChildren(ctx, 'parent')).toThrow(ThreadCreateError);
    expect(archiveAllConversationChildren(ctx, 'parent', true)).toMatchObject({
      ok: true,
      archivedCount: 2
    });
  });
});

describe('collectConversationArchiveDescendants', () => {
  const ctx = { db: {} } as unknown as ProductHttpContext;

  function thread(
    id: string,
    over: Partial<typeof parent> = {}
  ) {
    return {
      ...parent,
      id,
      status: 'idle' as const,
      archivedAt: null,
      originKind: null,
      visibility: 'visible' as const,
      ...over
    };
  }

  it('archives a four-level tree children-before-parents and skips visible forks', () => {
    const a = thread('a', { parentThreadId: 'parent' });
    const b = thread('b', { parentThreadId: 'a' });
    const c = thread('c', { parentThreadId: 'b' });
    const hidden = thread('hidden-fork', {
      parentThreadId: 'b',
      originKind: 'fork',
      visibility: 'hidden'
    });
    const hiddenChild = thread('hidden-child', { parentThreadId: 'hidden-fork' });
    const visibleFork = thread('visible-fork', {
      parentThreadId: 'a',
      originKind: 'fork',
      visibility: 'visible'
    });
    projectThreads.splice(0, projectThreads.length, a, b, c, hidden, hiddenChild, visibleFork);
    expect(collectConversationArchiveDescendants(ctx, parent).map((row) => row.id)).toEqual([
      'c',
      'hidden-child',
      'hidden-fork',
      'b',
      'a'
    ]);
  });

  it('walks an archived intermediary to collect live grandchildren without re-archiving it', () => {
    const archivedChild = thread('archived-child', {
      parentThreadId: 'parent',
      archivedAt: 9
    });
    const liveGrand = thread('live-grand', { parentThreadId: 'archived-child' });
    projectThreads.splice(0, projectThreads.length, archivedChild, liveGrand);
    expect(collectConversationArchiveDescendants(ctx, parent).map((row) => row.id)).toEqual([
      'live-grand'
    ]);
  });
});
