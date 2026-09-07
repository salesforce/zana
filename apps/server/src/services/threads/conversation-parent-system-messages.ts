import { getConversationThread } from '@zana-ai/zcc-db';
import type { PromptInput, PromptMentionResource, PromptTextMention } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { deferConversationSend } from './conversation-deferred-messages.js';

export interface ParentSystemRenderedMention {
  resource: PromptMentionResource;
  serializedText: string;
}

export interface ParentSystemThreadMentionSource {
  id: string;
  projectId: string;
  title: string | null;
}

interface ParentSystemTextSegment {
  kind: 'text';
  text: string;
}

interface ParentSystemMentionSegment {
  kind: 'mention';
  mention: ParentSystemRenderedMention;
}

export type ParentSystemInputSegment =
  | ParentSystemTextSegment
  | ParentSystemMentionSegment;

export function parentSystemThreadLabel(thread: {
  id: string;
  title: string | null;
}): string {
  return thread.title?.trim() || thread.id;
}

export function buildParentSystemThreadMention(args: {
  thread: ParentSystemThreadMentionSource;
}): ParentSystemRenderedMention {
  return {
    serializedText: `@thread:${args.thread.id}`,
    resource: {
      kind: 'thread',
      label: parentSystemThreadLabel(args.thread),
      projectId: args.thread.projectId,
      threadId: args.thread.id
    }
  };
}

export function buildParentSystemInputFromSegments(args: {
  segments: readonly ParentSystemInputSegment[];
}): PromptInput[] {
  let text = '';
  const mentions: PromptTextMention[] = [];
  for (const segment of args.segments) {
    if (segment.kind === 'text') {
      text += segment.text;
      continue;
    }
    const start = text.length;
    text += segment.mention.serializedText;
    mentions.push({
      start,
      end: text.length,
      resource: segment.mention.resource
    });
  }
  return [{ type: 'text', text, mentions }];
}

export async function queueParentSystemMessage(
  ctx: ProductHttpContext,
  args: { input: PromptInput[]; parentThreadId: string }
): Promise<boolean> {
  const parentThread = getConversationThread(ctx.db, args.parentThreadId);
  if (!parentThread || parentThread.archivedAt !== null) return false;
  if (ctx.pendingInteractions.hasPendingThreadInteraction(parentThread.id)) {
    deferConversationSend(ctx, {
      threadId: parentThread.id,
      input: args.input,
      mode: 'auto'
    });
    return true;
  }
  const { sendConversationTurn } = await import('./conversation-lifecycle.js');
  await sendConversationTurn(ctx, parentThread.id, args.input, 'auto', undefined, { drain: true });
  return true;
}
