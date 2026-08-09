/**
 * list_personas — let an agent discover the personas it could be launched as.
 *
 * Read-only and identity-free: a persona is a reusable launch profile (model,
 * permission mode, system prompt, tools), and this tool exposes only its
 * NON-SENSITIVE metadata — id, name, description, base profile, model. It
 * deliberately omits `appendSystemPrompt`, `allowedTools`, `mcpServers`, etc.:
 * a discovery caller picks a persona by id/name, it does not need the system
 * prompt body. Projection happens in main (via `toPersonaSummary`), so this
 * tool never sees the launch internals.
 *
 * This is the read half of the persona-launch story. Spawning an agent AS a
 * persona is deliberately NOT exposed here in v1 — agent-initiated spawn needs
 * fan-out/depth/budget guardrails first (it's an operator-only CLI action for
 * now). Shipping discovery now means a future spawn tool is a pure addition.
 *
 * Like every tool, it's registered per-request and gated on its dep being
 * wired in {@link McpServerOptions} (absent ⇒ the tool isn't registered, so the
 * agent never sees it). It needs no sessionId, so it's available on both the
 * project- and session-scoped routes.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PersonaSummary } from '../shared/types.js';

export const LIST_PERSONAS_DESCRIPTION = [
  'List the personas available to launch agents as. A persona is a reusable',
  'launch profile (a role with its own model, permission mode, and system',
  'prompt) — e.g. Code Reviewer, QA Engineer, Backend Engineer.',
  '',
  'Returns non-sensitive metadata only: id, name, description, base profile,',
  'and model. Use the `id` when an operator or a future tool spawns an agent',
  'as that persona. Read-only; takes no arguments.'
].join(' ');

export interface ListPersonasOpts {
  /**
   * Resolve the live persona catalogue (built-ins + user/project files),
   * already projected to non-sensitive {@link PersonaSummary} metadata in main.
   */
  listPersonas: () => PersonaSummary[];
}

/**
 * Register the `list_personas` tool on the given `McpServer`. Rebuilt per
 * request like the other tools. No input schema (it takes no arguments).
 */
export function registerListPersonasTool(server: McpServer, opts: ListPersonasOpts): void {
  const { listPersonas } = opts;

  server.registerTool(
    'list_personas',
    {
      description: LIST_PERSONAS_DESCRIPTION,
      inputSchema: {}
    },
    async () => {
      try {
        const personas = listPersonas();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(personas, null, 2) }]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `list_personas failed: ${message}` }]
        };
      }
    }
  );
}
