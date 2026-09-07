/**
 * Host `preview_file` for conversation threads.
 *
 * PTY Claude already gets this via the zcc-inbox MCP server. Conversation
 * sessions (ACP Cursor, Claude Code SDK, Codex, Pi) only receive plugin
 * `dynamicTools`, so "open this file" fell through to the agent's native
 * editor Open — Cursor.app instead of the thread side panel. This tool is
 * packed onto every conversation session and answered on the host tool-call
 * path before plugin dispatch (Rule 1: thread identity from the owning row).
 */

import type { DynamicTool, ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';
import type { PanelFileSource } from '@zana-ai/zcc-server-contract';
import {
  HOST_SESSION_INSTRUCTIONS_MAX,
  HOST_SESSION_TOOLS_MAX
} from '../../plugins/plugin-agent-tools.js';
import { pluginToolResultToResponse } from '../../plugins/plugin-agent-tools.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import {
  openThreadFilePreview,
  PreviewFileError,
  previewFileDepsFromContext
} from './preview-file.js';

export const HOST_PREVIEW_FILE_TOOL_NAME = 'preview_file';

const MAX_PATH_LENGTH = 1024;

export const PREVIEW_FILE_DESCRIPTION = [
  "Open a file in this thread's visible right-hand side-panel preview.",
  'Use this whenever the user asks you to open, show, or preview a file.',
  'Do not open files in Cursor, VS Code, or via the open/cursor/code CLI — those leave this app.',
  'Keep using Read for your own inspection. Do not preview every file you touch.',
  'Paths are relative to this project (workspace) or thread storage.'
].join(' ');

export const HOST_PREVIEW_FILE_INSTRUCTION = [
  'When the user asks you to open, show, or preview a file, call `preview_file`.',
  "That opens this thread's right-hand preview tab.",
  'Do not open files in Cursor, VS Code, or via `open` / `cursor` / `code` CLI.'
].join(' ');

export const HOST_PREVIEW_FILE_TOOL: DynamicTool = {
  name: HOST_PREVIEW_FILE_TOOL_NAME,
  description: PREVIEW_FILE_DESCRIPTION,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: {
      path: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_PATH_LENGTH,
        description: "File path relative to the project root, e.g. 'docs/report.md'."
      },
      source: {
        type: 'string',
        enum: ['workspace', 'thread-storage'],
        description: "Which root the path is under. Defaults to 'workspace'."
      },
      lineNumber: {
        type: 'integer',
        minimum: 1,
        description: 'Optional 1-based line to highlight when the preview supports it.'
      }
    }
  },
  presentation: {
    label: { pending: 'Opening preview', completed: 'Opened preview' },
    icon: { glyph: 'FileText' }
  }
};

export interface PackedSessionTooling {
  dynamicTools?: DynamicTool[];
  instructions?: string;
}

export function mergeHostPreviewFileTooling(packed: PackedSessionTooling): PackedSessionTooling {
  const pluginTools = (packed.dynamicTools ?? []).filter(
    (tool) => tool.name !== HOST_PREVIEW_FILE_TOOL_NAME
  );
  const tools = [HOST_PREVIEW_FILE_TOOL, ...pluginTools].slice(0, HOST_SESSION_TOOLS_MAX);
  const instructions = [HOST_PREVIEW_FILE_INSTRUCTION, packed.instructions]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n\n')
    .slice(0, HOST_SESSION_INSTRUCTIONS_MAX)
    .trim();
  return {
    dynamicTools: tools,
    ...(instructions ? { instructions } : {})
  };
}

function parsePreviewFileArguments(input: unknown): {
  path: string;
  source: PanelFileSource;
  lineNumber: number | null;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PreviewFileError(400, 'invalid-request', 'preview_file requires an object with path');
  }
  const row = input as Record<string, unknown>;
  if (typeof row.path !== 'string' || row.path.trim().length === 0) {
    throw new PreviewFileError(400, 'invalid-request', 'preview_file requires a non-empty path');
  }
  if (row.path.length > MAX_PATH_LENGTH) {
    throw new PreviewFileError(400, 'invalid-request', 'preview_file path is too long');
  }
  const source = row.source === 'thread-storage' ? 'thread-storage' : 'workspace';
  if (row.source !== undefined && row.source !== 'workspace' && row.source !== 'thread-storage') {
    throw new PreviewFileError(400, 'invalid-request', "preview_file source must be 'workspace' or 'thread-storage'");
  }
  const lineNumber = typeof row.lineNumber === 'number' && Number.isInteger(row.lineNumber) && row.lineNumber > 0
    ? row.lineNumber
    : null;
  return { path: row.path, source, lineNumber };
}

export function invokeHostPreviewFileTool(
  ctx: ProductHttpContext,
  args: { threadId: string; projectId: string; input: unknown }
): ToolCallResponse {
  try {
    const parsed = parsePreviewFileArguments(args.input);
    const result = openThreadFilePreview(previewFileDepsFromContext(ctx), {
      threadId: args.threadId,
      projectId: args.projectId,
      source: parsed.source,
      path: parsed.path,
      lineNumber: parsed.lineNumber
    });
    if (result.delivered === 0) {
      return pluginToolResultToResponse(HOST_PREVIEW_FILE_TOOL_NAME, {
        ok: false,
        error: 'No connected app window received the preview. Is the desktop app open?'
      });
    }
    return pluginToolResultToResponse(HOST_PREVIEW_FILE_TOOL_NAME, {
      ok: true,
      path: result.path,
      source: result.source
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'preview failed';
    return pluginToolResultToResponse(HOST_PREVIEW_FILE_TOOL_NAME, {
      ok: false,
      error: message
    });
  }
}
