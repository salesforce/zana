import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { experimental_createHostEntryHarness } from '@zana-ai/zcc-plugin-sdk/testing/host';
import entry from './host.js';

const { usage, resolveRoots } = vi.hoisted(() => ({ usage: vi.fn(), resolveRoots: vi.fn() }));
vi.mock('./bridge/provider-maintenance.js', () => ({ getClaudeProviderUsage: usage }));
vi.mock('./native-roots.js', () => ({ resolveClaudeNativeRoots: resolveRoots }));
vi.mock('./bridge/bridge.js', () => ({ experimental_providerBridge: {} }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('routes native roots and usage through the execution host and validates usage results', async () => {
  vi.stubEnv('CLAUDE_CONFIG_DIR', '/host/custom-claude');
  const roots = { skills: [], commands: [] };
  resolveRoots.mockResolvedValue(roots);
  const harness = experimental_createHostEntryHarness(entry);
  try {
    expect(await harness.experimental_call('resolveNativeRoots', { providerId: 'claude-code', cwd: '/project' })).toEqual(roots);
    expect(resolveRoots).toHaveBeenCalledWith({ cwd: '/project', homeDir: os.homedir(), env: process.env });
    usage.mockResolvedValue({ supported: true, usage: { status: 'unauthenticated' } });
    expect(await harness.experimental_call('providerUsage', {})).toEqual({ supported: true, usage: { status: 'unauthenticated' } });
    usage.mockResolvedValue({ supported: true, usage: { status: 'unknown' } });
    await expect(harness.experimental_call('providerUsage', {})).rejects.toThrow();
    usage.mockRejectedValue(new Error('Usage unavailable'));
    await expect(harness.experimental_call('providerUsage', {})).rejects.toThrow('Usage unavailable');
  } finally { await harness.experimental_dispose(); }
});
