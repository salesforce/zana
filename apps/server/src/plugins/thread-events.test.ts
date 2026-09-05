import { describe, expect, it, vi } from 'vitest';
import { emitPluginThreadEvent } from './thread-events.js';
import type { ProductHttpContext } from '../http/product-context.js';

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn(() => ({
    id: 'thr-2',
    projectId: 'proj-1',
    hostId: 'h1',
    environmentId: 'e1',
    providerId: 'claude-code',
    status: 'idle'
  })),
  listConversationThreadEventsWindow: vi.fn(() => [
    { type: 'turn/completed', payload: { type: 'text', text: 'done' } }
  ])
}));

describe('emitPluginThreadEvent', () => {
  it('no-ops when plugins are not wired', () => {
    expect(() =>
      emitPluginThreadEvent({} as ProductHttpContext, {
        name: 'thread.created',
        threadId: 'thr-1',
        projectId: 'proj-1'
      })
    ).not.toThrow();
  });

  it('forwards to PluginService and swallows rejections', async () => {
    const emitThreadEvent = vi.fn().mockRejectedValue(new Error('boom'));
    emitPluginThreadEvent(
      { plugins: { emitThreadEvent } } as unknown as ProductHttpContext,
      { name: 'thread.idle', threadId: 'thr-2' }
    );
    await Promise.resolve();
    expect(emitThreadEvent).toHaveBeenCalledWith({ name: 'thread.idle', threadId: 'thr-2' });
  });

  it('attaches a thread DTO and last assistant text on idle', async () => {
    const emitThreadEvent = vi.fn().mockResolvedValue(undefined);
    emitPluginThreadEvent(
      {
        db: {},
        plugins: { emitThreadEvent }
      } as unknown as ProductHttpContext,
      { name: 'thread.idle', threadId: 'thr-2', projectId: 'proj-1' }
    );
    await Promise.resolve();
    expect(emitThreadEvent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'thread.idle',
      threadId: 'thr-2',
      thread: expect.objectContaining({ id: 'thr-2', projectId: 'proj-1', status: 'idle' }),
      lastAssistantText: 'done'
    }));
  });
});
