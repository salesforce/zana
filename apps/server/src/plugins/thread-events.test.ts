import { describe, expect, it, vi } from 'vitest';
import { emitPluginThreadEvent } from './thread-events.js';
import type { ProductHttpContext } from '../http/product-context.js';

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
});
