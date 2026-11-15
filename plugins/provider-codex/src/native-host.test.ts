import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { experimental_createHostEntryHarness } from '@zana-ai/zcc-plugin-sdk/testing/host';
import entry from './native-host.js';

const resolveRoots = vi.hoisted(() => vi.fn());
const usage = vi.hoisted(() => vi.fn());
vi.mock('./bridge/provider-maintenance.js', () => ({getCodexProviderUsage:usage}));
vi.mock('./native-roots.js', () => ({ resolveCodexNativeRoots: resolveRoots }));
vi.mock('./bridge/bridge.js', () => ({ experimental_providerBridge: {} }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('resolves the catalogue using the execution host home and environment through its validated host entry', async () => {
  vi.stubEnv('CODEX_HOME', '/host/custom-codex');
  const roots = { skills: [{ path: '/host/custom-codex/skills', origin: 'user', shape: 'skills' }], commands: [] };
  resolveRoots.mockResolvedValue(roots);
  const harness = experimental_createHostEntryHarness(entry);
  try {
    expect(await harness.experimental_call('resolveNativeRoots', { providerId: 'codex', cwd: '/project' })).toMatchObject(roots);
    expect(resolveRoots).toHaveBeenCalledWith({ homeDir: os.homedir(), env: process.env });
    expect(resolveRoots.mock.calls[0][0].env.CODEX_HOME).toBe('/host/custom-codex');
    resolveRoots.mockRejectedValue(new Error('Native registry unreadable'));
    await expect(harness.experimental_call('resolveNativeRoots', { providerId: 'codex', cwd: null })).rejects.toThrow('Native registry unreadable');
  } finally { await harness.experimental_dispose(); }
});

it('reads usage on the execution host and validates the response', async () => {
  const harness = experimental_createHostEntryHarness(entry);
  try {
    usage.mockResolvedValue({supported:true,usage:{status:'unauthenticated'}});
    expect(await harness.experimental_call('providerUsage', {})).toEqual({supported:true,usage:{status:'unauthenticated'}});
    usage.mockResolvedValue({supported:true,usage:{status:'unknown'}});
    await expect(harness.experimental_call('providerUsage', {})).rejects.toThrow();
  } finally { await harness.experimental_dispose(); }
});
