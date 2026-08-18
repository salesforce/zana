/**
 * clone_project — clone a repository into the user's configured clone root and
 * register the resulting repository directory as a project.
 *
 * This is intentionally host-owned rather than guidance for a raw `git clone`:
 * an isolated Quick Agent starts in a prompt-named scratch directory, while the
 * project should live at `<cloneRoot>/<repoName>`.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CloneProjectResult } from '../shared/types.js';

export const CLONE_PROJECT_DESCRIPTION = [
  'Clone a Git repository into the configured project clone root and register it',
  'in the user\'s project list. The clone lands in a repository-named directory',
  '(for example `~/zcc-workspace/my-repo`), not this session\'s temporary',
  'working directory.',
  '',
  'Use this instead of running `git clone` directly when creating a new project.',
  'The repository URL determines the folder name unless `name` is supplied. If',
  'the destination already contains a different repository, this reports an error',
  'without overwriting it.'
].join(' ');

export const cloneProjectInputSchema = {
  url: z.string().min(1).max(2048).describe('Repository URL or owner/repository shorthand.'),
  name: z.string().min(1).max(256).optional().describe('Optional folder-name override.')
};

export interface RegisterCloneProjectOpts {
  cloneProject: (input: { url: string; name?: string }) => Promise<CloneProjectResult>;
}

export function registerCloneProjectTool(server: McpServer, opts: RegisterCloneProjectOpts): void {
  server.registerTool(
    'clone_project',
    {
      description: CLONE_PROJECT_DESCRIPTION,
      inputSchema: cloneProjectInputSchema
    },
    async ({ url, name }) => {
      try {
        const result = await opts.cloneProject({ url, name });
        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `clone_project failed: ${result.message}` }]
          };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `${result.reused ? 'Registered existing' : 'Cloned and registered'} project "${result.project.name}" (id=${result.project.id}, path=${result.project.path}). It is now in the sidebar.`
            }
          ]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `clone_project failed: ${message}` }]
        };
      }
    }
  );
}
