import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { experimental_createHostEntryHarness } from '@zana-ai/zcc-plugin-sdk/testing/host';
import entry from './host.js';

const { resolveRoots, probeAgent } = vi.hoisted(() => ({
  resolveRoots: vi.fn(),
  probeAgent: vi.fn(),
}));
vi.mock('./native-roots/index.js', () => ({ resolveAcpNativeRoots: resolveRoots }));
vi.mock('./bridge/bridge.js', () => ({ experimental_providerBridge: {} }));
vi.mock('@zana-ai/zcc-plugin-sdk/provider-bridge/acp', async (importOriginal) => ({
  ...await importOriginal<typeof import('@zana-ai/zcc-plugin-sdk/provider-bridge/acp')>(),
  experimental_probeAcpAgent: probeAgent,
}));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('resolves native roots with the selected agent, project and execution-host environment', async () => {
  vi.stubEnv('XDG_CONFIG_HOME', '/host/custom-config');
  const roots = { skills: [{ path: '/host/custom-config/skills', origin: 'user', shape: 'skills' }], commands: [] };
  resolveRoots.mockResolvedValue(roots);
  const harness = experimental_createHostEntryHarness(entry);
  try {
    expect(await harness.experimental_call('resolveNativeRoots', { providerId: 'acp-opencode', cwd: '/project' })).toMatchObject(roots);
    expect(resolveRoots).toHaveBeenCalledWith({ agentId: 'acp-opencode', cwd: '/project', homeDir: os.homedir(), env: process.env });
    expect(resolveRoots.mock.calls[0][0].env.XDG_CONFIG_HOME).toBe('/host/custom-config');
    resolveRoots.mockRejectedValue(new Error('Native registry unreadable'));
    await expect(harness.experimental_call('resolveNativeRoots', { providerId: 'acp-cursor', cwd: null })).rejects.toThrow('Native registry unreadable');
    expect(resolveRoots).toHaveBeenLastCalledWith({ agentId: 'acp-cursor', cwd: null, homeDir: os.homedir(), env: process.env });
  } finally { await harness.experimental_dispose(); }
});

it('keeps agent probes in the host-owned temporary directory and propagates failures', async () => {
  const input = { command: 'probe-cli', args: ['--acp'], env: { NATIVE_PROBE: 'on' } };
  probeAgent.mockResolvedValue({ reachable: true, fork: false });
  const harness = experimental_createHostEntryHarness(entry, { experimental_paths: { dataDir: '/isolated/plugin-data', tempDir: '/isolated/plugin-temp' } });
  try {
    expect(await harness.experimental_call('probeAgent', input)).toEqual({ reachable: true, fork: false });
    expect(probeAgent).toHaveBeenCalledWith({ ...input, cwd: '/isolated/plugin-temp' });
    probeAgent.mockResolvedValue({ reachable: false, reason: 'Agent unavailable' });
    expect(await harness.experimental_call('probeAgent', input)).toEqual({ reachable: false, reason: 'Agent unavailable' });
    probeAgent.mockRejectedValue(new Error('Probe failed'));
    await expect(harness.experimental_call('probeAgent', input)).rejects.toThrow('Probe failed');
  } finally { await harness.experimental_dispose(); }
});
