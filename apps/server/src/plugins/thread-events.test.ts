import { describe, expect, it, vi } from 'vitest';
import {
  DISPATCH_OVERRIDE_AUDIT_EVENT_TYPE,
  PLUGIN_LIFECYCLE_TEXT_MAX_CHARS,
  conversationThreadOutput,
  emitDispatchOverrideAudit,
  emitHardenedLifecycle,
  emitPluginThreadEvent,
  emitPluginThreadStatus
} from './thread-events.js';
import type { ProductHttpContext } from '../http/product-context.js';

const { appendConversationThreadEvent } = vi.hoisted(() => ({
  appendConversationThreadEvent: vi.fn((_db: unknown, input: { threadId: string; type: string; payload?: unknown }) => ({
    id: 'evt-1',
    threadId: input.threadId,
    sequence: 7,
    type: input.type,
    payload: input.payload,
    createdAt: 1
  }))
}));

vi.mock('@zana-ai/zcc-db', () => ({
  appendConversationThreadEvent,
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
  it('forwards root status transitions and ignores intermediate states', () => {
    const emitThreadEvent = vi.fn().mockResolvedValue(undefined);
    const ctx = { plugins: { emitThreadEvent } } as unknown as ProductHttpContext;
    for (const status of ['active', 'idle', 'error', 'pending', 'starting', 'stopping'] as const) {
      emitPluginThreadStatus(ctx, { id: 'thread', projectId: 'project', status });
    }
    expect(emitThreadEvent.mock.calls.map(([event]) => event.name)).toEqual(['thread.active', 'thread.idle', 'thread.failed']);
    expect(emitThreadEvent.mock.calls.map(([event]) => event.sequence)).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number)
    ]);
  });
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
    expect(emitThreadEvent).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.any(String),
      sequence: expect.any(Number),
      timestamp: expect.any(Number),
      name: 'thread.idle',
      threadId: 'thr-2'
    }));
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

  it('assembles thread output from the last assistant text', () => {
    expect(conversationThreadOutput({ db: {} } as ProductHttpContext, 'thr-2')).toEqual({
      output: 'done'
    });
  });

  it('redacts, bounds, and projects lifecycle payloads', () => {
    const event = emitHardenedLifecycle({
      name: 'thread.failed',
      threadId: 'thr-1',
      projectId: 'project',
      error: `token=top-secret ${'x'.repeat(PLUGIN_LIFECYCLE_TEXT_MAX_CHARS)}`,
      // Cast proves unknown fields cannot bypass lifecycle projection.
      ...({ untrustedPayload: 'do not deliver' } as object)
    });
    expect(event).toMatchObject({
      id: expect.any(String),
      sequence: expect.any(Number),
      timestamp: expect.any(Number),
      error: expect.stringContaining('[redacted]')
    });
    expect(event.error?.length).toBeLessThanOrEqual(PLUGIN_LIFECYCLE_TEXT_MAX_CHARS + 1);
    expect(event).not.toHaveProperty('untrustedPayload');
  });
});

describe('emitDispatchOverrideAudit', () => {
  it('persists a redacted audit event and fans it out over the thread hub', () => {
    const emit = vi.fn();
    const ctx = { db: {}, hub: { emit } } as unknown as ProductHttpContext;
    const event = {
      dispatchId: 'd1',
      threadId: 'thr-2',
      projectId: 'proj-1',
      overriddenBy: 'desktop-ui',
      pluginId: 'platform-hooks-probe',
      reason: 'capacity',
      priorGeneration: 3,
      timestamp: 1000,
      outcome: 'accepted' as const
    };
    emitDispatchOverrideAudit(ctx, event);
    expect(appendConversationThreadEvent).toHaveBeenCalledWith({}, {
      threadId: 'thr-2',
      type: DISPATCH_OVERRIDE_AUDIT_EVENT_TYPE,
      payload: event
    });
    expect(emit).toHaveBeenCalledWith('threads:event', {
      threadId: 'thr-2',
      sequence: 7,
      kind: 'thread.event',
      type: DISPATCH_OVERRIDE_AUDIT_EVENT_TYPE,
      payload: event
    });
  });

  it('never includes prompt/args/results fields — only the allow-listed audit shape', () => {
    const emit = vi.fn();
    const ctx = { db: {}, hub: { emit } } as unknown as ProductHttpContext;
    emitDispatchOverrideAudit(ctx, {
      dispatchId: 'd1',
      threadId: 'thr-2',
      projectId: 'proj-1',
      overriddenBy: 'desktop-ui',
      priorGeneration: 1,
      timestamp: 1000,
      outcome: 'stale'
    });
    const [, payload] = appendConversationThreadEvent.mock.calls.at(-1) as [unknown, { payload: object }];
    expect(Object.keys(payload.payload).sort()).toEqual(
      ['dispatchId', 'outcome', 'overriddenBy', 'priorGeneration', 'projectId', 'threadId', 'timestamp'].sort()
    );
  });

  it('swallows a persistence failure rather than throwing out of the override path', () => {
    const emit = vi.fn();
    appendConversationThreadEvent.mockImplementationOnce(() => {
      throw new Error('db closed');
    });
    const ctx = { db: {}, hub: { emit } } as unknown as ProductHttpContext;
    expect(() => emitDispatchOverrideAudit(ctx, {
      dispatchId: 'd1',
      threadId: 'thr-2',
      projectId: 'proj-1',
      overriddenBy: 'desktop-ui',
      priorGeneration: 1,
      timestamp: 1000,
      outcome: 'accepted'
    })).not.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });
});
