/**
 * create_local_extension — lets an agent scaffold a brand-new, in-app-authored
 * extension project, mirroring what the "Create extension" dialog does when a
 * user clicks it.
 *
 * Unlike {@link registerInstallLocalExtensionTool} (session-scoped, no input —
 * it acts on the caller's OWN working dir), this tool genuinely mints something
 * new: it takes display intent (name/description/kind) and returns a fresh id +
 * working dir + project id. There is no "whose extension is this" ambiguity to
 * resolve (create always mints a fresh id), so — like `register_project` — it
 * is identity-free and registered unconditionally whenever the callback is
 * wired, with no `sessionId` gate and no config flag.
 *
 * The handler is delegated to an injected `createLocalExtension` callback so
 * this module stays free of the store / Electron wiring (and is unit-testable).
 * It cannot itself open a terminal tab for the agent — that's a renderer-side
 * action — so the response text tells the caller to open (or ask the user to
 * open) a session with `cwd` set to the returned `workingDir` before it can
 * call `install_local_extension` there.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Result } from '@zana-ai/zcc-domain/product';

export const CREATE_LOCAL_EXTENSION_DESCRIPTION = [
  'Scaffold a brand-new, in-app-authored plugin project (the same thing the',
  '"Create plugin" dialog does). Mints a fresh plugin id, writes a package.json',
  'zcc starter into its own working directory, path-installs it through PluginService',
  '(so it shows up immediately as a panel), and registers a dedicated project for it.',
  '',
  'This tool only scaffolds — it cannot open a terminal tab for you. To build the',
  'plugin, open (or ask the user to open) a new agent session with its `cwd`',
  'set to the returned `workingDir`; from inside that session, `install_local_extension`',
  'can reload your changes as you go.'
].join(' ');

export const createLocalExtensionInputSchema = {
  name: z.string().min(1).max(60).describe('Display name for the new extension.'),
  description: z.string().max(140).optional().describe('Short description (optional).'),
  kind: z
    .enum(['panel', 'main-panel', 'mcp-consumer', 'agent-preset'])
    .optional()
    .describe(
      'Starter template kind. "panel" (default) is a simple renderer-only panel; ' +
        '"main-panel" adds a main-process module; "mcp-consumer" adds an MCP client; ' +
        '"agent-preset" scaffolds a persona/team contribution instead of a panel.'
    )
};

export interface RegisterCreateLocalExtensionOpts {
  /**
   * Scaffold + pack + install a new local extension and register its dedicated
   * project. Returns the minted id, its working dir, and the new project's id.
   * Returns a typed error (e.g. `BAD_NAME`) rather than throwing.
   */
  createLocalExtension: (req: {
    name: string;
    description?: string;
    kind?: string;
  }) => Promise<Result<{ id: string; workingDir: string; projectId: string }>>;
}

/**
 * Register the `create_local_extension` tool on the given `McpServer`.
 * Identity-free — available on both route shapes, gated only on the callback
 * being wired.
 */
export function registerCreateLocalExtensionTool(
  server: McpServer,
  opts: RegisterCreateLocalExtensionOpts
): void {
  const { createLocalExtension } = opts;

  server.registerTool(
    'create_local_extension',
    {
      description: CREATE_LOCAL_EXTENSION_DESCRIPTION,
      inputSchema: createLocalExtensionInputSchema
    },
    async ({ name, description, kind }) => {
      const result = await createLocalExtension({ name, description, kind });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `create_local_extension failed: ${result.message}` }]
        };
      }
      const { id, workingDir, projectId } = result.value;
      return {
        content: [
          {
            type: 'text' as const,
            text: [
              `Created extension "${id}" at ${workingDir} (project ${projectId}).`,
              'It is already installed as a bare scaffold. To build it, open a new agent',
              `session with cwd="${workingDir}" — from inside that session you can call`,
              'install_local_extension after each change to try it live.'
            ].join(' ')
          }
        ]
      };
    }
  );
}
