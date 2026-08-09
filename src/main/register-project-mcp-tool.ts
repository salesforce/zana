/**
 * register_project — let an agent add a directory to the user's project list.
 *
 * This is the write-side counterpart to the Quick Agent "clone a repo" flow:
 * the agent clones a repo into its workspace, then calls this tool so the
 * cloned folder shows up as a real project in the sidebar without the user
 * having to add it by hand.
 *
 * The handler takes the originating project's root from the URL route, but —
 * unlike {@link registerInboxPushTool}, where the closed-over projectId is a
 * security boundary the agent cannot forge — `projectRoot` here is only a
 * convenience for resolving a relative `path`. The agent may pass any absolute
 * path and register a directory outside the originating project; that is no
 * more than its shell can already touch. The actual mutation is delegated to an
 * injected `registerProject` callback so this module stays free of the store /
 * Electron wiring (and is unit-testable).
 */

import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Project } from '../shared/types.js';

export const REGISTER_PROJECT_DESCRIPTION = [
  "Register a directory on disk as a project in the user's project list",
  '(it appears in the sidebar immediately). Use this after cloning or creating',
  'a repo so the user can open it as a first-class project.',
  '',
  '`path` is the directory to register. A relative path is resolved against',
  "this session's working directory (the current project root), so after",
  '`git clone foo` you can pass `foo`. The directory must already exist.',
  '',
  'Idempotent: registering an already-known path returns the existing project',
  'rather than creating a duplicate.'
].join(' ');

/**
 * Tool input schema (`ZodRawShape`; the SDK wraps it in `z.object`). No
 * projectId — the router closes over the originating project's root, which is
 * used only to resolve a relative `path`.
 */
export const registerProjectInputSchema = {
  path: z
    .string()
    .min(1)
    .describe(
      'Directory to register as a project. Relative paths resolve against the current project root.'
    )
};

export interface RegisterProjectOpts {
  /**
   * Absolute path of the originating project's root, used to resolve a relative
   * `path` the agent supplies. Absent if the project is unknown (rare); then a
   * relative path is rejected with a clear error.
   */
  projectRoot?: string;
  /**
   * Performs the add. Returns the resulting project and whether it already
   * existed (so the tool can word its reply honestly). Throws on a bad path
   * (not a directory / missing); the handler turns that into an `isError`.
   */
  registerProject: (absPath: string) => { project: Project; alreadyExisted: boolean };
}

/**
 * Register the `register_project` tool on the given `McpServer`. Rebuilt
 * per-request, like the other tools, so identity never bleeds across requests.
 */
export function registerRegisterProjectTool(server: McpServer, opts: RegisterProjectOpts): void {
  const { projectRoot, registerProject } = opts;

  server.registerTool(
    'register_project',
    {
      description: REGISTER_PROJECT_DESCRIPTION,
      inputSchema: registerProjectInputSchema
    },
    async ({ path }) => {
      try {
        let absPath: string;
        if (isAbsolute(path)) {
          // resolve() also normalizes (collapses `..`, strips trailing slashes)
          // so the store's path-equality dedup can't be fooled by `/foo` vs
          // `/foo/`.
          absPath = resolve(path);
        } else if (projectRoot) {
          absPath = resolve(projectRoot, path);
        } else {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: 'register_project failed: a relative path was given but the originating project root is unknown. Pass an absolute path.'
              }
            ]
          };
        }
        const { project, alreadyExisted } = registerProject(absPath);
        const verb = alreadyExisted ? 'Already registered' : 'Registered';
        return {
          content: [
            {
              type: 'text' as const,
              text: `${verb} project "${project.name}" (id=${project.id}, path=${project.path}). It is now in the sidebar.`
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `register_project failed: ${message}`
            }
          ]
        };
      }
    }
  );
}
