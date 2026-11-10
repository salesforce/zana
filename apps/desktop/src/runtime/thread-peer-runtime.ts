import type { AppConfig, AgentState } from '@zana-ai/zcc-domain/product';
import type { IAgentRegistryStore } from '@zana-ai/zcc-server/services/agents/agent-registry-store';
import type { IAgentMessageLog } from '@zana-ai/zcc-server/services/agents/agent-message-log';
import { agentLabel } from '@zana-ai/zcc-server/services/agents/agent-registry-store';
import { peerMessageHops } from '@zana-ai/zcc-server/services/agents/peer-tool-contract';
import { createThreadPeerTools } from './thread-peer-tools.js';
import { createCliPeerDelivery } from './cli-peer-delivery.js';

/** Main owns live session identity, squad exclusion and current delivery consent. */
export function createThreadPeerRuntime(deps: {
  serverUrl(): string; credential(): string; fetch?: typeof fetch;
  store: { getConfig(): Pick<AppConfig, 'threadCommunicationEnabled' | 'threadCommunicationGeneration'> };
  ptys: { getSession(id: string): { projectId: string; title?: string } | null | undefined; reply(id: string, message: string): boolean };
  teamLaunchSessions: ReadonlyMap<string, unknown>;
  registry: IAgentRegistryStore; log: IAgentMessageLog;
  agentStatus: { get(id: string): AgentState }; wrapUpClose: { isWrappingUp(id: string): boolean };
}) {
  return {
    threadPeerTools: createThreadPeerTools({ serverUrl: deps.serverUrl, credential: deps.credential, fetch: deps.fetch,
      caller: sessionId => {
        const session = deps.ptys.getSession(sessionId);
        if (!session || deps.teamLaunchSessions.has(sessionId)) return null;
        const record = deps.registry.get(sessionId);
        const lastMessage = deps.log.history().filter(message => message.toSessionId === sessionId).at(-1);
        return { sessionId, projectId: session.projectId, kind: 'cli-agent',
          displayName: (record ? agentLabel(record) : session.title || sessionId).slice(0, 200),
          hops: peerMessageHops(lastMessage?.body ?? '') };
      }
    }),
    sendPeerMessage: createCliPeerDelivery({ registry: deps.registry, log: deps.log,
      enabled: () => deps.store.getConfig().threadCommunicationEnabled !== false,
      generation: () => deps.store.getConfig().threadCommunicationGeneration ?? 0,
      status: id => deps.agentStatus.get(id),
      inject: (id, message) => !deps.wrapUpClose.isWrappingUp(id) && deps.ptys.reply(id, message) })
  };
}
