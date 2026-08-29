/**
 * Agent messaging tools — `agent_send`, `agent_inbox` (Phase 1 of the mesh).
 *
 * Session-scoped only (like the discovery tools): identity comes from the URL
 * route, never the agent. The delivery model is **pull-first, inject-when-idle**:
 *
 *  - `agent_send` resolves the target via the registry, ALWAYS appends the
 *    message to the {@link AgentMessageLog} (the audit + queue — NEVER the user
 *    inbox), then injects it into the target's pty via `reply()` ONLY if the
 *    target is idle/done. If the target is working/blocked/unknown, the message
 *    stays queued for the target to pull. The queue is the source of truth, so a
 *    skipped inject is "queued", never "lost".
 *  - `agent_inbox` drains the calling session's queued messages.
 *
 * `agent_send` is deliberately NOT pre-approved (see `pty.ts` `inboxAllow`) — the
 * first cross-agent message surfaces a permission prompt so the user blesses
 * agent-to-agent comms once. `agent_inbox` (read-only) IS pre-approved.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentState } from '../shared/types.js';
import { isRestfulAgentState } from '../shared/types.js';
import { agentLabel, type IAgentRegistryStore } from './agent-registry-store.js';
import type { IAgentMessageLog } from './agent-message-log.js';

export const AGENT_SEND_DESCRIPTION = [
  'Send a message to a peer agent (another Claude tab the user is running).',
  'Address the peer by its `handle` (see list_agents / find_agent) or its raw',
  'session id via `to`.',
  '',
  'Delivery is reliable: the message is queued for the peer and also injected',
  "into the peer's prompt if it is idle right now; a busy peer picks it up when",
  'it next checks its messages. Every send is recorded in the user-visible agent',
  'activity log.',
  '',
  'By default you can only message peers in your OWN project. Set',
  '`allProjects: true` to address a peer in another project.'
].join(' ');

export const AGENT_INBOX_DESCRIPTION = [
  'Check for messages other agents have sent you. Returns your undelivered',
  'messages (each with the sender handle and body) and marks them read.',
  '',
  'Poll this when you are coordinating with peers — e.g. after asking another',
  'agent to do something, or periodically while you wait on a peer. `since`',
  '(a message id you already saw) returns only newer messages.'
].join(' ');

export const agentSendInputSchema = {
  to: z
    .string()
    .min(1)
    .describe(
      'Recipient: a peer handle (preferred), its displayName (tab title) as a fallback, or a raw session id.'
    ),
  message: z.string().min(1).describe('The message body to send to the peer.'),
  allProjects: z
    .boolean()
    .optional()
    .describe('Allow addressing a peer outside your own project. Default false.')
};

export const agentInboxInputSchema = {
  since: z
    .string()
    .optional()
    .describe('Only return messages after this message id (one you already saw).')
};

export interface RegisterMessagingToolsOpts {
  /** Originating session id, from the URL route. Server-filled identity. */
  sessionId: string;
  /** Originating project id, from the URL route. Server-filled identity. */
  projectId: string;
  registry: IAgentRegistryStore;
  messageLog: IAgentMessageLog;
  /** Live agent state for a session — gates the best-effort inject. */
  getAgentStatus: (sessionId: string) => AgentState;
  /**
   * Inject a line of text into a session's pty (the `reply()` primitive).
   * Returns true if the pty was live and accepted it. Best-effort: a false
   * return just means the message stays queued.
   */
  injectToSession: (sessionId: string, text: string) => boolean;
}

/** States in which it's safe to inject a peer message at the prompt (any harness). */
const isInjectable = isRestfulAgentState;

export function registerAgentMessagingTools(
  server: McpServer,
  opts: RegisterMessagingToolsOpts
): void {
  const { sessionId, projectId, registry, messageLog, getAgentStatus, injectToSession } = opts;

  server.registerTool(
    'agent_send',
    { description: AGENT_SEND_DESCRIPTION, inputSchema: agentSendInputSchema },
    async ({ to, message, allProjects }) => {
      try {
        // Resolve the target. Try handle first (scoped), then a raw session id.
        const scope = allProjects ? undefined : projectId;
        let target = registry.find({ handle: to, projectId: scope })[0];
        if (!target) {
          const byId = registry.get(to);
          // A raw-session-id target must still respect the project scope unless
          // allProjects was set — otherwise handle-scoping could be bypassed by
          // passing the id directly.
          if (byId && (allProjects || byId.projectId === projectId)) target = byId;
        }
        if (!target) {
          return toolError(
            'agent_send',
            new Error(
              `no peer found for "${to}"${
                allProjects ? '' : ' in this project (try allProjects:true for cross-project)'
              }`
            )
          );
        }
        if (target.sessionId === sessionId) {
          return toolError('agent_send', new Error('cannot send a message to yourself'));
        }

        const fromRec = registry.get(sessionId);
        const fromHandle = fromRec ? agentLabel(fromRec) : sessionId;

        // Best-effort inject ONLY when the target is at an idle prompt. The
        // queue (the append below) is the source of truth regardless.
        const injectable = isInjectable(getAgentStatus(target.sessionId));
        let delivered = false;
        if (injectable) {
          delivered = injectToSession(
            target.sessionId,
            `[message from @${fromHandle}] ${message}`
          );
        }

        const msg = messageLog.append({
          fromSessionId: sessionId,
          fromHandle,
          toSessionId: target.sessionId,
          toHandle: agentLabel(target),
          projectId,
          body: message,
          deliveredAt: delivered ? Date.now() : undefined
        });

        const targetLabel = agentLabel(target);
        return {
          content: [
            {
              type: 'text' as const,
              text: delivered
                ? `Delivered to @${targetLabel} (injected at its prompt). id=${msg.id}`
                : `Queued for @${targetLabel} (busy; it will see this when it next checks). id=${msg.id}`
            }
          ]
        };
      } catch (err) {
        return toolError('agent_send', err);
      }
    }
  );

  server.registerTool(
    'agent_inbox',
    { description: AGENT_INBOX_DESCRIPTION, inputSchema: agentInboxInputSchema },
    async ({ since }) => {
      try {
        const pending = messageLog.pull(sessionId, since);
        messageLog.markDelivered(pending.map((m) => m.id));
        const view = pending.map((m) => ({
          id: m.id,
          from: m.fromHandle,
          fromSessionId: m.fromSessionId,
          body: m.body,
          ts: m.ts
        }));
        return { content: [{ type: 'text' as const, text: JSON.stringify(view, null, 2) }] };
      } catch (err) {
        return toolError('agent_inbox', err);
      }
    }
  );
}

function toolError(tool: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: 'text' as const, text: `${tool} failed: ${message}` }]
  };
}
