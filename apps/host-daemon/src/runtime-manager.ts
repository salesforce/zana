import type { HostEventEnvelope } from '@zana-ai/zcc-contracts/host-rpc';
import {
  createAgentRuntimeAdapter,
  type CreateAgentRuntimeFn
} from './agent-runtime-adapter.js';
import type { ThreadRuntimeAdapter } from './thread-runtime-types.js';

export type { ThreadRuntimeAdapter } from './thread-runtime-types.js';

/**
 * Host-side AgentRuntime manager. Lives beside PtyManager: this path owns
 * thread.start / turn.submit / thread.stop / thread.resume. It never imports
 * PtyManager, LaunchProvider, or HARNESS_REGISTRATIONS.
 */
export function createRuntimeManager(options: {
  emit: (event: HostEventEnvelope) => void;
  dataDir?: string;
  createRuntime?: CreateAgentRuntimeFn;
}): ThreadRuntimeAdapter {
  return createAgentRuntimeAdapter(options);
}
