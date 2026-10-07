import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchConversationThreads, searchConversationThreadsWithHistory } from './conversation-search.js';
import type { ProductHttpContext } from '../../http/product-context.js';

const history = vi.hoisted(() => ({
  search: vi.fn(),
  getThread: vi.fn((_db: unknown, id: string) => id === 'removed' ? undefined : ({ id, title: id, projectId: 'p1', providerId: 'codex' }))
}));

vi.mock('./conversation-history.js', () => ({ conversationHistoryAsync: history.search }));

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: history.getThread,
  listVisibleConversationThreads: vi.fn(() => [
    { id: 'thr-alpha', projectId: 'p1', providerId: 'claude-code', title: 'Alpha review' },
    { id: 'thr-beta', projectId: 'p2', providerId: 'cursor', title: 'Beta' }
  ])
}));

vi.mock('./conversation-create.js', () => ({
  conversationThreadViews: vi.fn((_ctx: unknown, threads: Array<{ id: string; title: string; projectId: string; providerId: string }>) => threads),
  conversationThreadView: vi.fn((_ctx: unknown, thread: unknown) => thread)
}));

describe('searchConversationThreads', () => {
  const ctx = { db: {} } as ProductHttpContext;

  it('returns an empty list for a blank query', () => {
    expect(searchConversationThreads(ctx, '   ')).toEqual({ threads: [] });
  });

  it('matches title, id, provider, and project and caps results', () => {
    expect(searchConversationThreads(ctx, 'alpha').threads.map((row) => row.id)).toEqual(['thr-alpha']);
    expect(searchConversationThreads(ctx, 'p2').threads.map((row) => row.id)).toEqual(['thr-beta']);
    expect(searchConversationThreads(ctx, 'cursor', 'p1').threads).toEqual([]);
  });
});

describe('saved message search', () => {
  const ctx = { db: {} } as ProductHttpContext;
  beforeEach(() => vi.clearAllMocks());

  it('does not load history for a blank search', async () => {
    expect(await searchConversationThreadsWithHistory(ctx, '  ')).toEqual({ threads: [] });
    expect(history.search).not.toHaveBeenCalled();
  });

  it('preserves project scope and matching message context, excluding a concurrently removed thread', async () => {
    const matchingMessage = { text: 'Saved result', sequence: 17 };
    history.search.mockResolvedValueOnce({ rows: [
      { id: 'title-result' }, { id: 'message-result', matchingMessage }, { id: 'removed' }
    ] });
    const result = await searchConversationThreadsWithHistory(ctx, 'Saved', 'p1');
    expect(history.search).toHaveBeenCalledWith(ctx.db, { query: 'Saved', projectId: 'p1' });
    expect(result.threads.map(row => row.id)).toEqual(['title-result', 'message-result']);
    expect(result.threads[1]).toMatchObject({ matchingMessage });
    expect(result.threads[0]).not.toHaveProperty('matchingMessage');
  });

  it('bounds history hydration to 25 results when searching all projects', async () => {
    history.search.mockResolvedValueOnce({ rows: Array.from({ length: 40 }, (_, index) => ({ id: `t${index}` })) });
    const result = await searchConversationThreadsWithHistory(ctx, 'query', null);
    expect(history.search).toHaveBeenCalledWith(ctx.db, { query: 'query' });
    expect(history.getThread).toHaveBeenCalledTimes(25);
    expect(result.threads).toHaveLength(25);
  });
});
