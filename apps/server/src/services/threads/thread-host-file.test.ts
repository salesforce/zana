import { describe, expect, it, vi } from 'vitest';
import { ThreadCreateError } from '../../http/thread-create.js';
import { ProjectFsError } from '../../http/project-fs-via-host.js';

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn(),
  getEnvironment: vi.fn()
}));

import { getConversationThread, getEnvironment } from '@zana-ai/zcc-db';
import { readThreadHostFile } from './thread-host-file.js';
import type { ProductHttpContext } from '../../http/product-context.js';

describe('readThreadHostFile', () => {
  it('404s for an unknown thread', async () => {
    vi.mocked(getConversationThread).mockReturnValueOnce(null);
    await expect(readThreadHostFile({ db: {} } as ProductHttpContext, 'missing', 'README.md'))
      .rejects.toBeInstanceOf(ThreadCreateError);
  });

  it('rejects paths outside the environment root', async () => {
    vi.mocked(getConversationThread).mockReturnValueOnce({
      id: 't1',
      environmentId: 'e1',
      hostId: 'h1'
    } as never);
    vi.mocked(getEnvironment).mockReturnValueOnce({ path: '/tmp/env' } as never);
    await expect(readThreadHostFile({ db: {} } as ProductHttpContext, 't1', '../secret'))
      .rejects.toBeInstanceOf(ProjectFsError);
  });

  it('409s when the environment is not ready', async () => {
    vi.mocked(getConversationThread).mockReturnValueOnce({
      id: 't1',
      environmentId: 'e1',
      hostId: 'h1'
    } as never);
    vi.mocked(getEnvironment).mockReturnValueOnce({ path: null } as never);
    await expect(readThreadHostFile({ db: {} } as ProductHttpContext, 't1', 'README.md'))
      .rejects.toBeInstanceOf(ThreadCreateError);
  });

  it('maps host path_not_found and too_large errors', async () => {
    vi.mocked(getConversationThread).mockReturnValue({
      id: 't1',
      environmentId: 'e1',
      hostId: 'h1'
    } as never);
    vi.mocked(getEnvironment).mockReturnValue({ path: '/tmp/env' } as never);
    const missing = {
      db: {},
      hostHub: {
        callHostOnlineRpc: vi.fn(async () => {
          throw { code: 'path_not_found' };
        })
      }
    } as unknown as ProductHttpContext;
    await expect(readThreadHostFile(missing, 't1', 'gone.ts')).rejects.toBeInstanceOf(ProjectFsError);
    const huge = {
      db: {},
      hostHub: {
        callHostOnlineRpc: vi.fn(async () => {
          throw { code: 'too_large' };
        })
      }
    } as unknown as ProductHttpContext;
    await expect(readThreadHostFile(huge, 't1', 'big.bin')).rejects.toBeInstanceOf(ProjectFsError);
  });

  it('reads a confined file through the host', async () => {
    vi.mocked(getConversationThread).mockReturnValueOnce({
      id: 't1',
      environmentId: 'e1',
      hostId: 'h1'
    } as never);
    vi.mocked(getEnvironment).mockReturnValueOnce({ path: '/tmp/env' } as never);
    const ctx = {
      db: {},
      hostHub: {
        callHostOnlineRpc: vi.fn(async () => ({ content: '<svg />', encoding: 'utf8' }))
      }
    } as unknown as ProductHttpContext;
    const file = await readThreadHostFile(ctx, 't1', 'logo.svg');
    expect(file.relPath).toBe('logo.svg');
    expect(file.contentType).toBe('image/svg+xml');
    expect(file.content).toContain('svg');
  });
});
