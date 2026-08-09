/**
 * install_local_extension — lets the Extension Creator agent pack + install
 * ITS OWN local extension, so the user can test a change without switching to
 * Settings → Extensions and clicking "Reload from source" by hand.
 *
 * Session-scoped only, and — like {@link registerCloseSessionTools} — takes NO
 * input: the tool schema carries no id/path for the agent to supply. Identity
 * comes entirely from the URL-derived `sessionId`; the injected `install`
 * callback (main, in index.ts) re-derives which extension that session is
 * allowed to touch from its OWN records (the live pty's cwd, cross-referenced
 * against `local.json` — see `findLocalRecordByCwd`), never from anything the
 * agent says. A session whose cwd isn't a registered local extension's working
 * dir simply can't install anything — the tool fails closed with a clear
 * message rather than accepting a smuggled id.
 *
 * Reuses the exact pack → installFromDir → runDiskSync pipeline the
 * "Reload from source" button already runs (`IPC.extensions.reinstallLocal`),
 * so this tool adds no new install logic — only a new trigger for the agent
 * itself to pull.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Result } from '../shared/types.js';

export const INSTALL_LOCAL_EXTENSION_DESCRIPTION = [
  'Pack and install the local extension you are building in this working',
  'directory, so the user can try it immediately (equivalent to them clicking',
  '"Reload from source" in Settings → Extensions). Call this once your changes',
  'are ready to test — the app re-validates the manifest and applies your',
  'current `dist/` before returning. Fails if this working directory is not a',
  'registered local extension.'
].join(' ');

/** Empty schema — the tool takes no args; identity comes from the session. */
export const installLocalExtensionInputSchema = {};

export interface RegisterInstallLocalExtensionOpts {
  /** Originating session (from the URL route). Absent ⇒ the tool is not registered. */
  sessionId?: string;
  /**
   * Pack + install the local extension owned by `sessionId`'s own working dir.
   * Returns a typed error (e.g. `NOT_LOCAL` when the session's cwd isn't a
   * known local extension) rather than throwing.
   */
  installOwnExtension: (sessionId: string) => Promise<Result<{ id: string }>>;
}

/**
 * Register `install_local_extension` on the given `McpServer`. The handler
 * closes over `sessionId` from the URL route — the agent supplies nothing.
 */
export function registerInstallLocalExtensionTool(
  server: McpServer,
  opts: RegisterInstallLocalExtensionOpts
): void {
  const { sessionId, installOwnExtension } = opts;

  server.registerTool(
    'install_local_extension',
    {
      description: INSTALL_LOCAL_EXTENSION_DESCRIPTION,
      inputSchema: installLocalExtensionInputSchema
    },
    async () => {
      if (!sessionId) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'install_local_extension failed: no originating session (this tool only works inside a live session).'
            }
          ]
        };
      }
      const result = await installOwnExtension(sessionId);
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `install_local_extension failed: ${result.message}` }]
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Installed "${result.value.id}". The user can now open/reload it to try your changes.`
          }
        ]
      };
    }
  );
}
