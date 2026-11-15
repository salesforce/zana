import { expect, it } from 'vitest';
import { HostRpcCommandSchema, MachineEnvironmentSaveSchema, MachineEnvironmentSettingsSchema, parseHostRpcResult } from './host-rpc.js';
it('validates the full host-RPC boundary for saved settings and strips secrets on responses', () => {
  const patch = { name: 'EXAMPLE_API_KEY', value: 'fixture-key', expectedRevision: 'revision' };
  expect(HostRpcCommandSchema.parse({ type: 'host.environment.save', ...patch })).toEqual({ type: 'host.environment.save', ...patch });
  expect(HostRpcCommandSchema.parse({ type: 'host.environment.settings' })).toEqual({ type: 'host.environment.settings' });
  const result = { revision: 'revision', variables: [{ name: 'KEY', overriddenByEnvironment: true, value: 'secret' }], token: 'secret' };
  for (const type of ['host.environment.settings', 'host.environment.save'] as const) expect(parseHostRpcResult(type, result)).toEqual({ revision: 'revision', variables: [{ name: 'KEY', overriddenByEnvironment: true }] });
  expect(MachineEnvironmentSettingsSchema.safeParse({ ...result, variables: Array(129).fill(result.variables[0]) }).success).toBe(false);
  for (const bad of [{ ...patch, name: 'HOME' }, { ...patch, name: 'NODE_OPTIONS' }, { ...patch, cwd: '/escape' }, { ...patch, value: '\0' }, { ...patch, value: 'x'.repeat(8193) }, { ...patch, name: 'GIT_CONFIG_KEY_0', value: 'core.sshCommand' }]) expect(MachineEnvironmentSaveSchema.safeParse(bad).success).toBe(false);
  expect(MachineEnvironmentSaveSchema.safeParse({ ...patch, value: null }).success).toBe(true);
});
