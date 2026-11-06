import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getConversationThread, getConversationAssistantPreview, getConversationFailurePreview, listPendingInteractionsByThread, listMenubarConversationThreads, conversationThreadViews } = vi.hoisted(() => ({
  getConversationThread: vi.fn(),
  getConversationAssistantPreview: vi.fn(),
  getConversationFailurePreview: vi.fn(),
  listPendingInteractionsByThread: vi.fn(() => [] as unknown[]),
  listMenubarConversationThreads: vi.fn(),
  conversationThreadViews: vi.fn()
}));

vi.mock('@zana-ai/zcc-db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zana-ai/zcc-db')>()),
  getConversationThread,
  getConversationAssistantPreview,
  getConversationFailurePreview,
  listPendingInteractionsByThread,
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

beforeEach(() => { vi.clearAllMocks(); listPendingInteractionsByThread.mockReturnValue([]); getConversationAssistantPreview.mockReturnValue(undefined); getConversationFailurePreview.mockReturnValue(undefined); });

describe('menubar thread source', () => {
  const question = { id: 'q1', prompt: 'Which path?', multiSelect: false, allowFreeText: true,
    options: [{ value: 'a', label: 'Staging', description: 'Test first' }] };
  function pending(payload: unknown) {
    listMenubarConversationThreads.mockReturnValue([]);
    conversationThreadViews.mockReturnValue([view({ hasPendingInteraction: true })]);
    listPendingInteractionsByThread.mockReturnValue([{ id: 'interaction-1', turnId: 'turn-1', createdAt: 123, payload: JSON.stringify(payload) }]);
    return source().value;
  }
  it('projects the current question, all choices, and the preceding assistant message', () => {
    const value = pending({ kind: 'user_question', questions: [question, { ...question, id: 'q2', prompt: 'Anything else?' }] });
    getConversationAssistantPreview.mockReturnValue({ text: 'I tested the paths.', truncated: false });
    const row = value.list()[0]!;
    expect(row.question).toBe('Which path?');
    expect(row.context).toMatchObject({ interactionId: 'interaction-1', createdAt: 123, questions: [question, { ...question, id: 'q2', prompt: 'Anything else?' }], lastMessage: { text: 'I tested the paths.' } });
    expect(getConversationAssistantPreview).toHaveBeenCalledWith({}, 't1', 'turn-1', 123);
    expect(listPendingInteractionsByThread).toHaveBeenCalledWith({}, { threadId: 't1', statuses: ['pending'], limit: 1 });
  });
  it.each([
    [{ kind: 'approval', subject: { kind: 'command', itemId: 'i', command: 'pnpm test', cwd: null, actions: [], sessionGrant: null }, reason: null, availableDecisions: ['allow_once', 'deny'] }, 'Approve command: pnpm test'],
    [{ kind: 'approval', subject: { kind: 'file_change', itemId: 'i', writeScope: '/tmp/repo', sessionGrant: null }, reason: null, availableDecisions: ['allow_once'] }, 'Approve file changes: /tmp/repo'],
    [{ kind: 'approval', subject: { kind: 'file_change', itemId: 'i', writeScope: null, sessionGrant: null }, reason: null, availableDecisions: ['allow_once'] }, 'Approve file changes'],
    [{ kind: 'approval', subject: { kind: 'plan', itemId: 'i', plan: 'A plan', planFilePath: null }, reason: null, availableDecisions: ['allow_once'] }, 'Review the proposed plan'],
    [{ kind: 'example/picker', title: 'Pick a target', data: {} }, 'Pick a target']
  ])('describes non-question interactions without exposing arbitrary plugin data', (payload, prompt) => {
    expect(pending(payload).list()[0]?.context?.prompt).toBe(prompt);
  });
  it('omits malformed, oversized, missing or already resolved context without hiding the thread', () => {
    const value = pending({ invalid: true });
    expect(value.list()[0]?.context).toBeUndefined();
    listPendingInteractionsByThread.mockReturnValue([{ payload: '{' }]);
    expect(value.list()[0]?.context).toBeUndefined();
    listPendingInteractionsByThread.mockReturnValue([{ payload: 'x'.repeat(128 * 1024 + 1) }]);
    expect(value.list()[0]?.context).toBeUndefined();
    listPendingInteractionsByThread.mockReturnValue([]);
    expect(value.list()[0]?.context).toBeUndefined();
  });
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
    expect(rows[0]?.question).toBe('Thread failed');
    expect(listMenubarConversationThreads).toHaveBeenCalledWith({}, { limit: 100 });
  });

  it('shows the terminal failure instead of an obsolete pending question', () => {
    const value = pending({ kind: 'user_question', questions: [question] });
    conversationThreadViews.mockReturnValue([view({ status: 'error', hasPendingInteraction: true })]);
    getConversationFailurePreview.mockReturnValue('Provider connection closed.');
    expect(value.list()[0]).toMatchObject({ question: 'Thread failed: Provider connection closed.', state: 'blocked' });
    expect(value.list()[0]?.context).toBeUndefined();
    expect(getConversationFailurePreview).toHaveBeenCalledWith({}, 't1');
    expect(listPendingInteractionsByThread).not.toHaveBeenCalled();
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
