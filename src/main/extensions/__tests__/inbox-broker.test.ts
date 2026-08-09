import { describe, it, expect } from 'vitest';
import { pushInboxOnBehalfOf, type InboxBrokerDeps } from '../inbox-broker.js';
import type { InboxEntry, InboxInput } from '../../inbox-store.js';

/**
 * Direct unit coverage for `pushInboxOnBehalfOf`'s `target` trust chain — the
 * cases `broker-caps.test.ts` can't reach because it always calls through with
 * an authenticated `extensionSource`. This file covers the renderer-panel
 * path shape (no `extensionSource`), which must reject a `target` outright.
 */
function makeDeps(knownProjectIds: string[] = ['proj-1']) {
  const appended: InboxInput[] = [];
  const deps: InboxBrokerDeps = {
    projectExists: (id) => knownProjectIds.includes(id),
    inboxStore: {
      append: async (input: InboxInput): Promise<InboxEntry> => {
        appended.push(input);
        return { ...input, id: 'entry-1', ts: 0 };
      }
    }
  };
  return { deps, appended };
}

describe('pushInboxOnBehalfOf — target trust chain', () => {
  it('rejects a `target` when the caller has no authenticated extensionSource (renderer-panel path)', async () => {
    const { deps, appended } = makeDeps();

    await expect(
      pushInboxOnBehalfOf(deps, 'claimed-id', {
        projectId: 'proj-1',
        comments: 'hi',
        target: { moduleId: 'claimed-id' }
      })
    ).rejects.toThrow(/target requires an authenticated extension origin/);
    expect(appended).toHaveLength(0);
  });

  it('rejects a `target` naming a different module than the authenticated extensionSource', async () => {
    const { deps, appended } = makeDeps();

    await expect(
      pushInboxOnBehalfOf(
        deps,
        'ext-a',
        { projectId: 'proj-1', comments: 'hi', target: { moduleId: 'ext-b' } },
        { extensionSource: { extensionId: 'ext-a' } }
      )
    ).rejects.toThrow(/target\.moduleId must be the pushing extension's own id/);
    expect(appended).toHaveLength(0);
  });

  it('accepts and persists a self-targeting `target` alongside a matching extensionSource', async () => {
    const { deps, appended } = makeDeps();

    const res = await pushInboxOnBehalfOf(
      deps,
      'ext-a',
      { projectId: 'proj-1', comments: 'hi', target: { moduleId: 'ext-a' } },
      { extensionSource: { extensionId: 'ext-a' } }
    );

    expect(res).toEqual({ id: 'entry-1' });
    expect(appended).toEqual([
      {
        projectId: 'proj-1',
        comments: 'hi',
        docs: undefined,
        target: { moduleId: 'ext-a' },
        extensionSource: { extensionId: 'ext-a' }
      }
    ]);
  });

  it('omits `target` entirely when the push does not carry one', async () => {
    const { deps, appended } = makeDeps();

    await pushInboxOnBehalfOf(
      deps,
      'ext-a',
      { projectId: 'proj-1', comments: 'hi' },
      { extensionSource: { extensionId: 'ext-a' } }
    );

    expect(appended[0]).not.toHaveProperty('target');
  });
});
