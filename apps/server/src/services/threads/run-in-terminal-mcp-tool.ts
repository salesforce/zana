/**
 * run_in_terminal — session-scoped visible ZCC shell.
 *
 * Identity is closed over from the MCP URL (`/mcp/:projectId/:sessionId`).
 * The agent cannot name another thread. Authorization happens in
 * {@link openThreadTerminal} on the product HTTP side (Rule 1).
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  RUN_IN_TERMINAL_DESCRIPTION,
  HOST_RUN_IN_TERMINAL_TOOL_NAME
} from './host-run-in-terminal-tool.js';
import { RUN_IN_TERMINAL_COMMAND_MAX, RUN_IN_TERMINAL_TITLE_MAX } from './open-thread-terminal.js';

export const runInTerminalInputSchema = {
  command: z
    .string()
    .max(RUN_IN_TERMINAL_COMMAND_MAX)
    .optional()
    .describe('Optional shell command to run (`$SHELL -lc`). Empty opens an idle login shell.'),
  title: z
    .string()
    .max(RUN_IN_TERMINAL_TITLE_MAX)
    .optional()
    .describe('Optional tab title. Defaults to the command or "Terminal".')
};

export interface RunInTerminalToolRequest {
  threadId: string;
  projectId: string;
  command: string | null;
  title: string | null;
}

export interface RunInTerminalToolResult {
  delivered: number;
  command: string | null;
  title: string | null;
}

export interface RegisterRunInTerminalOpts {
  threadId: string;
  projectId: string;
  runInTerminal?: (input: RunInTerminalToolRequest) => Promise<RunInTerminalToolResult>;
}

function jsonResult(payload: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function errorResult(message: string): {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
} {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export function registerRunInTerminalTool(server: McpServer, opts: RegisterRunInTerminalOpts): void {
  server.registerTool(
    HOST_RUN_IN_TERMINAL_TOOL_NAME,
    {
      description: RUN_IN_TERMINAL_DESCRIPTION,
      inputSchema: runInTerminalInputSchema
    },
    async ({ command, title }) => {
      if (!opts.runInTerminal) {
        return errorResult('In-app terminals are only available in the desktop app.');
      }
      try {
        const result = await opts.runInTerminal({
          threadId: opts.threadId,
          projectId: opts.projectId,
          command: typeof command === 'string' ? command : null,
          title: typeof title === 'string' ? title : null
        });
        if (result.delivered === 0) {
          return errorResult('No connected app window received the terminal. Is the desktop app open?');
        }
        return jsonResult({
          ok: true,
          command: result.command,
          title: result.title
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : 'terminal open failed');
      }
    }
  );
}
