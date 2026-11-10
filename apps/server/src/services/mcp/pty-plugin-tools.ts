import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/** One plugin tool as a PTY session sees it. The schema is the plugin's own JSON schema. */
export interface PtyPluginToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface PtyPluginToolResult {
  success: boolean;
  contentItems: Array<{ type: 'inputText'; text: string } | { type: 'inputImage'; imageUrl: string }>;
}

/**
 * Main's plugin-tool seam for the live PTY sessions it owns. Identity is the
 * route's, checked by main against its live session record; the agent supplies
 * only a tool name and arguments. `list` never throws (it lists none on failure);
 * `call` fails closed with a denial result.
 */
export interface PtyPluginTools {
  list(projectId: string, sessionId: string): Promise<PtyPluginToolDescriptor[]>;
  call(projectId: string, sessionId: string, name: string, args: Record<string, unknown>): Promise<PtyPluginToolResult>;
}

const DATA_IMAGE = /^data:(image\/[A-Za-z0-9.+-]+);base64,(.*)$/s;

function toMcpResult(result: PtyPluginToolResult) {
  const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [];
  for (const item of result.contentItems) {
    if (item.type === 'inputText') {
      content.push({ type: 'text', text: item.text });
      continue;
    }
    const match = DATA_IMAGE.exec(item.imageUrl);
    if (match) content.push({ type: 'image', data: match[2]!, mimeType: match[1]! });
  }
  if (content.length === 0) content.push({ type: 'text', text: result.success ? '' : 'Tool failed' });
  return { content, ...(result.success ? {} : { isError: true as const }) };
}

/**
 * Register the live plugin tools of one PTY session on its per-request
 * zcc-inbox server. A tool whose name an earlier registration already holds is
 * skipped, so a plugin can never shadow a built-in. Listing failures register
 * nothing; the session keeps its built-in tools.
 */
export async function registerPtyPluginTools(
  server: McpServer,
  opts: { projectId: string; sessionId: string; pluginTools: PtyPluginTools; log?: (message: string) => void }
): Promise<void> {
  let tools: PtyPluginToolDescriptor[];
  try {
    tools = await opts.pluginTools.list(opts.projectId, opts.sessionId);
  } catch (error) {
    opts.log?.(`plugin tool listing failed for session ${opts.sessionId.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  for (const tool of tools) {
    try {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          // The plugin validates its own arguments per call; this carries only its schema
          // to tools/list, so no second validator can disagree with the plugin's.
          inputSchema: z.looseObject({}).meta(tool.inputSchema)
        },
        async (args: Record<string, unknown>) => toMcpResult(
          await opts.pluginTools.call(opts.projectId, opts.sessionId, tool.name, args)
        )
      );
    } catch {
      // Name already registered by a built-in: the built-in keeps it.
    }
  }
}
