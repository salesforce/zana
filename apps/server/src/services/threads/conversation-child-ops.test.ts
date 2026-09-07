import { describe, expect, it, vi } from 'vitest';
import { archiveAllConversationChildren, conversationChildSummary } from './conversation-child-ops.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import type { ProductHttpContext } from '../../http/product-context.js';

const parent = { id: 'parent', projectId: 'p1' };
const children = [
  { id: 'c-idle', parentThreadId: 'parent', status: 'idle', archivedAt: null, projectId: 'p1' },
  { id: 'c-live', parentThreadId: 'parent', status: 'active', archivedAt: null, projectId: 'p1' }
];

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn((_: unknown, id: string) => (id === 'parent' ? parent : null)),
  listConversationThreadsByProject: vi.fn(() => children),
  archiveConversationThread: vi.fn((_: unknown, id: string) => {
    const row = children.find((child) => child.id === id);
    return row ? { ...row, archivedAt: 1, status: 'idle' } : null;
  })
}));

vi.mock('./conversation-create.js', () => ({
  conversationThreadView: vi.fn((_ctx: unknown, thread: unknown) => thread)
}));

describe('conversationChildSummary', () => {
  const ctx = { db: {}, hub: { emit: vi.fn() } } as unknown as ProductHttpContext;

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
