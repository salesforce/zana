import { describe, expect, it } from 'vitest';
import { createConversationFromRequest } from './conversation-create.js';
import type { ProductHttpContext } from '../../http/context.js';

const ctx = {} as ProductHttpContext;
const base = { projectId: '', providerId: 'p', input: ['x'] } as never as Parameters<typeof createConversationFromRequest>[1];
const withOrigin = (originPluginId: string) => ({ ...base, originPluginId }) as typeof base;
const authorized = { source: 'main-authorized' as const, projectId: '' };

describe('createConversationFromRequest reserved origin plugin ids', () => {
  it.each(['host-modern-squad', '.host-modern-squad', '.anything', '.'])(
    'rejects %s without authorizedContext',
    async (id) => {
      await expect(createConversationFromRequest(ctx, withOrigin(id))).rejects.toMatchObject({
        status: 403,
        code: 'invalid-authorized-context'
      });
    }
  );

  it.each(['host-modern-squad', '.host-modern-squad'])('%s passes the reserved-id guard with authorizedContext', async (id) => {
    await expect(createConversationFromRequest(ctx, withOrigin(id), authorized)).rejects.toMatchObject({ code: 'invalid-project' });
  });

  it.each(['my-plugin', 'slack-bridge-2ff2'])('still accepts normal plugin id %s', async (id) => {
    await expect(createConversationFromRequest(ctx, withOrigin(id))).rejects.toMatchObject({ code: 'invalid-project' });
  });

  it('rejects a mismatched authorizedContext project', async () => {
    await expect(createConversationFromRequest(ctx, withOrigin('x'), { ...authorized, projectId: 'other' })).rejects.toMatchObject({
      status: 403, code: 'invalid-authorized-context'
    });
  });
});
