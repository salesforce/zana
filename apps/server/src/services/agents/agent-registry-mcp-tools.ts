/**
 * Agent-registry discovery tools — `register_agent`, `list_agents`, `find_agent`.
 *
 * Phase 0 of the inter-agent mesh: discovery only, no messaging. These let an
 * agent in one tab announce itself and find its peers so it can reference them
 * by a stable handle. They are registered ONLY on the session-scoped MCP route
 * (`/mcp/:projectId/:sessionId`) — like `schedule_report` — because every one
 * needs a real originating session identity. The identity-bearing fields
 * (`sessionId`, `projectId`, `cwd`) are closed over from the URL route +
 * `PtyManager.getSession()` and are NEVER part of the agent-visible schema, so
 * an agent cannot forge whose record it is or push into another project's
 * registry (the same trust model as `inbox_push`).
 *
 * Live agent state (working/idle/blocked) is fused in at response time from the
 * injected `getAgentStatus` callback, so the registry store itself never holds a
 * stale status.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentState } from '@zana-ai/zcc-domain/product';
import type { AgentRecord, IAgentRegistryStore } from './agent-registry-store.js';

export const REGISTER_AGENT_DESCRIPTION = [
  'Announce yourself in the agent registry so peer agents (other Claude tabs',
  'the user is running) can discover and reference you. Call this once near the',
  'start of your session.',
  '',
  '`handle` is the short name peers use to address you (e.g. "reviewer",',
  '"impl-1"); if another agent in this project already took it, yours is',
  'auto-suffixed and the chosen handle is returned. Once set, your handle is',
  'authoritative — it is NEVER overwritten by your drifting tab title, so',
  'registering early gives peers a stable name to reach you by. `role` and',
  '`capabilities` are optional free-text hints that make you easier to find via',
  '`find_agent`.',
  '',
  'You do not supply your session id, project, or working directory — those are',
  'filled automatically from your session. Re-calling updates your entry.'
].join(' ');

export const LIST_AGENTS_DESCRIPTION = [
  'List the other agents currently running, so you can see who you could',
  'collaborate with. Returns each peer\'s handle, displayName, role,',
  'capabilities, live status (working / idle / blocked / …), and session id.',
  '',
  '`handle` is the peer\'s OWN chosen name (present only once it called',
  'register_agent) — stable and the best thing to address. `displayName` is its',
  'live tab title, which drifts as it works; a peer that never registered has',
  'only a displayName. You can address either, but prefer a handle when present.',
  '',
  'By default this is scoped to your own project. Pass `allProjects: true` to',
  'see agents in every project the user has open.'
].join(' ');

export const FIND_AGENT_DESCRIPTION = [
  'Find a specific peer agent by handle, role, and/or capability — use this to',
  'resolve a reference before you act on it. Returns matching records (handle,',
  'displayName, role, capabilities, live status, session id).',
  '',
  'A `handle` query matches the peer\'s authoritative handle first, then falls',
  'back to its displayName (tab title) — so a peer that never registered is',
  'still findable by the name you see in the UI.',
  '',
  'Scoped to your own project by default; pass `allProjects: true` to widen the',
  'search. At least one of `handle`, `role`, or `capability` should be given.'
].join(' ');

/** `register_agent` input schema. No identity fields — those are server-filled. */
export const registerAgentInputSchema = {
  handle: z
    .string()
    .min(1)
    .describe('Short name peers use to address you, e.g. "reviewer". Auto-suffixed if taken.'),
  role: z
    .string()
    .optional()
    .describe('Optional free-text role, e.g. "reviewer" or "implementer".'),
  capabilities: z
    .array(z.string())
    .optional()
    .describe('Optional capability tags, e.g. ["typescript", "tests"].')
};

export const listAgentsInputSchema = {
  allProjects: z
    .boolean()
    .optional()
    .describe('When true, list agents across all projects instead of just your own.')
};

