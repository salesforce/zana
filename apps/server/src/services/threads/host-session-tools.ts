/**
 * Host DynamicTools packed onto every conversation session.
 *
 * Conversation threads (ACP Cursor, Claude Code SDK, Codex, Pi) never receive
 * the PTY zcc-inbox MCP server. Share the same product actions as host
 * DynamicTools (the preview_file pattern): one choke point in handleHostToolCall,
 * identity closed over from the owning conversation row (Rule 1).
 *
 * Do not attach a zcc-inbox MCP URL to ACP/SDK/Codex/Pi.
 */

import type { DynamicTool, ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';
import {
  HOST_SESSION_INSTRUCTIONS_MAX,
  HOST_SESSION_TOOLS_MAX
} from '../../plugins/plugin-agent-tools.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import {
  HOST_PREVIEW_FILE_INSTRUCTION,
  HOST_PREVIEW_FILE_TOOL,
  HOST_PREVIEW_FILE_TOOL_NAME,
  invokeHostPreviewFileTool,
  type PackedSessionTooling
} from './host-preview-file-tool.js';
import {
  HOST_BROWSER_INSTRUCTION,
  HOST_BROWSER_TOOL_NAMES,
  HOST_BROWSER_TOOLS,
  invokeHostBrowserTool
} from './host-browser-tools.js';
import {
  HOST_INBOX_INSTRUCTION,
  HOST_INBOX_TOOLS,
  INBOX_PUSH_NAME,
  INBOX_SEARCH_NAME,
  SUGGEST_ACTION_NAME,
  invokeHostInboxTool
} from './host-inbox-tools.js';
import {
  CREATE_LOCAL_EXTENSION_NAME,
  HOST_CATALOG_INSTRUCTION,
  HOST_CATALOG_TOOLS,
  LIST_PROJECTS_NAME,
  REGISTER_PROJECT_NAME,
  invokeHostCatalogTool
} from './host-catalog-tools.js';
import {
  HOST_LIBRARY_INSTRUCTION,
  HOST_LIBRARY_TOOLS,
  LIBRARY_LIST_NAME,
  LIBRARY_READ_NAME,
  LIBRARY_REMOVE_NAME,
  LIBRARY_WRITE_NAME,
  invokeHostLibraryTool
} from './host-library-tools.js';
import {
  GOAL_CREATE_NAME,
  GOAL_LIST_NAME,
  HOST_GOAL_INSTRUCTION,
  HOST_GOAL_TOOLS,
  invokeHostGoalTool
} from './host-goal-tools.js';
import {
  HOST_SCHEDULE_INSTRUCTION,
  HOST_SCHEDULE_TOOLS,
  SCHEDULE_LIST_NAME,
  SCHEDULE_RUN_NOW_NAME,
  SCHEDULE_SET_ENABLED_NAME,
  invokeHostScheduleTool
} from './host-schedule-tools.js';

export type { PackedSessionTooling };

export const HOST_SHARE_TOOL_NAMES = [
  HOST_PREVIEW_FILE_TOOL_NAME,
  ...HOST_BROWSER_TOOL_NAMES,
  INBOX_PUSH_NAME,
  INBOX_SEARCH_NAME,
  SUGGEST_ACTION_NAME,
  LIBRARY_WRITE_NAME,
  LIBRARY_READ_NAME,
  LIBRARY_LIST_NAME,
  LIBRARY_REMOVE_NAME,
  GOAL_CREATE_NAME,
  GOAL_LIST_NAME,
  SCHEDULE_LIST_NAME,
  SCHEDULE_RUN_NOW_NAME,
  SCHEDULE_SET_ENABLED_NAME,
  LIST_PROJECTS_NAME,
  REGISTER_PROJECT_NAME,
  CREATE_LOCAL_EXTENSION_NAME
] as const;

export const HOST_ADAPT_TOOL_NAMES = [
  'inbox_ask',
  'followup_create',
  'followup_list',
  'followup_resolve',
  'close_session',
  'close_session_with_summary',
  'install_local_extension',
  'clone_project',
  'remote_exec',
  'remote_read',
  'remote_write',
  'remote_list',
  'microvm_exec',
  'microvm_reset'
] as const;

