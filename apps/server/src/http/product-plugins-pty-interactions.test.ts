/**
 * The attached plugin service's interaction routing for PTY sessions and the
 * `origin: 'system'` tag it puts on plugin-driven thread turns. Collaborators
 * are mocked so the options handed to `createPluginService` can be called directly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captured: { options?: Record<string, any> } = {};
const getConversationThread = vi.fn();
const sendConversationTurn = vi.fn(async () => ({ id: 'thread-sent' }));
const forkConversation = vi.fn(async () => ({ id: 'thread-forked' }));

vi.mock('../plugins/plugin-service.js', () => ({
  createPluginService: (options: Record<string, unknown>) => {
    captured.options = options;
    return { stop: () => {} };
  },
  defaultBundledRoot: () => '/bundled',
  toPluginAppSnapshot: () => ({})
}));
vi.mock('../services/threads/conversation-lifecycle.js', async (original) => ({
  ...await original<typeof import('../services/threads/conversation-lifecycle.js')>(),
  sendConversationTurn,
  forkConversation
}));
vi.mock('@zana-ai/zcc-db', async (original) => ({
  ...await original<typeof import('@zana-ai/zcc-db')>(),
  getConversationThread
}));
vi.mock('../services/interactions/interaction-service.js', () => ({ InteractionService: class {} }));
vi.mock('../services/interactions/interaction-maintenance.js', () => ({ startInteractionMaintenance: () => () => {} }));

const { createAttachedProductPluginService } = await import('./product-plugins.js');

function attach() {
  const ctx = {
    db: {},
    dataDir: '/tmp/zcc-pty-interactions-missing',
    pendingInteractions: {
      requestPluginInteraction: vi.fn(async () => 'pending-result'),
      interruptPluginInteractions: vi.fn()
    },
    ptyInteractions: {
      hasSession: vi.fn((_id: string) => false),
      request: vi.fn(async () => 'pty-result'),
      interruptForPlugin: vi.fn()
    }
  };
  createAttachedProductPluginService(ctx as never, { bundledRoot: '/bundled' });
  return { ctx, options: captured.options! };
}

beforeEach(() => {
  getConversationThread.mockReset();
  sendConversationTurn.mockClear();
  forkConversation.mockClear();
});

describe('attached plugin service: requestPluginInteraction routing', () => {
  const args = { threadId: 'sess-1', pluginId: 'p', title: 'Ask' };

  it('keeps a real conversation thread on the pending-interactions path', async () => {
    getConversationThread.mockReturnValue({ id: 'sess-1' });
    const { ctx, options } = attach();
    ctx.ptyInteractions.hasSession.mockReturnValue(true);
    await expect(options.requestPluginInteraction(args)).resolves.toBe('pending-result');
    expect(ctx.pendingInteractions.requestPluginInteraction).toHaveBeenCalledWith(args);
    expect(ctx.ptyInteractions.request).not.toHaveBeenCalled();
  });

  it('keeps an unknown id with no live PTY session on the pending-interactions path', async () => {
    getConversationThread.mockReturnValue(undefined);
    const { ctx, options } = attach();
    await expect(options.requestPluginInteraction(args)).resolves.toBe('pending-result');
    expect(ctx.ptyInteractions.hasSession).toHaveBeenCalledWith('sess-1');
    expect(ctx.ptyInteractions.request).not.toHaveBeenCalled();
  });

  it('routes a live PTY session (not a conversation thread) to the PTY drawer with the session id', async () => {
    getConversationThread.mockReturnValue(undefined);
    const { ctx, options } = attach();
    ctx.ptyInteractions.hasSession.mockReturnValue(true);
    await expect(options.requestPluginInteraction(args)).resolves.toBe('pty-result');
    expect(ctx.ptyInteractions.request).toHaveBeenCalledWith({ ...args, sessionId: 'sess-1' });
    expect(ctx.pendingInteractions.requestPluginInteraction).not.toHaveBeenCalled();
  });

  it('interrupts a plugin on both the pending and PTY interaction stores', () => {
    const { ctx, options } = attach();
    options.interruptPluginInteractions('plug');
    expect(ctx.pendingInteractions.interruptPluginInteractions).toHaveBeenCalledWith('plug');
    expect(ctx.ptyInteractions.interruptForPlugin).toHaveBeenCalledWith('plug');
  });
});

describe('attached plugin service: plugin-driven turns are tagged origin system', () => {
  it('sendThread defaults mode to start, tags the turn system, and honours visibility', async () => {
    const { ctx, options } = attach();
    await expect(options.sendThread({ threadId: 't1', prompt: 'hi' })).resolves.toEqual({ id: 'thread-sent' });
    expect(sendConversationTurn).toHaveBeenCalledWith(
      ctx, 't1', [{ type: 'text', text: 'hi', mentions: [] }], 'start', undefined, { origin: 'system' }
    );
    await options.sendThread({ threadId: 't1', prompt: 'hi', visibility: 'hidden', mode: 'queue-if-active' });
    expect(sendConversationTurn).toHaveBeenLastCalledWith(
      ctx, 't1', [{ type: 'text', text: 'hi', mentions: [], visibility: 'hidden' }], 'queue-if-active', undefined, { origin: 'system' }
    );
  });

  it('forkThread tags the fork system and records the originating plugin', async () => {
    const { ctx, options } = attach();
    await expect(options.forkThread({ threadId: 't1', sourceSeqEnd: 3, visibility: 'hidden', agentContextSeed: 'seed', title: 'T', pluginId: 'plug' }))
      .resolves.toEqual({ id: 'thread-forked' });
    expect(forkConversation).toHaveBeenCalledWith(ctx, 't1', expect.objectContaining({ origin: 'system', originPluginId: 'plug', sourceSeqEnd: 3 }));
  });
});
