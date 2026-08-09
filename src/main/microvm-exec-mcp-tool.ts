/**
 * microvm_exec / microvm_reset — run a shell command inside a per-project
 * SANDBOXED microVM PLAYGROUND, driven by a LOCAL agent from OUTSIDE the guest.
 *
 * The agent runs NATIVELY on the host (full auth), and drives an isolated
 * libkrun guest as a scratch workspace: clone a repo, `npm install`, run
 * untrusted code, compile, test — all inside a VM with its own kernel + netns,
 * so a hostile repo can't touch host files. This is the inverse of launching an
 * agent INSIDE the guest (which hits the model-gateway auth wall): here the
 * model call stays on the authed host and only EXECUTION is sandboxed, so there
 * is no auth question.
 *
 * **Scope & trust (CLAUDE.md #1/#7).** The agent supplies only a `projectId`
 * (the key the guest is bound to — the same handle the inbox/route already use)
 * and a `command`. It NEVER supplies an image ref that isn't allowlisted, a host
 * path, or a mount: main owns image authorization (closed allowlist, no "*") and
 * there is NO host bind mount — the guest is an isolated scratch disk. State
 * PERSISTS across calls for the same project (clone in one call, build in the
 * next) because main reuses the same guest. `runMicrovmCommand` closes over the
 * host-owned `MicroVmPool`; this module never touches the SDK (Rule 7).
 *
 * **Not a jail *inside* the guest.** The command string is handed to the guest
 * shell verbatim (pipes / `&&` / redirection work). That's fine — the boundary
 * is the VM, not the shell. The safety is that execution is confined to a guest
 * with no host filesystem access, and the tool is NOT blanket pre-approved
 * (first use raises a permission prompt) — auto-allowed only on autonomous team
 * runs, mirroring `remote_exec`.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MicroVmExecResult } from './microvm/pool.js';

export const MICROVM_EXEC_DESCRIPTION = [
  'Run a shell command inside an ISOLATED, SANDBOXED microVM playground bound to',
  'a project, and return its output. Use this to safely run untrusted code, clone',
  'and build a repo, install packages, or compile — inside a throwaway VM with its',
  'own kernel and network namespace, so nothing touches the host filesystem.',
  '',
  '`projectId` is the project the guest is bound to (resolve names via',
  'list_projects). The guest is a persistent scratch workspace: state you create',
  'in one call (a clone, an install) is still there on the next call for the same',
  'project — so you can clone, then build, then test across separate calls. There',
  'is NO host bind mount; the guest cannot see host files. Use microvm_reset to',
  'wipe it and start fresh.',
  '',
  '`command` is run by the guest shell inside a stable working directory. Shell',
  'operators (pipes, &&, redirection) work.',
  '',
  '`network` defaults to "public" (the guest can reach the public internet);',
  'pass "none" for a fully network-isolated guest when running fully untrusted',
  'code. `timeoutMs` bounds a single command (default 120000, max 600000).',
  '',
  'Returns the exit `code`, `stdout`, and `stderr`. A non-zero exit is returned',
  'as data (not an error) so you can react to it. Output is capped (1 MB per',
  'stream) and `truncated` is set when it was clipped. First use will ask the',
  'user for permission — running sandboxed code is a privileged action.'
].join(' ');

export const microvmExecInputSchema = {
  projectId: z
    .string()
    .describe('Id of the project whose playground guest to run in. Resolve via list_projects.'),
  command: z
    .string()
    .describe('The shell command to run inside the guest VM.'),
  network: z
    .enum(['public', 'none'])
    .optional()
    .describe(
      'Network posture for a freshly-booted guest: "public" (default) allows the public internet; "none" fully isolates the network. Ignored if the guest already exists.'
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional per-command timeout in milliseconds (default 120000, max 600000).')
};

export const MICROVM_RESET_DESCRIPTION = [
  'Tear down and forget a project’s microVM playground guest, so the next',
  'microvm_exec for that project boots a clean one. Use this to wipe accumulated',
  'state (a bad clone, a corrupted install) and start fresh. Returns whether a',
  'guest existed. Never fails.'
].join(' ');

export const microvmResetInputSchema = {
  projectId: z
    .string()
    .describe('Id of the project whose playground guest to tear down. Resolve via list_projects.')
};

export interface RegisterMicrovmExecOpts {
  /**
   * Run `command` in the project's playground guest (booting it lazily on first
   * use), returning a captured result. Injected by index.ts so this module never
   * touches the SDK / pool internals directly — main owns the guest lifecycle
   * (Rule 1/7). Never throws: an operational failure (denied image, unsupported
   * platform, boot failure, timeout) comes back as `ok:false`.
   */
  runMicrovmCommand: (
    projectId: string,
    command: string,
    opts: { timeoutMs?: number; network?: 'public' | 'none' }
  ) => Promise<MicroVmExecResult>;
  /**
   * Tear down + forget the project's guest. Never throws. Absent ⇒ the
   * `microvm_reset` tool isn't registered.
   */
  resetMicrovm?: (projectId: string) => Promise<{ ok: true; existed: boolean }>;
}

/**
 * Register the `microvm_exec` (and, if wired, `microvm_reset`) tools. The agent
 * supplies only references (a projectId) and payload (command); the host-owned
 * guest lifecycle lives behind the injected runners.
 */
export function registerMicrovmExecTool(server: McpServer, opts: RegisterMicrovmExecOpts): void {
  const { runMicrovmCommand, resetMicrovm } = opts;

  server.registerTool(
    'microvm_exec',
    {
      description: MICROVM_EXEC_DESCRIPTION,
      inputSchema: microvmExecInputSchema
    },
    async ({ projectId, command, network, timeoutMs }) => {
      try {
        const result = await runMicrovmCommand(projectId, command, {
          ...(network ? { network } : {}),
          ...(timeoutMs ? { timeoutMs } : {})
        });
        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `microvm_exec failed: ${result.message ?? 'unknown error'}` }]
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
          content: [{ type: 'text' as const, text: `microvm_exec failed: ${message}` }]
        };
      }
    }
  );

  if (resetMicrovm) {
    server.registerTool(
      'microvm_reset',
      {
        description: MICROVM_RESET_DESCRIPTION,
        inputSchema: microvmResetInputSchema
      },
      async ({ projectId }) => {
        try {
          const result = await resetMicrovm(projectId);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ projectId, existed: result.existed }, null, 2)
              }
            ]
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `microvm_reset failed: ${message}` }]
          };
        }
      }
    );
  }
}
