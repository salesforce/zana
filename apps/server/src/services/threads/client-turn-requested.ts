import { appendConversationThreadEvent } from '@zana-ai/zcc-db';
import {
  encodeClientTurnRequestIdNumber,
  threadEventSchema,
  threadScope,
  type PermissionMode,
  type ReasoningLevel,
  type ThreadEvent
} from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';

export function appendClientTurnRequested(
  ctx: ProductHttpContext,
  args: {
    threadId: string;
    prompt: readonly string[];
    kind: 'thread-start' | 'new-turn';
    permissionMode?: PermissionMode;
    model?: string;
    reasoningLevel?: ReasoningLevel;
  }
): void {
  const input = args.prompt
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .map((text) => ({ type: 'text' as const, text, mentions: [] }));
  if (input.length === 0) return;

  const parsed = threadEventSchema.safeParse({
    type: 'client/turn/requested',
    threadId: args.threadId,
    scope: threadScope(),
    direction: 'outbound',
    requestId: encodeClientTurnRequestIdNumber({
      value: Date.now() * 1000 + Math.floor(Math.random() * 1000)
    }),
    source: args.kind === 'thread-start' ? 'spawn' : 'tell',
    initiator: 'user',
    senderThreadId: null,
    input,
    target: { kind: args.kind },
    request: {
      method: args.kind === 'thread-start' ? 'thread/start' : 'turn/start',
      params: {}
    },
    execution: {
      model: args.model?.trim() || 'default',
      serviceTier: 'default',
      reasoningLevel: args.reasoningLevel ?? 'medium',
      permissionMode: args.permissionMode ?? 'accept-edits',
      source: 'client/turn/requested'
    }
  });
  if (!parsed.success) return;

  const event = parsed.data as ThreadEvent;
  const stored = appendConversationThreadEvent(ctx.db, {
    threadId: args.threadId,
    type: event.type,
    payload: event
  });
  ctx.hub.emit('threads:event', {
    threadId: args.threadId,
    sequence: stored.sequence,
    kind: 'thread.event',
    type: event.type,
    payload: event
  });
}
