/**
 * Host `run_in_terminal` for conversation threads.
 *
 * PTY Claude gets this via the zcc-inbox MCP server when the experimental
 * flag is on. Conversation sessions only receive plugin `dynamicTools`, so
 * "open a terminal" fell through to Terminal.app / Cursor. Packed only when
 * `inAppAgentTerminalsEnabled` is on (subsequent launches).
 */

import type { DynamicTool, ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';
import { pluginToolResultToResponse } from '../../plugins/plugin-agent-tools.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import {
  openThreadTerminal,
  openThreadTerminalDepsFromContext,
  RunInTerminalError,
  RUN_IN_TERMINAL_COMMAND_MAX,
  RUN_IN_TERMINAL_TITLE_MAX
} from './open-thread-terminal.js';

export const HOST_RUN_IN_TERMINAL_TOOL_NAME = 'run_in_terminal';

export const RUN_IN_TERMINAL_DESCRIPTION = [
  "Open a visible ZCC shell in this thread's right-hand side panel (or a project Terminals tab for a CLI Agent).",
  'Use this when you would otherwise open Terminal.app, iTerm, WezTerm, Alacritty, `open -a`, osascript, or Cursor/VS Code’s terminal.',
  'Optional command runs in that shell. Keep using native Bash/Shell for short commands you only need the output of.'
].join(' ');

export const HOST_RUN_IN_TERMINAL_INSTRUCTION = [
  'When you would open a standalone terminal so the user can watch a command, call `run_in_terminal`.',
  "That opens a ZCC shell in this thread's side panel.",
  'Do not use `open -a Terminal` / iTerm / WezTerm / Alacritty, osascript, or Cursor/VS Code terminal CLIs.',
  'Keep using native Bash/Shell for short commands you only need the output of.'
].join(' ');

export const HOST_RUN_IN_TERMINAL_TOOL: DynamicTool = {
  name: HOST_RUN_IN_TERMINAL_TOOL_NAME,
  description: RUN_IN_TERMINAL_DESCRIPTION,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      command: {
        type: 'string',
        maxLength: RUN_IN_TERMINAL_COMMAND_MAX,
        description: 'Optional shell command to run (`$SHELL -lc`). Empty opens an idle login shell.'
      },
      title: {
        type: 'string',
        maxLength: RUN_IN_TERMINAL_TITLE_MAX,
        description: 'Optional tab title. Defaults to the command or "Terminal".'
      }
    }
  },
  presentation: {
    label: { pending: 'Opening terminal', completed: 'Opened terminal' },
    icon: { glyph: 'Terminal' }
  }
};

function parseRunInTerminalArguments(input: unknown): { command: string | null; title: string | null } {
  if (input === undefined || input === null) return { command: null, title: null };
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new RunInTerminalError(400, 'invalid-request', 'run_in_terminal requires an object');
  }
  const row = input as Record<string, unknown>;
  const command = row.command === undefined || row.command === null
    ? null
    : typeof row.command === 'string'
      ? row.command
      : (() => {
        throw new RunInTerminalError(400, 'invalid-request', 'run_in_terminal command must be a string');
      })();
  const title = row.title === undefined || row.title === null
    ? null
    : typeof row.title === 'string'
      ? row.title
      : (() => {
        throw new RunInTerminalError(400, 'invalid-request', 'run_in_terminal title must be a string');
      })();
  return { command, title };
}

export function invokeHostRunInTerminalTool(
  ctx: ProductHttpContext,
  args: { threadId: string; projectId: string; input: unknown }
): ToolCallResponse {
  if (ctx.config.getConfig().inAppAgentTerminalsEnabled !== true) {
    return pluginToolResultToResponse(HOST_RUN_IN_TERMINAL_TOOL_NAME, {
      ok: false,
      error: 'In-app agent terminals are off. Enable “Keep agent terminals in ZCC” in Settings → Experimental features, then start a new session.'
    });
  }
  try {
    const parsed = parseRunInTerminalArguments(args.input);
    const result = openThreadTerminal(openThreadTerminalDepsFromContext(ctx), {
      threadId: args.threadId,
      projectId: args.projectId,
      command: parsed.command,
      title: parsed.title
    });
    if (result.delivered === 0) {
      return pluginToolResultToResponse(HOST_RUN_IN_TERMINAL_TOOL_NAME, {
        ok: false,
        error: 'No connected app window received the terminal. Is the desktop app open?'
      });
    }
    return pluginToolResultToResponse(HOST_RUN_IN_TERMINAL_TOOL_NAME, {
      ok: true,
      command: result.command,
      title: result.title
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'terminal open failed';
    return pluginToolResultToResponse(HOST_RUN_IN_TERMINAL_TOOL_NAME, {
      ok: false,
      error: message
    });
  }
}
