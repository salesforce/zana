/**
 * The real `threadWrapUps(ctx)` wiring: the wrap-up instruction is sent as a
 * system-origin queued turn, so it is not mistaken for a user prompt.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const sendConversationTurn = vi.fn(async () => ({ id: 't1' }));
vi.mock('./conversation-lifecycle.js', () => ({ sendConversationTurn, archiveConversation: vi.fn() }));
vi.mock('./conversation-timeline.js', () => ({ conversationMessageTexts: () => [] }));
vi.mock('@zana-ai/zcc-db', async (original) => ({
  ...await original<typeof import('@zana-ai/zcc-db')>(),
  getConversationThread: () => ({ status: 'idle', archivedAt: null }),
  listDeferredThreadMessages: () => []
}));

const { threadWrapUps, disposeThreadWrapUps } = await import('./thread-wrap-up.js');

describe('threadWrapUps send wiring', () => {
  const ctx = {
    db: {},
    config: { getConfig: () => ({ closeWrapUpInstructions: 'Be brief' }) },
    pendingInteractions: { hasPendingThreadInteraction: () => false },
    hostHub: { connectedHostIds: () => ['h1'] },
    hub: { subscribe: vi.fn(() => () => undefined) }
  } as never;

  afterEach(() => disposeThreadWrapUps(ctx));

  it('queues the wrap-up instructions as a text turn tagged origin system', async () => {
    const start = await threadWrapUps(ctx).request({ id: 't1', projectId: 'p1', hostId: 'h1', title: 'T' });
    expect(start).toBe('wrapping-up');
    expect(sendConversationTurn).toHaveBeenCalledOnce();
    const call = sendConversationTurn.mock.calls[0] as unknown as unknown[];
    expect(call[1]).toBe('t1');
    expect(call[2]).toEqual([{ type: 'text', text: expect.stringContaining('Be brief'), mentions: [] }]);
    expect(call[3]).toBe('queue-if-active');
    expect(call[4]).toBeUndefined();
    expect(call[5]).toEqual({ origin: 'system' });
  });

  it('falls back when the send is rejected', async () => {
    sendConversationTurn.mockRejectedValueOnce(new Error('nope'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const start = await threadWrapUps(ctx).request({ id: 't2', projectId: 'p1', hostId: 'h1', title: 'T' });
    expect(start).toBe('fallback');
    log.mockRestore(); warn.mockRestore();
  });
});
