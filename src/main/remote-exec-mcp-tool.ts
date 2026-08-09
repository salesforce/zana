/**
 * remote_exec — run a one-shot shell command on a REGISTERED remote (SSH-backed)
 * project, from a LOCAL agent.
 *
 * A local agent can already reach the user's registered projects by id (see
 * `list_projects`). For a *remote* project that id resolves — in main, from the
 * store — to an SSH `{host, user, path}`. This tool lets the agent run a command
 * on that box without itself being launched there: the agent supplies a
 * `projectId` + a `command` (+ optional `cwd`), and main does the SSH round-trip
 * over the same transport the Explorer's remote file ops use.
 *
 * **Scope & trust (CLAUDE.md #1/#2).** The agent NEVER supplies host / user /
 * credentials — only the id of a project the user already registered. Main
 * resolves the `ProjectRemote` from the store (`runRemoteCommand` closes over
 * that resolution) and confines the command's start dir under the project's
 * realpath'd remote root. The agent's `projectId` is a *reference*, not a trust
 * anchor: a non-remote or unknown id fails cleanly.
 *
 * **Not a jail.** The command string is handed to the remote login shell
 * verbatim (pipes / `&&` / redirection work), and a determined command could
 * `cd` elsewhere — the same "a shell is a shell" posture as launching a remote
 * agent. The safety here is that the host/creds and starting dir are
 * host-authorized, and the tool is NOT blanket pre-approved (first use raises a
 * permission prompt the user blesses once) — it's only auto-allowed on
 * autonomous team runs, mirroring `agent_send`.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RemoteExecResult } from '../shared/types.js';

export const REMOTE_EXEC_DESCRIPTION = [
  'Run a shell command on a registered REMOTE (SSH) project and return its',
  'output. Use this to inspect or act on a remote workspace (build, git status,',
  'grep, read logs) without opening a terminal there yourself.',
  '',
  '`projectId` MUST be the id of a project the user has registered as remote',
  '(resolve names via list_projects — remote projects carry a `remote` field).',
  'You never pass a host or credentials: the app resolves the SSH target from the',
  'project. A non-remote or unknown id returns an error.',
  '',
  '`command` is run by the remote login shell inside the project root (or `cwd`,',
  'a path under the project root). Shell operators (pipes, &&, redirection) work.',
  '',
  'Returns the exit `code`, `stdout`, and `stderr`. A non-zero exit is returned',
  'as data (not an error) so you can react to it. Output is capped (1 MB per',
  'stream) and `truncated` is set when it was clipped. First use will ask the',
  'user for permission — running remote commands is a privileged action.'
].join(' ');

export const remoteExecInputSchema = {
  projectId: z
    .string()
    .describe('Id of a registered REMOTE (SSH) project to run the command on. Resolve via list_projects.'),
  command: z
    .string()
    .describe('The shell command to run on the remote host, inside the project root.'),
  cwd: z
    .string()
    .optional()
    .describe(
      'Optional working directory for the command — a path under the project root. Defaults to the project root. Paths outside it are rejected.'
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional per-command timeout in milliseconds (default 120000, max 600000).')
};

export interface RegisterRemoteExecOpts {
  /**
   * Resolve the (store-authorized) remote for `projectId` and run `command`
   * there. Injected by index.ts so this module never touches the store, the SSH
   * layer, or path confinement directly — main owns all of that (rule 1). Returns
   * a transport-level failure (`ok:false`) when the id isn't a reachable remote
   * project; otherwise the command's captured result.
   */
  runRemoteCommand: (
    projectId: string,
    command: string,
    opts: { cwd?: string; timeoutMs?: number }
  ) => Promise<RemoteExecResult>;
}

/**
 * Register the `remote_exec` tool. The agent supplies only references (a
 * projectId) and payload (command/cwd); the host-authorized resolution lives
 * behind the injected `runRemoteCommand`.
 */
export function registerRemoteExecTool(server: McpServer, opts: RegisterRemoteExecOpts): void {
  const { runRemoteCommand } = opts;

  server.registerTool(
    'remote_exec',
    {
      description: REMOTE_EXEC_DESCRIPTION,
      inputSchema: remoteExecInputSchema
    },
    async ({ projectId, command, cwd, timeoutMs }) => {
      try {
        const result = await runRemoteCommand(projectId, command, {
          ...(cwd ? { cwd } : {}),
          ...(timeoutMs ? { timeoutMs } : {})
        });
        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `remote_exec failed: ${result.message ?? 'unknown error'}` }]
          };
        }
        const payload = {
          projectId,
          exitCode: result.code ?? null,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
          truncated: result.truncated === true
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `remote_exec failed: ${message}` }]
        };
      }
    }
  );
}
