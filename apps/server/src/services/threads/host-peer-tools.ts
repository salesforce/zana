import { z } from 'zod';
import type { DynamicTool, ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';
import { peerToolNames, peerToolSchemas, HOST_PEER_INSTRUCTION, type PeerToolName } from '../agents/peer-tool-contract.js';
import { pluginToolResultToResponse } from '../../plugins/plugin-agent-tools.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { invokeThreadPeerTool, threadPeerCaller } from './thread-peer-communication.js';

export { HOST_PEER_INSTRUCTION };
const descriptions: Record<PeerToolName, string> = {
  register_agent: 'Choose a stable handle and optional role/capabilities so peers can find this thread. Host assigns identity; duplicate handles are suffixed.',
  list_agents: 'List available peer threads and CLI Agents with id, title, stable handle, role, capabilities, and status. Same-project only; cross-project requests are rejected. Returns at most 200 peers. Hidden automation threads are excluded.',
  find_agent: 'Find peer threads or CLI Agents by exact handle, title, sessionId, role, or capability. Same-project only; cross-project requests are rejected.',
  agent_send: 'Submit a message for user review by sessionId, stable handle, or unique title. Same-project only. Returns awaiting-review; no recipient model or mailbox sees the body until the user delivers it. Never retry an accepted submission.',
  agent_inbox: 'Read this thread’s recent received peer messages, oldest first, and mark them read. Optional since is a previously seen message id. Only user-reviewed messages that reached the recipient are returned. Reading does not re-deliver a turn. Returns at most 50 messages.'
};
const labels: Record<PeerToolName, string> = {
  register_agent: 'Register peer handle', list_agents: 'List peers', find_agent: 'Find peer', agent_send: 'Send peer message', agent_inbox: 'Read peer messages'
};
export const HOST_PEER_TOOLS: DynamicTool[] = peerToolNames.map(name => ({
  name, description: descriptions[name], inputSchema: z.toJSONSchema(peerToolSchemas[name]),
  presentation: { label: { pending: labels[name], completed: labels[name] }, icon: { glyph: name === 'agent_send' ? 'Send' : 'Users' } }
}));

export async function invokeHostPeerTool(
  ctx: ProductHttpContext,
  args: { name: PeerToolName; threadId: string; input: unknown }
): Promise<ToolCallResponse> {
  try {
    const result = await invokeThreadPeerTool(ctx, threadPeerCaller(ctx, args.threadId), args.name, args.input);
    return pluginToolResultToResponse(args.name, result);
  } catch (error) {
    return pluginToolResultToResponse(args.name, { ok: false, error: error instanceof Error ? error.message : 'Peer communication failed' });
  }
}
