import {
  getEnvironment,
  hasPendingInteractionForThread,
  maxConversationEventSequenceByThreadIds,
  nextConversationEventSequence,
  type ConversationThreadRow
} from '@zana-ai/zcc-db';
import type { ThreadActivityState, ThreadRuntimeState } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { resolveConversationRuntimeState } from './conversation-runtime-display.js';
import { loadThreadReads, peekThreadReadSeq } from './thread-reads.js';
import { threadActivityForConversation } from './conversation-thread-activity.js';

export interface ConversationThreadView {
  id: string;
  projectId: string;
  hostId: string;
  environmentId: string | null;
  providerId: string;
  status: ConversationThreadRow['status'];
  originKind: ConversationThreadRow['originKind'];
  visibility: ConversationThreadRow['visibility'];
  title: string | null;
  providerThreadId: string | null;
  parentThreadId: string | null;
  pinnedAt: number | null;
  pinOrder: number | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
  cwd: string | null;
  branchName: string | null;
  isWorktree: boolean;
  hasPendingInteraction: boolean;
  lastReadSeq: number | null;
  maxSeq: number;
  activity: ThreadActivityState;
  runtime: ThreadRuntimeState;
}

export function conversationThreadView(
  ctx: ProductHttpContext,
  thread: ConversationThreadRow,
  extras?: { lastReadSeq?: number | null; maxSeq?: number; activity?: ThreadActivityState }
): ConversationThreadView {
  const environment = thread.environmentId ? getEnvironment(ctx.db, thread.environmentId) : null;
  const lastReadSeq = extras && 'lastReadSeq' in extras
    ? extras.lastReadSeq ?? null
    : peekThreadReadSeq(ctx.dataDir, thread.id);
  const maxSeq = extras?.maxSeq ?? Math.max(0, nextConversationEventSequence(ctx.db, thread.id) - 1);
  const activity = extras?.activity ?? threadActivityForConversation(ctx, thread.id, maxSeq);
  return {
    ...thread,
    cwd: environment?.path ?? null,
    branchName: environment?.branchName ?? null,
    isWorktree: environment?.isWorktree ?? false,
    hasPendingInteraction: hasPendingInteractionForThread(ctx.db, thread.id),
    lastReadSeq,
    maxSeq,
    activity,
    runtime: resolveConversationRuntimeState(ctx, thread)
  };
}

export function conversationThreadViews(
  ctx: ProductHttpContext,
  threads: readonly ConversationThreadRow[]
): ConversationThreadView[] {
  const maxById = maxConversationEventSequenceByThreadIds(ctx.db, threads.map((thread) => thread.id));
  const reads = loadThreadReads(ctx.dataDir);
  return threads.map((thread) => {
    const maxSeq = maxById[thread.id] ?? 0;
    return conversationThreadView(ctx, thread, {
      lastReadSeq: Object.prototype.hasOwnProperty.call(reads, thread.id) ? reads[thread.id]! : null,
      maxSeq,
      activity: threadActivityForConversation(ctx, thread.id, maxSeq)
    });
  });
}
