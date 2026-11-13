import { describe, expect, it, vi } from 'vitest';

const captured: { factory?: (id: string, options: Record<string, unknown>) => { process: { command: string; args: string[]; env?: Record<string, string> }; capabilities: Record<string, unknown> } } = {};

vi.mock('@zana-ai/zcc-agent-runtime/test', () => ({
  fakeProviderScriptPath: '/fake/script.ts',
  createFakeAdapter: () => ({ process: { command: 'node', args: ['/fake/script.ts'] }, capabilities: { supportsServiceTier: false } }),
  createAgentRuntimeWithAdapters: (options: { adapterFactory: typeof captured.factory }) => {
    captured.factory = options.adapterFactory;
    return {};
  }
}));

const { createFakeAgentRuntime, fakeProviderEnabled } = await import('./fake-runtime.js');

describe('fake agent runtime', () => {
  it('is enabled by either environment switch', () => {
    expect(fakeProviderEnabled({ ZCC_FAKE_PROVIDER: '1' })).toBe(true);
    expect(fakeProviderEnabled({ ZCC_AGENT_RUNTIME_ADAPTER: 'fake' })).toBe(true);
    expect(fakeProviderEnabled({})).toBe(false);
  });

  it('runs the fake script with the runtime node executable and env', () => {
    createFakeAgentRuntime({} as never);
    const adapter = captured.factory!('fake', {
      additionalWorkspaceWriteRoots: [],
      bridgeNodeExecutablePath: 'C:\\Zana\\Zana.exe',
      bridgeNodeEnv: { ELECTRON_RUN_AS_NODE: '1' }
    });
    expect(adapter.process).toEqual({
      command: 'C:\\Zana\\Zana.exe',
      args: ['/fake/script.ts'],
      env: { ELECTRON_RUN_AS_NODE: '1' }
    });
    expect(adapter.capabilities.supportsServiceTier).toBe(true);
  });

  it('falls back to the adapter command without a runtime executable', () => {
    createFakeAgentRuntime({} as never);
    const adapter = captured.factory!('fake', { additionalWorkspaceWriteRoots: [] });
    expect(adapter.process).toEqual({ command: 'node', args: ['/fake/script.ts'] });
  });
});
