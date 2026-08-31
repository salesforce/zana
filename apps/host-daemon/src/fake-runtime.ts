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
    adapterFactory: () => createFakeAdapter({ scriptPath: fakeProviderScriptPath })
  });
}
