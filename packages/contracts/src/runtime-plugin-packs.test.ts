import { describe, expect, it } from 'vitest';
import { SERVER_RUNTIME_PROTOCOL_VERSION, ServerRuntimeInboundSchema } from './runtime.js';

const base = { type: 'request', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
  id: '00000000-0000-4000-8000-000000000001', deadlineAt: '2026-10-27T12:00:00.000Z' };
const identity = { marketplaceSource: 'https://catalog.test/marketplace.json', packId: 'essentials' };

describe('plugin pack runtime request contracts', () => {
  it('accepts bounded identities and host-issued install-plan references', () => {
    for (const operation of ['plugin-packs-list', 'plugin-packs-installed']) {
      expect(ServerRuntimeInboundSchema.safeParse({ ...base, operation }).success).toBe(true);
    }
    for (const operation of ['plugin-packs-plan', 'plugin-packs-forget']) {
      expect(ServerRuntimeInboundSchema.safeParse({ ...base, operation, identity }).success).toBe(true);
    }
    expect(ServerRuntimeInboundSchema.safeParse({ ...base, operation: 'plugin-packs-install', request: {
      identity, planId: base.id, pluginIds: ['tools']
    } }).success).toBe(true);
  });

  it('refuses arbitrary sources, forged request fields and unbounded selections', () => {
    const request = { identity, planId: base.id, pluginIds: ['tools'] };
    for (const patch of [
      { request: { ...request, entries: [{ source: '/private' }] } },
      { request: { ...request, identity: { ...identity, hostId: 'other' } } },
      { request: { ...request, pluginIds: Array.from({ length: 33 }, (_, i) => `plugin-${i}`) } },
      { request: { ...request, pluginIds: ['tools', 'tools'] } },
      { request: { ...request, planId: 'invented' } },
      { request, identity }
    ]) expect(ServerRuntimeInboundSchema.safeParse({ ...base, operation: 'plugin-packs-install', ...patch }).success).toBe(false);
  });
});
