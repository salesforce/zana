import { expect, it } from 'vitest';
import { SERVER_RUNTIME_PROTOCOL_VERSION, ServerRuntimeInboundSchema, RuntimeOutboundSchema } from './runtime';
const base = { type: 'request', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
  id: '00000000-0000-4000-8000-000000000001', deadlineAt: '2026-10-30T12:00:00.000Z', operation: 'plugins-repair', pluginId: 'example' };
it('accepts main-owned location repairs or an official source resolved by the server', () => {
  expect(ServerRuntimeInboundSchema.safeParse(base).success).toBe(true);
  expect(ServerRuntimeInboundSchema.safeParse({ ...base, path: '/home/example/plugin' }).success).toBe(true);
});
it.each([{ source: 'git:https://untrusted.test/plugin' }, { path: '' }, { path: 'x'.repeat(4097) }, { pluginId: '' }])('rejects untrusted source fields and unbounded recovery inputs', patch => {
  expect(ServerRuntimeInboundSchema.safeParse({ ...base, ...patch }).success).toBe(false);
});
it('keeps the host-derived recovery choices in runtime plugin snapshots', () => {
  const event = { type: 'plugin-apps-changed', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, apps: [{
    id: 'example', name: 'Example', description: '', icon: 'Box', enabled: true, provenance: 'direct', sourceKind: 'path',
    status: 'degraded', appUrl: null, sourceRecovery: { canLocate: true, canSwitchOfficial: false }
  }] };
  expect(RuntimeOutboundSchema.parse(event)).toMatchObject({ apps: [{ sourceRecovery: { canLocate: true, canSwitchOfficial: false } }] });
});
