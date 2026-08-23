import { beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveThread } from './environment-cleanup.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import {
  getEnvironment,
  getThread,
  updateThreadStatus
} from '@zana-ai/zcc-db';

vi.mock('@zana-ai/zcc-db', () => ({
  getThread: vi.fn(),
  getConversationThread: vi.fn(() => null),
  archiveConversationThread: vi.fn(),
  updateThreadStatus: vi.fn(),
  countLiveThreadsForEnvironment: vi.fn(() => 0),
  getEnvironment: vi.fn(() => null),
  updateEnvironmentStatus: vi.fn()
}));

const thread = {
  id: 'thr-1',
  projectId: 'proj-1',
  hostId: 'host-1',
  environmentId: 'env-1',
  providerId: 'claude',
  status: 'running' as const,
  title: 'Hello',
  createdAt: 1,
  updatedAt: 1
};

beforeEach(() => {
  vi.mocked(getThread).mockReset();
  vi.mocked(updateThreadStatus).mockReset();
  vi.mocked(getEnvironment).mockReset().mockReturnValue(null);
});

describe('archiveThread', () => {
  it('marks the thread completed before stop, even when the host throws', async () => {
    const order: string[] = [];
    vi.mocked(getThread).mockReturnValue(thread);
    vi.mocked(updateThreadStatus).mockImplementation((_db, id, status) => {
      order.push('complete');
      return { ...thread, id, status };
    });
    const emit = vi.fn();
    const callHostOnlineRpc = vi.fn(async () => {
      order.push('stop');
      throw new Error('host down');
    });
    const ctx = {
      db: {},
      hub: { emit },
      hostHub: { callHostOnlineRpc }
    } as unknown as ProductHttpContext;

    expect(await archiveThread(ctx, thread.id)).toBe(true);
    expect(order).toEqual(['complete', 'stop']);
    expect(updateThreadStatus).toHaveBeenCalledWith(ctx.db, thread.id, 'completed');
    expect(emit).toHaveBeenCalledWith(
      'threads:updated',
      expect.objectContaining({ id: thread.id, status: 'completed' })
    );
    expect(callHostOnlineRpc).toHaveBeenCalledWith({
      hostId: thread.hostId,
      command: { type: 'thread.stop', threadId: thread.id }
    });
  });

  it('returns false for an unknown thread without calling the host', async () => {
    vi.mocked(getThread).mockReturnValue(null);
    const callHostOnlineRpc = vi.fn();
    const ctx = {
      db: {},
      hub: { emit: vi.fn() },
      hostHub: { callHostOnlineRpc }
    } as unknown as ProductHttpContext;

    expect(await archiveThread(ctx, 'missing')).toBe(false);
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
    expect(updateThreadStatus).not.toHaveBeenCalled();
  });
});