export const findAgentInputSchema = {
  handle: z
    .string()
    .optional()
    .describe('Match this name — the peer\'s authoritative handle, or its displayName (tab title) as a fallback.'),
  role: z.string().optional().describe('Match this exact role.'),
  capability: z.string().optional().describe('Match agents that declare this capability tag.'),
  allProjects: z
    .boolean()
    .optional()
    .describe('When true, search across all projects instead of just your own.')
};

export interface RegisterAgentToolsOpts {
  /** Originating session id, from the URL route. Server-filled identity. */
  sessionId: string;
  /** Originating project id, from the URL route. Server-filled identity. */
  projectId: string;
  /**
   * Working directory of the originating session, or undefined if the session
   * isn't live (rare — the route only resolves for a live pty). Server-filled.
   */
  cwd?: string;
  /** The shared registry store. */
  registry: IAgentRegistryStore;
  /** Live agent state for a session, fused into list/find responses. */
  getAgentStatus: (sessionId: string) => AgentState;
  /**
   * Team launch id for this session, if it was spawned as part of a team.
   * Scopes handle dedup and peer discovery to the same squad so two teams
   * using the same personas in one project stay isolated.
   */
  teamLaunchId?: string;
}

/**
 * A peer record as surfaced to the agent: the stored fields PLUS the live
 * status fused in at response time, and minus the originating session itself
 * (an agent doesn't need to discover itself).
 */
interface PeerView extends AgentRecord {
  status: AgentState;
}

/**
 * Register the three discovery tools on the given session-scoped `McpServer`.
 * Rebuilt per-request, like the other tools, so identity never bleeds across
 * requests.
 */
export function registerAgentRegistryTools(server: McpServer, opts: RegisterAgentToolsOpts): void {
  const { sessionId, projectId, cwd, registry, getAgentStatus, teamLaunchId } = opts;

  const toPeerView = (rec: AgentRecord): PeerView => ({
    ...rec,
    status: getAgentStatus(rec.sessionId)
  });

  server.registerTool(
    'register_agent',
    { description: REGISTER_AGENT_DESCRIPTION, inputSchema: registerAgentInputSchema },
    async ({ handle, role, capabilities }) => {
      try {
        const record = registry.upsert({
          sessionId,
          projectId,
          // The session is live (the route resolved), but guard anyway: an
          // empty cwd is harmless metadata, never an identity decision.
          cwd: cwd ?? '',
          handle,
          role,
          capabilities,
          teamLaunchId
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Registered as "${record.handle}"${
                record.handle !== handle ? ` (handle "${handle}" was taken)` : ''
              }. Peers can now discover you via list_agents / find_agent.`
            }
          ]
        };
      } catch (err) {
        return toolError('register_agent', err);
      }
    }
  );

  server.registerTool(
    'list_agents',
    { description: LIST_AGENTS_DESCRIPTION, inputSchema: listAgentsInputSchema },
    async ({ allProjects }) => {
      try {
        const peers = registry
          .list(allProjects ? undefined : projectId)
          .filter((r) => r.sessionId !== sessionId) // don't list yourself
          // Squad scoping: when this session belongs to a team launch, only
          // show peers from the same squad (unless widening to all projects).
          .filter((r) => allProjects || !teamLaunchId || r.teamLaunchId === teamLaunchId)
          .map(toPeerView);
        return { content: [{ type: 'text' as const, text: JSON.stringify(peers, null, 2) }] };
      } catch (err) {
        return toolError('list_agents', err);
      }
    }
  );

  server.registerTool(
    'find_agent',
    { description: FIND_AGENT_DESCRIPTION, inputSchema: findAgentInputSchema },
    async ({ handle, role, capability, allProjects }) => {
      try {
        const matches = registry
          .find({
            handle,
            role,
            capability,
            projectId: allProjects ? undefined : projectId,
            teamLaunchId: allProjects ? undefined : teamLaunchId
          })
          .filter((r) => r.sessionId !== sessionId)
          .map(toPeerView);
        return { content: [{ type: 'text' as const, text: JSON.stringify(matches, null, 2) }] };
      } catch (err) {
        return toolError('find_agent', err);
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
