import type {
  PluginAgentConfigureContext,
  PluginAgentConfigureResult,
  PluginAgentToolContext,
  PluginAgentToolRegistration
} from '@zana-ai/zcc-plugin-sdk/server';
import type { DynamicTool, ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';

export interface PluginAgentToolSource {
  pluginId: string;
  tools: readonly PluginAgentToolRegistration[];
  configurers?: ReadonlyArray<
    (
      ctx: PluginAgentConfigureContext
    ) => PluginAgentConfigureResult | void | Promise<PluginAgentConfigureResult | void>
  >;
  extraInstructions?: readonly string[];
}

export interface PluginSessionTools {
  tools: DynamicTool[];
  instructions?: string;
}

export function toDynamicTool(registration: PluginAgentToolRegistration): DynamicTool {
  return {
    name: registration.name,
    description: registration.description,
    inputSchema: registration.inputSchema ?? { type: 'object', properties: {} }
  };
}

export function pluginToolResultToResponse(name: string, value: unknown): ToolCallResponse {
  const text = stringifyToolResult(value);
  const failed = isFailedToolResult(value);
  return {
    success: !failed,
    contentItems: [{ type: 'inputText', text: text || (failed ? `Tool "${name}" failed` : '') }]
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

    const configured = await configurePlugin(source, ctx);
    instructionParts.push(...configured.instructions);
    if (configured.selected === 'none') continue;

    for (const registration of source.tools) {
      if (configured.selected !== 'all' && !configured.selected.has(registration.name)) continue;
      if (seen.has(registration.name)) continue;
      seen.add(registration.name);
      tools.push(toDynamicTool(registration));
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
    try {
      const value = await registration.execute(input, ctx);
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
): Promise<{ selected: 'all' | 'none' | Set<string>; instructions: string[] }> {
  const configurers = source.configurers ?? [];
  if (configurers.length === 0) return { selected: 'all', instructions: [] };

  let selected: Set<string> | null = null;
  const instructions: string[] = [];
  for (const configure of configurers) {
    try {
      const result = await configure(ctx);
      if (!result) continue;
      if (Array.isArray(result.tools)) selected = new Set(result.tools);
      const text = result.instructions?.trim();
      if (text) instructions.push(text);
    } catch {
      return { selected: 'none', instructions };
    }
  }
  return { selected: selected ?? 'none', instructions };
}

function stringifyToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isFailedToolResult(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'ok' in value && (value as { ok: unknown }).ok === false);
}
