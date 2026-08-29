import { describe, expect, it, vi } from 'vitest';
import { resolvePersonalTargetPathOnHost } from './host-personal-path.js';
import type { ProductHttpContext } from '../../http/product-context.js';

describe('resolvePersonalTargetPathOnHost', () => {
  it('asks the execution host for clone_default_path and places personal scratch there', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({
      path: '/home/sfwork/.zcc-machines/app/checkouts/zcc'
    }));
    const ctx = { hostHub: { callHostOnlineRpc } } as unknown as ProductHttpContext;
    await expect(resolvePersonalTargetPathOnHost(ctx, 'host-b', 'env-1'))
      .resolves.toBe('/home/sfwork/.zcc-machines/app/personal-workspaces/env-1');
    expect(callHostOnlineRpc).toHaveBeenCalledWith({
      hostId: 'host-b',
      command: { type: 'project.clone_default_path', projectSlug: 'zcc' }
    });
  });
});
