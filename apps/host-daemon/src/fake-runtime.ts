import type { AgentRuntime, AgentRuntimeOptions } from '@zana-ai/zcc-agent-runtime';
import {
  createAgentRuntimeWithAdapters,
  createFakeAdapter,
  fakeProviderScriptPath
} from '@zana-ai/zcc-agent-runtime/test';

export function fakeProviderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ZCC_FAKE_PROVIDER === '1' || env.ZCC_AGENT_RUNTIME_ADAPTER === 'fake';
}

export function createFakeAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  return createAgentRuntimeWithAdapters({
    ...options,
    adapterFactory: (_providerId, adapterOptions) => {
      const adapter = createFakeAdapter({ scriptPath: fakeProviderScriptPath });
      // Run the script with the runtime's own Node, like real bridges: a
      // packaged app has no `node` on PATH (spawn node ENOENT on Windows).
      const command = adapterOptions.bridgeNodeExecutablePath ?? adapter.process.command;
      const env = adapterOptions.bridgeNodeEnv;
      return {
        ...adapter,
        process: { ...adapter.process, command, ...(env ? { env: { ...adapter.process.env, ...env } } : {}) },
        capabilities: { ...adapter.capabilities, supportsServiceTier: true }
      };
    }
  });
}
