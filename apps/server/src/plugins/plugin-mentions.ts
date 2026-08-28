import type { PromptInput } from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCreateError } from '../http/thread-create.js';

export const PLUGIN_MENTION_RESOLVE_TIMEOUT_MS = 5_000;

export interface PluginMentionResolver {
  resolveMention(args: {
    pluginId: string;
    itemId: string;
  }): Promise<{ ok: true; context: string } | { ok: false; error: string }>;
}

type PluginMentionResource = Extract<
  Extract<PromptInput, { type: 'text' }>['mentions'][number]['resource'],
  { kind: 'plugin' }
>;

export function splitPluginMentionItemId(itemId: string): {
  providerId: string;
  nativeId: string;
} | null {
  const trimmed = itemId.trim();
  const idx = trimmed.indexOf(':');
  if (idx <= 0 || idx === trimmed.length - 1) return null;
  return { providerId: trimmed.slice(0, idx), nativeId: trimmed.slice(idx + 1) };
}

function pluginMentionResource(value: unknown): PluginMentionResource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== 'plugin') return null;
  if (typeof record.pluginId !== 'string' || !record.pluginId.trim()) return null;
  if (typeof record.itemId !== 'string' || !record.itemId.trim()) return null;
  if (typeof record.label !== 'string' || !record.label.trim()) return null;
  return {
    kind: 'plugin',
    pluginId: record.pluginId,
    itemId: record.itemId,
    label: record.label,
    ...(typeof record.icon === 'string' || record.icon === null ? { icon: record.icon } : {})
  };
}

/** Unique plugin mentions in `input`, in first-appearance order. */
export function collectPluginMentionResources(input: unknown): PluginMentionResource[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const resources: PluginMentionResource[] = [];
  for (const part of input) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
    const record = part as { type?: unknown; mentions?: unknown };
    if (record.type !== 'text' || !Array.isArray(record.mentions)) continue;
    for (const mention of record.mentions) {
      if (!mention || typeof mention !== 'object' || Array.isArray(mention)) continue;
      const resource = pluginMentionResource((mention as { resource?: unknown }).resource);
      if (!resource) continue;
      const key = `${resource.pluginId}::${resource.itemId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      resources.push(resource);
    }
  }
  return resources;
}

export async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolve every plugin mention in a submitted message once and return the
 * agent-visible context inputs to append. Duplicate (pluginId, itemId) pairs
 * resolve once. A resolve failure throws 422 so the composer can surface it
 * instead of silently dropping attached context.
 */
export async function resolvePluginMentionContextInputs(
  plugins: PluginMentionResolver | undefined,
  input: unknown
): Promise<PromptInput[]> {
  const resources = collectPluginMentionResources(input);
  if (resources.length === 0) return [];
  if (!plugins) {
    const first = resources[0]!;
    throw new ThreadCreateError(
      422,
      'plugin_mention_resolve_failed',
      `Could not resolve @${first.label} (plugin "${first.pluginId}"): plugin host is unavailable`
    );
  }
  const contextInputs: PromptInput[] = [];
  for (const resource of resources) {
    const result = await plugins.resolveMention({
      pluginId: resource.pluginId,
      itemId: resource.itemId
    });
    if (!result.ok) {
      throw new ThreadCreateError(
        422,
        'plugin_mention_resolve_failed',
        `Could not resolve @${resource.label} (plugin "${resource.pluginId}"): ${result.error}`
      );
    }
    contextInputs.push({
      type: 'text',
      text: `Context for @${resource.label} (resolved by plugin "${resource.pluginId}"):\n\n${result.context}`,
      mentions: [],
      visibility: 'agent-only'
    });
  }
  return contextInputs;
}

export async function withResolvedPluginMentionContext(
  plugins: PluginMentionResolver | undefined,
  input: unknown
): Promise<unknown> {
  const extras = await resolvePluginMentionContextInputs(plugins, input);
  if (extras.length === 0) return input;
  if (Array.isArray(input)) return [...input, ...extras];
  if (typeof input === 'string') {
    return [{ type: 'text', text: input, mentions: [] }, ...extras];
  }
  return extras;
}
