import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getConversationThread, listMenubarConversationThreads, conversationThreadViews } = vi.hoisted(() => ({
  getConversationThread: vi.fn(),
  listMenubarConversationThreads: vi.fn(),
  conversationThreadViews: vi.fn()
}));

vi.mock('@zana-ai/zcc-db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zana-ai/zcc-db')>()),
  getConversationThread,
  listMenubarConversationThreads
}));
vi.mock('./conversation-thread-view.js', () => ({ conversationThreadViews }));

import { createMenubarThreadSource } from './menubar-thread-source.js';

function view(over: Record<string, unknown>) {
  return {
    id: 't1', projectId: 'p1', title: 'Thread', status: 'active', createdAt: 1,
    archivedAt: null, visibility: 'visible', hasPendingInteraction: false,
    activity: { activeBackgroundCommandCount: 0 }, ...over
  };
}

function source() {
  const emit = vi.fn();
  return {
    emit,
    value: createMenubarThreadSource({
      db: {} as never,
      projects: { list: () => [{ id: 'p1', name: 'Project', color: '#2f81f7' }] } as never,
      hub: { emit } as never,
      viewContext: {} as never
    })
  };
}

beforeEach(() => vi.clearAllMocks());

describe('menubar thread source', () => {
  it('projects only attention-worthy rows and orders blocked first', () => {
    listMenubarConversationThreads.mockReturnValue([]);
    conversationThreadViews.mockReturnValue([
      view({ id: 'idle', status: 'idle' }),
      view({ id: 'working', status: 'active', createdAt: 30 }),
      view({ id: 'question', status: 'idle', hasPendingInteraction: true, createdAt: 10 }),
      view({ id: 'error', status: 'error', createdAt: 20 })
    ]);
    const rows = source().value.list(100);
    expect(rows.map((row) => row.agentId)).toEqual(['error', 'question', 'working']);
    expect(rows[0]).toMatchObject({ state: 'blocked', canReply: false, canFavorite: false });
    expect(rows[0]?.question).toBe('Thread error - open for details');
    expect(listMenubarConversationThreads).toHaveBeenCalledWith({}, { limit: 100 });
  });

  it('bounds the returned list', () => {
    listMenubarConversationThreads.mockReturnValue([]);
    conversationThreadViews.mockReturnValue(Array.from({ length: 110 }, (_, id) => view({ id: `t${id}` })));
    expect(source().value.list(500)).toHaveLength(100);
  });

  it('opens only matching visible non-archived rows', () => {
    const { value, emit } = source();
    getConversationThread.mockReturnValue(view({}));
    expect(value.open('t1', 'p1')).toEqual({ ok: true });
    expect(emit).toHaveBeenCalledWith('threads:open', {
      type: 'thread-open', threadId: 't1', projectId: 'p1', split: 'right', file: null
    });

    getConversationThread.mockReturnValue(view({ archivedAt: 2 }));
    expect(value.open('t1', 'p1').ok).toBe(false);
    getConversationThread.mockReturnValue(view({ visibility: 'hidden' }));
    expect(value.open('t1', 'p1').ok).toBe(false);
    getConversationThread.mockReturnValue(view({ projectId: 'other' }));
    expect(value.open('t1', 'p1').ok).toBe(false);
  });
});