export const HOST_PTY_ONLY_TOOL_NAMES = [
  'schedule_report',
  'register_agent',
  'list_agents',
  'find_agent',
  'agent_send',
  'agent_inbox',
  'close_idle_agents',
  'complete_autonomous_run'
] as const;

const HOST_SESSION_TOOLS: DynamicTool[] = [
  HOST_PREVIEW_FILE_TOOL,
  ...HOST_BROWSER_TOOLS,
  ...HOST_INBOX_TOOLS,
  ...HOST_LIBRARY_TOOLS,
  ...HOST_GOAL_TOOLS,
  ...HOST_SCHEDULE_TOOLS,
  ...HOST_CATALOG_TOOLS
];

export const HOST_SESSION_INSTRUCTION = [
  HOST_PREVIEW_FILE_INSTRUCTION,
  HOST_BROWSER_INSTRUCTION,
  HOST_INBOX_INSTRUCTION,
  HOST_LIBRARY_INSTRUCTION,
  HOST_GOAL_INSTRUCTION,
  HOST_SCHEDULE_INSTRUCTION,
  HOST_CATALOG_INSTRUCTION
].join('\n');

const HOST_SESSION_TOOL_NAME_SET = new Set<string>(HOST_SHARE_TOOL_NAMES);

export function isHostSessionTool(name: string): boolean {
  return HOST_SESSION_TOOL_NAME_SET.has(name);
}

export function mergeHostSessionTooling(packed: PackedSessionTooling): PackedSessionTooling {
  const pluginTools = (packed.dynamicTools ?? []).filter((tool) => !isHostSessionTool(tool.name));
  const tools = [...HOST_SESSION_TOOLS, ...pluginTools].slice(0, HOST_SESSION_TOOLS_MAX);
  const instructions = [HOST_SESSION_INSTRUCTION, packed.instructions]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n\n')
    .slice(0, HOST_SESSION_INSTRUCTIONS_MAX)
    .trim();
  return {
    dynamicTools: tools,
    ...(instructions ? { instructions } : {})
  };
}

export async function invokeHostSessionTool(
  ctx: ProductHttpContext,
  args: { name: string; threadId: string; projectId: string; input: unknown }
): Promise<ToolCallResponse> {
  const { name } = args;
  if (name === HOST_PREVIEW_FILE_TOOL_NAME) {
    return invokeHostPreviewFileTool(ctx, args);
  }
  if ((HOST_BROWSER_TOOL_NAMES as readonly string[]).includes(name)) {
    return invokeHostBrowserTool(ctx, args);
  }
  if (name === INBOX_PUSH_NAME || name === INBOX_SEARCH_NAME || name === SUGGEST_ACTION_NAME) {
    return invokeHostInboxTool(ctx, args);
  }
  if (
    name === LIBRARY_WRITE_NAME ||
    name === LIBRARY_READ_NAME ||
    name === LIBRARY_LIST_NAME ||
    name === LIBRARY_REMOVE_NAME
  ) {
    return invokeHostLibraryTool(ctx, args);
  }
  if (name === GOAL_CREATE_NAME || name === GOAL_LIST_NAME) {
    return invokeHostGoalTool(ctx, args);
  }
  if (
    name === SCHEDULE_LIST_NAME ||
    name === SCHEDULE_RUN_NOW_NAME ||
    name === SCHEDULE_SET_ENABLED_NAME
  ) {
    return invokeHostScheduleTool(ctx, args);
  }
  if (
    name === LIST_PROJECTS_NAME ||
    name === REGISTER_PROJECT_NAME ||
    name === CREATE_LOCAL_EXTENSION_NAME
  ) {
    return invokeHostCatalogTool(ctx, args);
  }
  return {
    success: false,
    contentItems: [{ type: 'inputText', text: `Unsupported tool: ${name}` }]
  };
}
