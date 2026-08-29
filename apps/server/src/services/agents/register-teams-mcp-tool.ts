/**
 * list_teams — let an agent discover the Teams it (or an operator) could launch.
 *
 * Read-only and identity-free: a Team is a named bundle of personas that, when
 * launched, opens one terminal tab per slot. This tool exposes only its
 * NON-SENSITIVE metadata — id, name, description, slot count, source — via the
 * main-side {@link toTeamSummary} projection. It deliberately omits the launch
 * internals (`slots`, `initialPrompt`, `orchestratorPersonaId`): a discovery
 * caller picks a team by id/name, it does not need the slot list.
 *
 * Mirrors {@link registerListPersonasTool}. Like every tool it's registered
 * per-request and gated on its dep being wired in {@link McpServerOptions}
 * (absent ⇒ the tool isn't registered). It needs no sessionId, so it's available
 * on both the project- and session-scoped routes.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TeamSummary } from '@zana-ai/zcc-domain/product';

export const LIST_TEAMS_DESCRIPTION = [
  'List the Teams available to launch. A Team is a named bundle of personas;',
  'launching it opens one terminal tab per slot (an orchestrator plus workers).',
  '',
  'Returns non-sensitive metadata only: id, name, description, slot count, and',
  'source. Use the `id` when an operator launches the team. Read-only; takes no',
  'arguments.'
].join(' ');

export interface ListTeamsOpts {
  /** Resolve the live team catalogue, projected to non-sensitive {@link TeamSummary} metadata. */
  listTeams: () => TeamSummary[];
}

/** Register the `list_teams` tool on the given `McpServer`. No input schema. */
export function registerListTeamsTool(server: McpServer, opts: ListTeamsOpts): void {
  const { listTeams } = opts;

  server.registerTool(
    'list_teams',
    {
      description: LIST_TEAMS_DESCRIPTION,
      inputSchema: {}
    },
    async () => {
      try {
        const teams = listTeams();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(teams, null, 2) }]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `list_teams failed: ${message}` }]
        };
      }
    }
  );
}
