import type { CliPeerSend } from '@zana-ai/zcc-server/http/cli-agent-ops';
import type { IAgentRegistryStore } from '@zana-ai/zcc-server/services/agents/agent-registry-store';
import type { IAgentMessageLog } from '@zana-ai/zcc-server/services/agents/agent-message-log';
import { agentLabel } from '@zana-ai/zcc-server/services/agents/agent-registry-store';
import { isRestfulAgentState, type AgentState } from '@zana-ai/zcc-domain/product';

export function createCliPeerDelivery(deps: {
  registry: IAgentRegistryStore; log: IAgentMessageLog;
  status(id: string): AgentState; inject(id: string, message: string): boolean;
  enabled(): boolean; generation(): number;
}) {
  return (input: CliPeerSend) => {
    if (!deps.enabled() || input.generation !== deps.generation()) return { ok: false as const, error: 'Thread communication was disabled or changed. Review again.' };
    const target = deps.registry.get(input.to);
    if (!target || target.projectId !== input.projectId || target.teamLaunchId) {
      return { ok: false as const, error: 'CLI Agent is no longer available in this project' };
    }
    if (target.sessionId === input.fromSessionId) return { ok: false as const, error: 'Cannot message yourself' };
    // Busy CLI sessions remain in the durable review store. Do not expose an
    // undelivered body through the legacy mailbox after Stop or flag changes.
    if (!isRestfulAgentState(deps.status(target.sessionId))) return { ok: false as const, error: 'CLI recipient is busy. Deliver again when it is idle.' };
    let delivered = false;
    try { delivered = isRestfulAgentState(deps.status(target.sessionId)) && deps.inject(target.sessionId, input.message); }
    catch { /* The server's durable review retains this message. */ }
    if (!delivered) return { ok: false as const, error: 'CLI recipient did not accept delivery.' };
    const message = deps.log.append({ fromSessionId: input.fromSessionId, fromHandle: input.fromHandle,
      toSessionId: target.sessionId, toHandle: agentLabel(target), projectId: input.projectId, body: input.message,
      deliveredAt: Date.now() });
    return { ok: true as const, id: message.id, delivered };
  };
}
