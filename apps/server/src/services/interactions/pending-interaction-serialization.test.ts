import { describe, expect, it } from 'vitest';
import type { PendingInteractionRow } from '@zana-ai/zcc-db';
import { PendingInteractionSerializationError, toPendingInteraction } from './pending-interaction-serialization.js';

function providerRow(overrides?: Partial<PendingInteractionRow>): PendingInteractionRow {
  return {
    id: 'pint_1',
    threadId: 'thr-1',
    originKind: 'provider',
    turnId: 'turn-1',
    providerId: 'claude-code',
    providerThreadId: 'prov-1',
    providerRequestId: 'req-1',
    pluginId: null,
    rendererId: null,
    status: 'pending',
    payload: JSON.stringify({
      kind: 'approval',
      reason: 'Needs approval',
      availableDecisions: ['deny'],
      subject: {
        kind: 'command',
        itemId: 'item-1',
        command: 'ls',
        cwd: '/tmp',
        actions: [],
        sessionGrant: null
      }
    }),
    resolution: null,
    statusReason: null,
    createdAt: 1,
    expiresAt: null,
    resolvedAt: null,
    updatedAt: 1,
    ...overrides
  };
}

describe('toPendingInteraction', () => {
  it('hydrates a provider row and a plugin row', () => {
    const provider = toPendingInteraction(providerRow());
    expect(provider.origin.kind).toBe('provider');
    expect(provider.payload.kind).toBe('approval');
    const plugin = toPendingInteraction(providerRow({
      originKind: 'plugin',
      turnId: null,
      providerId: null,
      providerThreadId: null,
      providerRequestId: null,
      pluginId: 'ask-user',
      rendererId: 'form',
      payload: JSON.stringify({ kind: 'plugin', title: 'Ask', data: { n: 1 } })
    }));
    expect(plugin.origin.kind).toBe('plugin');
    expect(plugin.payload.kind).toBe('plugin');
  });

  it('throws when payload or resolution JSON is invalid', () => {
    expect(() => toPendingInteraction(providerRow({ payload: '{' }))).toThrow(PendingInteractionSerializationError);
    expect(() => toPendingInteraction(providerRow({ payload: JSON.stringify({ kind: 'nope' }) }))).toThrow(
      PendingInteractionSerializationError
    );
    expect(() => toPendingInteraction(providerRow({ resolution: '{' }))).toThrow(PendingInteractionSerializationError);
  });
});
