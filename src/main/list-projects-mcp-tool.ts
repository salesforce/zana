/**
 * list_projects — let an agent discover the projects in the user's project list.
 *
 * Read-only and identity-free: it returns the NON-SENSITIVE metadata of each
 * registered project — id, name, path, tag, whether it's a remote (SSH) project,
 * and whether it's the built-in scratch project. Projection happens in main (via
 * `toProjectSummary`), so this tool never sees the full store record (sort
 * index, default-agent lists, lineage hints, …).
 *
 * This is the read counterpart to {@link registerRegisterProjectTool}: an agent
 * could already ADD a directory to the list, but had no way to ENUMERATE the
 * projects already there (e.g. to resolve a name the user mentioned to a project
 * id, or to tell remote projects from local ones before suggesting an action).
 *
 * Like every tool it's registered per request and gated on its dep being wired
 * in {@link McpServerOptions} (absent ⇒ the tool isn't registered, so the agent
 * never sees it). It needs no sessionId, so it's available on both the project-
 * and session-scoped routes.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ProjectSummary } from '../shared/types.js';

export const LIST_PROJECTS_DESCRIPTION = [
  "List the projects in the user's project list (the entries shown in the app's",
  'Projects sidebar). A project is a working directory — local, or a remote SSH',
  'host — that agents can be launched in.',
  '',
  'Returns non-sensitive metadata only: id, name, path, tag, whether it is a',
  'remote (SSH) project, and whether it is the built-in scratch project. Use the',
  '`id` (or `tag`) to refer to a project in other actions. Read-only; takes no',
  'arguments.'
].join(' ');

export interface ListProjectsOpts {
  /**
   * Resolve the live project list, already projected to non-sensitive
   * {@link ProjectSummary} metadata in main.
   */
  listProjects: () => ProjectSummary[];
}

/**
 * Register the `list_projects` tool on the given `McpServer`. Rebuilt per
 * request like the other tools. No input schema (it takes no arguments).
 */
export function registerListProjectsTool(server: McpServer, opts: ListProjectsOpts): void {
  const { listProjects } = opts;

  server.registerTool(
    'list_projects',
    {
      description: LIST_PROJECTS_DESCRIPTION,
      inputSchema: {}
    },
    async () => {
      try {
        const projects = listProjects();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(projects, null, 2) }]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `list_projects failed: ${message}` }]
        };
      }
    }
  );
}
