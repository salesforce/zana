import { messageSourceSchema, type MessageSource } from '@zana-ai/zcc-domain/thread-runtime';

export const MAX_AGENT_CONTEXT_LENGTH = 500;

export interface PluginMessageAttribution {
  messageSource?: MessageSource;
  agentContext?: string;
}

/** Bidi overrides and line breaks would let a label impersonate surrounding chrome. */
const UNSAFE_LABEL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2028\u2029\u2066-\u2069]/;

function displayField(value: unknown, field: string, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`source.${field} must be a non-empty string`);
  if (UNSAFE_LABEL_CHARS.test(value)) throw new Error(`source.${field} must be a single line of plain text`);
  return value.trim();
}

/**
 * Validate the optional `source` / `agentContext` a plugin attaches to a
 * message. The host, not the plugin, supplies `pluginId`.
 */
export function parsePluginMessageAttribution(
  pluginId: string,
  args: { source?: unknown; agentContext?: unknown } | undefined
): PluginMessageAttribution {
  const out: PluginMessageAttribution = {};
  if (args?.agentContext !== undefined) {
    if (typeof args.agentContext !== 'string' || !args.agentContext.trim()) throw new Error('agentContext must be a non-empty string');
    if (args.agentContext.length > MAX_AGENT_CONTEXT_LENGTH) throw new Error(`agentContext must be at most ${MAX_AGENT_CONTEXT_LENGTH} characters`);
    out.agentContext = args.agentContext.trim();
  }
  if (args?.source === undefined) return out;
  const raw = args.source;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('source must be an object');
  const record = raw as Record<string, unknown>;
  const parsed = messageSourceSchema.safeParse({
    pluginId,
    kind: record.kind,
    label: displayField(record.label, 'label', true),
    ...(record.color !== undefined ? { color: record.color } : {}),
    ...(record.threadId !== undefined ? { threadId: displayField(record.threadId, 'threadId', false) } : {}),
    ...(record.detail !== undefined ? { detail: displayField(record.detail, 'detail', false) } : {})
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`source.${issue?.path.join('.') || 'value'} is invalid`);
  }
  out.messageSource = parsed.data;
  return out;
}

/** The prompt parts a plugin delivery becomes: an agent-only header, then the visible body. */
export function attributedPromptInput<V extends string>(
  text: string,
  attribution: PluginMessageAttribution,
  visibility?: V
): Array<{ type: 'text'; text: string; mentions: []; visibility?: V | 'agent-only' }> {
  const body = { type: 'text' as const, text, mentions: [] as [], ...(visibility ? { visibility } : {}) };
  return attribution.agentContext
    ? [{ type: 'text', text: attribution.agentContext, mentions: [], visibility: 'agent-only' }, body]
    : [body];
}
