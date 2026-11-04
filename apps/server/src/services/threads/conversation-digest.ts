/**
 * Role-tagged digest of a whole conversation thread, for the wrap-up summary.
 * The same shape as the CLI transcript digests (`buildSessionDigest`): `User:` /
 * `Assistant:` blocks, 1,500 characters each, the last assistant block up to
 * 4,000, the whole digest capped at 12,000 characters keeping the tail. Threads
 * have no PTY transcript, so this reads the thread's own messages.
 */

import type { ProductHttpContext } from '../../http/product-context.js';
import { conversationMessageTexts } from './conversation-timeline.js';

const MAX_CHARS = 12_000;
const PER_BLOCK_CHARS = 1_500;
const FINAL_BLOCK_CHARS = 4_000;

export interface DigestMessage {
  role: 'user' | 'assistant';
  text: string;
}

const clamp = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** Pure builder over a message list, oldest first. Blank messages are dropped. */
export function buildConversationDigest(messages: readonly DigestMessage[]): string {
  const blocks = messages
    .map((m) => ({ role: m.role, text: m.text.trim() }))
    .filter((m) => m.text);
  const lastAssistant = blocks.map((b) => b.role).lastIndexOf('assistant');
  const digest = blocks
    .map((b, i) => `${b.role === 'user' ? 'User' : 'Assistant'}: ${clamp(b.text, i === lastAssistant ? FINAL_BLOCK_CHARS : PER_BLOCK_CHARS)}`)
    .join('\n\n');
  return digest.length > MAX_CHARS ? digest.slice(digest.length - MAX_CHARS) : digest;
}

export function conversationDigest(ctx: ProductHttpContext, threadId: string): string {
  return buildConversationDigest(conversationMessageTexts(ctx, threadId));
}
