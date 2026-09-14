import type {
  PluginAgentConfigureContext,
  PluginAgentConfigureResult,
  PluginAgentToolContext,
  PluginAgentToolRecord
} from '@zana-ai/zcc-plugin-sdk/server';
import type { DynamicTool, ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';
import { deepFreezePluginMetadata } from '@zana-ai/zcc-domain/thread-runtime';

export const GENERIC_AGENT_TOOL_GLYPH = 'Toolbox';

export interface PluginAgentToolSource {
  pluginId: string;
  tools: readonly PluginAgentToolRecord[];
  configurers?: ReadonlyArray<
    (
      ctx: PluginAgentConfigureContext
    ) => PluginAgentConfigureResult | void | Promise<PluginAgentConfigureResult | void>
  >;
  extraInstructions?: readonly string[];
  extraInstructionProviders?: ReadonlyArray<(ctx: { threadId: string; projectId: string }) => string | null>;
  pluginMetadata?: import('@zana-ai/zcc-domain/thread-runtime').JsonObject;
}

export interface PluginSessionTools {
  tools: DynamicTool[];
  instructions?: string;
}

export const HOST_SESSION_TOOLS_MAX = 128;
export const HOST_SESSION_INSTRUCTIONS_MAX = 100_000;
export const LIVE_INSTRUCTION_MAX = 4_096;

export function packHostSessionTooling(
  session: PluginSessionTools | undefined | null
): { dynamicTools?: DynamicTool[]; instructions?: string } {
  if (!session) return {};
  const tools = session.tools.slice(0, HOST_SESSION_TOOLS_MAX);
  const instructions = session.instructions?.slice(0, HOST_SESSION_INSTRUCTIONS_MAX).trim();
  return {
    ...(tools.length > 0 ? { dynamicTools: tools } : {}),
    ...(instructions ? { instructions } : {})
  };
}

export async function safePackPluginSession(
  load?: () => Promise<PluginSessionTools | undefined>
): Promise<{ dynamicTools?: DynamicTool[]; instructions?: string }> {
  if (!load) return {};
  try {
    return packHostSessionTooling(await load());
  } catch {
    return {};
  }
}

export function toDynamicTool(registration: PluginAgentToolRecord): DynamicTool {
  const declared = registration.presentation;
  return {
    name: registration.name,
    description: registration.description,
    inputSchema: registration.inputSchema ?? { type: 'object', properties: {} },
    presentation: {
      label: declared?.label ?? {
        pending: `Running ${registration.name}`,
        completed: `Ran ${registration.name}`
      },
      icon: { glyph: declared?.icon?.glyph ?? GENERIC_AGENT_TOOL_GLYPH },
      ...(declared?.suppress !== undefined ? { suppress: declared.suppress } : {}),
      ...(declared?.tint ? { tint: declared.tint } : {})
    }
  };
}

const MAX_PLUGIN_TOOL_IMAGES = 8;

export function pluginToolResultToResponse(name: string, value: unknown): ToolCallResponse {
  const text = stringifyToolResult(value);
  const failed = isFailedToolResult(value);
  const images = collectToolImages(value);
  return {
    success: !failed,
    contentItems: [
      { type: 'inputText', text: text || (failed ? `Tool "${name}" failed` : '') },
      ...images
    ]
  };
}

export async function resolvePluginSessionTools(
  sources: readonly PluginAgentToolSource[],
  ctx: PluginAgentConfigureContext
): Promise<PluginSessionTools> {
  const tools: DynamicTool[] = [];
  const seen = new Set<string>();
  const instructionParts: string[] = [];

  for (const source of sources) {
    const extra = (source.extraInstructions ?? []).map((row) => row.trim()).filter(Boolean);
    instructionParts.push(...extra);
    for (const provider of source.extraInstructionProviders ?? []) {
      try {
        const raw = provider({
          threadId: ctx.threadId ?? '',
          projectId: ctx.projectId ?? ''
        });
        const trimmed = typeof raw === 'string' ? raw.trim().slice(0, LIVE_INSTRUCTION_MAX) : '';
        if (trimmed) instructionParts.push(trimmed);
      } catch {
        /* a throwing provider contributes nothing */
      }
    }

    const configured = await configurePlugin(source, ctx);
    instructionParts.push(...configured.instructions);
    if (configured.selected === 'none') continue;

    for (const registration of source.tools) {
      if (configured.selected !== 'all' && !configured.selected.has(registration.name)) continue;
      if (seen.has(registration.name)) continue;
      seen.add(registration.name);
      const override = configured.parameterOverrides.get(registration.name);
      const packed = toDynamicTool(registration);
      tools.push(
        override === undefined ? packed : { ...packed, inputSchema: override }
      );
      if (registration.instructions) {
        instructionParts.push(
          `The following instructions come from the ZCC plugin "${source.pluginId}" for its tool "${registration.name}":`,
          registration.instructions
        );
      }
    }
  }

  const instructions = instructionParts.join('\n\n').trim();
  return {
    tools,
    ...(instructions ? { instructions } : {})
  };
}

export async function invokePluginAgentTool(
  sources: readonly PluginAgentToolSource[],
  name: string,
  input: unknown,
  ctx: PluginAgentToolContext
): Promise<ToolCallResponse> {
  for (const source of sources) {
    const registration = source.tools.find((tool) => tool.name === name);
    if (!registration) continue;
    const parsed = registration.parse(input);
    if (!parsed.ok) {
      return {
        success: false,
        contentItems: [{
          type: 'inputText',
          text: `Invalid arguments for tool "${name}": ${parsed.error}`
        }]
      };
    }
    try {
      const value = await registration.execute(parsed.value, ctx);
      return pluginToolResultToResponse(name, value);
    } catch (error) {
      return {
        success: false,
        contentItems: [{
          type: 'inputText',
          text: `Tool "${name}" failed: ${error instanceof Error ? error.message : String(error)}`
        }]
      };
    }
  }
  return {
    success: false,
    contentItems: [{ type: 'inputText', text: `Unsupported tool: ${name}` }]
  };
}

async function configurePlugin(
  source: PluginAgentToolSource,
  ctx: PluginAgentConfigureContext
): Promise<{
  selected: 'all' | 'none' | Set<string>;
  instructions: string[];
  parameterOverrides: Map<string, unknown>;
}> {
  const configurers = source.configurers ?? [];
  if (configurers.length === 0) {
    return { selected: 'all', instructions: [], parameterOverrides: new Map() };
  }

  let selected: Set<string> | null = null;
  const instructions: string[] = [];
  const parameterOverrides = new Map<string, unknown>();
  for (const configure of configurers) {
    try {
      const result = await configure({
        ...ctx,
        pluginMetadata: deepFreezePluginMetadata(structuredClone(source.pluginMetadata ?? {}))
      });
      if (!result) continue;
      if (Array.isArray(result.tools)) {
        const names = new Set<string>();
        for (const tool of result.tools) {
          if (typeof tool === 'string') {
            names.add(tool);
            continue;
          }
          if (tool && typeof tool === 'object' && typeof tool.name === 'string') {
            names.add(tool.name);
            if (tool.parameters !== undefined) parameterOverrides.set(tool.name, tool.parameters);
          }
        }
        selected = names;
      }
      const text = result.instructions?.trim();
      if (text) instructions.push(text);
    } catch {
      return { selected: 'none', instructions, parameterOverrides };
    }
  }
  return { selected: selected ?? 'none', instructions, parameterOverrides };
}

function collectToolImages(value: unknown): Array<{ type: 'inputImage'; imageUrl: string }> {
  if (!value || typeof value !== 'object') return [];
  const items: Array<{ type: 'inputImage'; imageUrl: string }> = [];
  const screenshots = (value as { screenshots?: unknown }).screenshots;
  if (Array.isArray(screenshots)) {
    for (const shot of screenshots) {
      if (!shot || typeof shot !== 'object') continue;
      const mime = typeof (shot as { mime?: unknown }).mime === 'string'
        ? (shot as { mime: string }).mime
        : 'image/png';
      const base64 = typeof (shot as { base64?: unknown }).base64 === 'string'
        ? (shot as { base64: string }).base64
        : '';
      if (!base64 || !mime.startsWith('image/')) continue;
      items.push({ type: 'inputImage', imageUrl: `data:${mime};base64,${base64}` });
      if (items.length >= MAX_PLUGIN_TOOL_IMAGES) return items;
    }
  }
  const content = (value as { content?: unknown }).content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const type = (part as { type?: unknown }).type;
      if (type !== 'image' && type !== 'inputImage') continue;
      const mime = typeof (part as { mimeType?: unknown }).mimeType === 'string'
        ? (part as { mimeType: string }).mimeType
        : 'image/png';
      const data = typeof (part as { data?: unknown }).data === 'string'
        ? (part as { data: string }).data
        : '';
      const imageUrl = typeof (part as { imageUrl?: unknown }).imageUrl === 'string'
        ? (part as { imageUrl: string }).imageUrl
        : data
          ? `data:${mime};base64,${data}`
          : '';
      if (!imageUrl.startsWith('data:image/')) continue;
      items.push({ type: 'inputImage', imageUrl });
      if (items.length >= MAX_PLUGIN_TOOL_IMAGES) return items;
    }
  }
  return items;
}

function stringifyToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  if (value && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string') {
    return (value as { text: string }).text;
  }
  if (value && typeof value === 'object' && 'content' in value && Array.isArray((value as { content: unknown }).content)) {
    return (value as { content: Array<{ text?: unknown }> }).content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  try {
    if (value && typeof value === 'object' && 'screenshots' in value) {
      const { screenshots: _screenshots, ...rest } = value as { screenshots?: unknown } & Record<string, unknown>;
      return JSON.stringify(rest);
    }
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isFailedToolResult(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if ('ok' in value && (value as { ok: unknown }).ok === false) return true;
  return 'isError' in value && (value as { isError: unknown }).isError === true;
}
