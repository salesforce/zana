import { getConversationThread, type ConversationThreadRow } from '@zana-ai/zcc-db';
import type { MessageSource } from '@zana-ai/zcc-domain/thread-runtime';
import type { PluginMessageAttribution } from '../plugins/plugin-message-source.js';

/** Host-stamped attribution id for core SDK/CLI deliveries (not a plugin). */
export const THREAD_SENDER_SOURCE_ID = 'sdk';

const UNSAFE_LABEL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2028\u2029\u2066-\u2069]+/g;
const MAX_LABEL = 80;
const MAX_ID = 200;

function displayLabel(value: string | null | undefined): string {
  const line = (value ?? '').replace(UNSAFE_LABEL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (!line) return 'A thread';
  return line.length > MAX_LABEL ? `${line.slice(0, MAX_LABEL - 1)}…` : line;
}

/**
 * Attribution for a message one agent thread sends another through the
 * `zcc thread spawn` / `zcc thread tell` HTTP routes, shown like a bot
 * message. The caller only names the sending thread; the label comes from
 * that thread's stored title, so a caller cannot invent display text.
 * Display only: never an authorization input.
 */
export function threadSenderAttribution(
  db: Parameters<typeof getConversationThread>[0],
  fromThreadId: unknown,
  detail: 'started this thread' | 'messaged',
  targetThreadId?: string
): PluginMessageAttribution {
  if (typeof fromThreadId !== 'string') return {};
  const id = fromThreadId.trim();
  if (!id || id.length > MAX_ID || id === targetThreadId) return {};
  let sender: ConversationThreadRow | null;
  try {
    sender = getConversationThread(db, id);
  } catch {
    return {};
  }
  if (!sender) return {};
  const label = displayLabel(sender.title);
  const linkable = sender.visibility === 'visible';
  const messageSource: MessageSource = {
    pluginId: THREAD_SENDER_SOURCE_ID,
    kind: 'thread',
    label,
    ...(linkable ? { threadId: sender.id } : {}),
    detail
  };
  return { messageSource, agentContext: `[From thread ${label} (${sender.id})]` };
}

/** Prepend the agent-only sender header to a route's prompt input. */
export function withSenderContext(input: unknown, attribution: PluginMessageAttribution): unknown {
  if (!attribution.agentContext) return input;
  const parts = typeof input === 'string'
    ? [{ type: 'text', text: input, mentions: [] }]
    : Array.isArray(input) ? input.map(part => typeof part === 'string' ? { type: 'text', text: part, mentions: [] } : part) : null;
  if (!parts) return input;
  return [{ type: 'text', text: attribution.agentContext, mentions: [], visibility: 'agent-only' }, ...parts];
}
