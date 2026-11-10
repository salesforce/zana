import {
  type DynamicTool,
  experimental_buildBridgeToolCallContent,
} from "@zana-ai/zcc-plugin-sdk/provider-bridge";
import type {
  McpSdkServerConfigWithInstance,
  McpServerConfig,
} from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { SessionMcpServer } from "@zana-ai/zcc-plugin-sdk/provider-bridge";
import { ZCC_BRIDGE_MCP_SERVER_NAME } from "../tool-classification.js";

export const BRIDGE_MCP_SERVER_NAME = ZCC_BRIDGE_MCP_SERVER_NAME;

type BridgeToolCallContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type ToolCallForwarder = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<{
  content: string;
  contentBlocks?: BridgeToolCallContent[];
  isError?: boolean;
}>;

export function buildBridgeMcpServer(
  dynamicTools: DynamicTool[],
  forwardToolCall: ToolCallForwarder,
): McpSdkServerConfigWithInstance {
  const toolsByName = new Map(dynamicTools.map((def) => [def.name, def]));
  const instance = new McpServer(
    { name: BRIDGE_MCP_SERVER_NAME, version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  instance.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: dynamicTools.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: normalizeInputSchema(def.inputSchema),
    })),
  }));
  instance.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const def = toolsByName.get(request.params.name);
    if (def === undefined) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Unknown tool: ${request.params.name}`,
          },
        ],
        isError: true,
      };
    }
    const result = await forwardToolCall(
      def.name,
      request.params.arguments ?? {},
    );
    return {
      content: experimental_buildBridgeToolCallContent(result),
      ...(result.isError ? { isError: true } : {}),
    };
  });
  return { type: "sdk", name: BRIDGE_MCP_SERVER_NAME, instance };
}

export function getAllowedToolNames(dynamicTools: DynamicTool[]): string[] {
  return dynamicTools.map(
    (def) => `mcp__${BRIDGE_MCP_SERVER_NAME}__${def.name}`,
  );
}

function normalizeInputSchema(
  inputSchema: unknown,
): Record<string, unknown> & { type: "object" } {
  if (
    inputSchema !== null &&
    typeof inputSchema === "object" &&
    !Array.isArray(inputSchema) &&
    (inputSchema as { type?: unknown }).type === "object"
  ) {
    return inputSchema as Record<string, unknown> & { type: "object" };
  }
  return { type: "object" };
}

/**
 * Plugin-contributed MCP servers (already selected and validated by the host)
 * as SDK server configs, keyed by their `plugin_<id>_<name>` name. A stdio
 * entry without a command and a remote entry without a url are skipped, as is
 * any name that would replace the bridge's own server. Their tools are not
 * pre-allowed: calls go through the session's normal permission flow. Env
 * values may be secrets and are never logged here.
 */
export function buildPluginMcpServerConfigs(
  servers: readonly SessionMcpServer[] | undefined,
): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  for (const server of servers ?? []) {
    if (server.name === BRIDGE_MCP_SERVER_NAME || server.name in out) continue;
    if (server.type === "stdio") {
      if (!server.command) continue;
      out[server.name] = {
        type: "stdio",
        command: server.command,
        ...(server.args ? { args: [...server.args] } : {}),
        ...(server.env ? { env: { ...server.env } } : {}),
      };
    } else if (server.url) {
      out[server.name] = {
        type: server.type === "sse" ? "sse" : "http",
        url: server.url,
      };
    }
  }
  return out;
}

export function addPluginMcpServers(
  sessionOptions: { mcpServers?: Record<string, McpServerConfig> },
  servers: readonly SessionMcpServer[] | undefined,
): void {
  const plugin = buildPluginMcpServerConfigs(servers);
  if (Object.keys(plugin).length === 0) return;
  sessionOptions.mcpServers = { ...plugin, ...sessionOptions.mcpServers };
}
