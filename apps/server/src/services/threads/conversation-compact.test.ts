import { describe, expect, it, vi } from 'vitest';

vi.mock('./conversation-lifecycle.js', () => ({
  sendConversationTurn: vi.fn(async () => ({ id: 'thr-1' }))
}));
vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn()
}));
vi.mock('./thread-provider-catalog.js', () => ({
  getThreadProvider: vi.fn()
}));

import { getConversationThread } from '@zana-ai/zcc-db';
import { compactConversation } from './conversation-compact.js';
import { sendConversationTurn } from './conversation-lifecycle.js';
import { getThreadProvider } from './thread-provider-catalog.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import type { ProductHttpContext } from '../../http/product-context.js';

describe('compactConversation', () => {
  it('sends the built-in compact command when idle and supported', async () => {
    vi.mocked(getConversationThread).mockReturnValue({
      id: 'thr-1',
      status: 'idle',
      providerId: 'claude-code'
    } as never);
    vi.mocked(getThreadProvider).mockReturnValue({
      capabilities: { supportsManualCompaction: true }
    } as never);
    await expect(compactConversation({ db: {} } as ProductHttpContext, 'thr-1')).resolves.toEqual({ ok: true });
    expect(sendConversationTurn).toHaveBeenCalledWith(
      expect.anything(),
      'thr-1',
      expect.any(Array),
      'start',
      undefined,
      { compact: true }
    );
  });

  it('rejects compact while the thread is active', async () => {
    vi.mocked(getConversationThread).mockReturnValue({
      id: 'thr-1',
      status: 'active',
      providerId: 'claude-code'
    } as never);
    await expect(compactConversation({ db: {} } as ProductHttpContext, 'thr-1')).rejects.toMatchObject({
      status: 409,
      code: 'not_idle'
    } as Partial<ThreadCreateError>);
  });
});
