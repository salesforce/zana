/**
 * preview_file — session-scoped side-panel file preview.
 *
 * Identity is closed over from the MCP URL (`/mcp/:projectId/:sessionId`).
 * The agent cannot name another thread. Path confinement happens in
 * {@link openThreadFilePreview} on the product HTTP side (Rule 2).
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PanelFileSource } from '@zana-ai/zcc-server-contract';

const MAX_PATH_LENGTH = 1024;

export const PREVIEW_FILE_DESCRIPTION = [
  "Open a file in this thread's visible side-panel preview tab.",
  'Use this when the user should SEE the file — a report, a diagram, a config you just wrote.',
  'Keep using Read for your own inspection. Do not preview every file you touch.',
  'Paths are relative to this project (workspace) or thread storage.'
].join(' ');

export const previewFileInputSchema = {
  path: z
    .string()
    .min(1)
    .max(MAX_PATH_LENGTH)
    .describe("File path relative to the project root, e.g. 'docs/report.md'."),
  source: z
    .enum(['workspace', 'thread-storage'])
    .optional()
    .describe("Which root the path is under. Defaults to 'workspace'."),
  lineNumber: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional 1-based line to highlight when the preview supports it.')
};

export interface PreviewFileToolRequest {
  threadId: string;
  projectId: string;
  source: PanelFileSource;
  path: string;
  lineNumber: number | null;
}

export interface PreviewFileToolResult {
  delivered: number;
  path: string;
  source: PanelFileSource;
}

export interface RegisterPreviewFileOpts {
  threadId: string;
  projectId: string;
  previewFile?: (input: PreviewFileToolRequest) => Promise<PreviewFileToolResult>;
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

export function registerPreviewFileTool(server: McpServer, opts: RegisterPreviewFileOpts): void {
  server.registerTool(
    'preview_file',
    {
      description: PREVIEW_FILE_DESCRIPTION,
      inputSchema: previewFileInputSchema
    },
    async ({ path, source, lineNumber }) => {
      if (!opts.previewFile) {
        return errorResult('File preview is only available in the desktop app.');
      }
      try {
        const result = await opts.previewFile({
          threadId: opts.threadId,
          projectId: opts.projectId,
          source: source ?? 'workspace',
          path,
          lineNumber: typeof lineNumber === 'number' && lineNumber > 0 ? lineNumber : null
        });
        if (result.delivered === 0) {
          return errorResult('No connected app window received the preview. Is the desktop app open?');
        }
        return jsonResult({
          ok: true,
          path: result.path,
          source: result.source
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : 'preview failed');
      }
    }
  );
}
