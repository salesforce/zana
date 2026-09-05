import {
  getConversationThread,
  listConversationThreadEventsWindow,
  type ConversationThreadEventRow,
  type ConversationThreadRow
} from '@zana-ai/zcc-db';
import type { PromptInput, ThreadEventTurnStatus } from '@zana-ai/zcc-domain/thread-runtime';
import type { PendingInteraction } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { BACKGROUND_TASK_EVENT_SCAN_CAP, countActiveWorkflowsForThread } from './conversation-background-task-reconciliation.js';
import {
  buildParentSystemInputFromSegments,
  buildParentSystemThreadMention,
  parentSystemThreadLabel,
  queueParentSystemMessage,
  type ParentSystemInputSegment,
  type ParentSystemRenderedMention,
  type ParentSystemThreadMentionSource
} from './conversation-parent-system-messages.js';

export type ChildThreadNotificationSource = ParentSystemThreadMentionSource;

export interface ChildThreadTurnNotificationBatchItem {
  activeWorkflowCount: number;
  childThread: ChildThreadNotificationSource;
  terminalOutput: string | null;
  turnStatus: ThreadEventTurnStatus;
}

interface ChildThreadTurnNotificationBatch {
  items: ChildThreadTurnNotificationBatchItem[];
  timer: ReturnType<typeof setTimeout>;
}

interface ChildThreadTurnStatusBatchLine {
  item: ChildThreadTurnNotificationBatchItem;
  mention: ParentSystemRenderedMention;
}

const CHILD_THREAD_TURN_NOTIFICATION_BATCH_DELAY_MS = 2_000;
const CHILD_THREAD_TERMINAL_OUTPUT_EXCERPT_CHAR_LIMIT = 4_000;
const CHILD_THREAD_OUTPUT_TRUNCATION_MARKER = '\n\n[... output truncated ...]';
const CHILD_THREAD_INSPECTION_GUIDANCE = 'Review the thread before deciding next steps.';
const CHILD_THREAD_INTERRUPTED_GUIDANCE =
  'If the user stopped it manually, do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.';
const CHILD_THREAD_BATCH_INTERRUPTED_GUIDANCE =
  'If the user stopped any interrupted thread manually, do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.';
const CHILD_THREAD_NEEDS_ATTENTION_FALLBACK_SUMMARY = 'It is blocked on a pending interaction.';
const CHILD_THREAD_NEEDS_ATTENTION_GUIDANCE =
  'Review the blocker. If you can resolve it from existing context, reply to the thread with guidance. Otherwise, ask the user for the missing decision.';
const CHILD_THREAD_RUNNING_WORKFLOW_GUIDANCE =
  'A workflow it started is still running, so this output is not its final result. The thread will report again when the workflow finishes.';
const CHILD_THREAD_BATCH_RUNNING_WORKFLOW_GUIDANCE =
  'Threads with a workflow still running have not finished; they will report again when their workflow does.';

const childThreadTurnNotificationBatches = new Map<string, ChildThreadTurnNotificationBatch>();

function childThreadTurnStatusLabel(turnStatus: ThreadEventTurnStatus): string {
  switch (turnStatus) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'interrupted':
      return 'was interrupted';
    default: {
      const exhaustiveCheck: never = turnStatus;
      return exhaustiveCheck;
    }
  }
}

function truncateChildThreadOutput(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const retainedLength = Math.max(0, limit - CHILD_THREAD_OUTPUT_TRUNCATION_MARKER.length);
  if (retainedLength === 0) return CHILD_THREAD_OUTPUT_TRUNCATION_MARKER.trimStart();
  return `${text.slice(0, retainedLength).trimEnd()}${CHILD_THREAD_OUTPUT_TRUNCATION_MARKER}`;
}

function formatChildThreadCompletionOutputExcerpt(output: string | null): string {
  const trimmedOutput = output?.trim();
  if (!trimmedOutput) return 'No final output was recorded.';
  return truncateChildThreadOutput(trimmedOutput, CHILD_THREAD_TERMINAL_OUTPUT_EXCERPT_CHAR_LIMIT);
}

function formatChildThreadNeedsAttentionSummary(summary: string | null): string {
  const trimmedSummary = summary?.trim();
  if (!trimmedSummary) return CHILD_THREAD_NEEDS_ATTENTION_FALLBACK_SUMMARY;
  return trimmedSummary;
}

function formatChildThreadRunningWorkflowClause(count: number): string {
  if (count < 1) return '';
  return count === 1
    ? ', with 1 workflow still running'
    : `, with ${count} workflows still running`;
}

function buildSingleChildThreadTurnStatusSegments(args: {
  line: ChildThreadTurnStatusBatchLine;
}): ParentSystemInputSegment[] {
  const { line } = args;
  switch (line.item.turnStatus) {
    case 'completed': {
      const workflowClause = formatChildThreadRunningWorkflowClause(line.item.activeWorkflowCount);
      const workflowGuidance = workflowClause === '' ? '' : `\n\n${CHILD_THREAD_RUNNING_WORKFLOW_GUIDANCE}`;
      return [
        { kind: 'mention', mention: line.mention },
        {
          kind: 'text',
          text: ` completed${workflowClause}:\n\n${formatChildThreadCompletionOutputExcerpt(line.item.terminalOutput)}${workflowGuidance}`
        }
      ];
    }
    case 'failed':
      return [
        { kind: 'mention', mention: line.mention },
        { kind: 'text', text: ` failed.\n\n${CHILD_THREAD_INSPECTION_GUIDANCE}` }
      ];
    case 'interrupted':
      return [
        { kind: 'mention', mention: line.mention },
        {
          kind: 'text',
          text: ` was interrupted.\n\n${CHILD_THREAD_INSPECTION_GUIDANCE}\n\n${CHILD_THREAD_INTERRUPTED_GUIDANCE}`
        }
      ];
    default: {
      const exhaustiveCheck: never = line.item.turnStatus;
      return exhaustiveCheck;
    }
  }
}

function buildChildThreadBatchStatusLineSegments(args: {
  line: ChildThreadTurnStatusBatchLine;
}): ParentSystemInputSegment[] {
  const { line } = args;
  const workflowClause = formatChildThreadRunningWorkflowClause(line.item.activeWorkflowCount);
  return [
    { kind: 'mention', mention: line.mention },
    {
      kind: 'text',
      text: ` ${childThreadTurnStatusLabel(line.item.turnStatus)}${workflowClause}.`
    }
  ];
}

function buildChildThreadTurnStatusBatchSegments(args: {
  lines: ChildThreadTurnStatusBatchLine[];
}): ParentSystemInputSegment[] {
  if (args.lines.length === 1 && args.lines[0]) {
    return buildSingleChildThreadTurnStatusSegments({ line: args.lines[0] });
  }
  const segments: ParentSystemInputSegment[] = [];
  segments.push({ kind: 'text', text: 'Child thread updates:' });
  args.lines.forEach((line, index) => {
    segments.push({ kind: 'text', text: index === 0 ? '\n\n- ' : '\n- ' });
    segments.push(...buildChildThreadBatchStatusLineSegments({ line }));
  });
  if (args.lines.some((line) => line.item.turnStatus === 'interrupted')) {
    segments.push({ kind: 'text', text: `\n\n${CHILD_THREAD_BATCH_INTERRUPTED_GUIDANCE}` });
  }
  if (args.lines.some((line) => line.item.activeWorkflowCount > 0)) {
    segments.push({ kind: 'text', text: `\n\n${CHILD_THREAD_BATCH_RUNNING_WORKFLOW_GUIDANCE}` });
  }
  return segments;
}

export function buildChildThreadTurnStatusBatchInput(args: {
  items: ChildThreadTurnNotificationBatchItem[];
}): PromptInput[] {
  const lines = args.items.map((item) => ({
    item,
    mention: buildParentSystemThreadMention({ thread: item.childThread })
  }));
  return buildParentSystemInputFromSegments({
    segments: buildChildThreadTurnStatusBatchSegments({ lines })
  });
}

export function buildChildThreadNeedsAttentionInput(args: {
  blockerSummary: string | null;
  childThread: ChildThreadNotificationSource;
}): PromptInput[] {
  const mention = buildParentSystemThreadMention({ thread: args.childThread });
  return buildParentSystemInputFromSegments({
    segments: [
      { kind: 'mention', mention },
      {
        kind: 'text',
        text: ` needs help.\n${formatChildThreadNeedsAttentionSummary(args.blockerSummary)}\n\n${CHILD_THREAD_NEEDS_ATTENTION_GUIDANCE}`
      }
    ]
  });
}

function payloadRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

function lastAssistantOutput(rows: readonly ConversationThreadEventRow[]): string | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    if (row.type !== 'item/completed') continue;
    const item = payloadRecord(row.payload)?.item;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as { type?: unknown; text?: unknown };
    if (record.type === 'agentMessage' && typeof record.text === 'string' && record.text.trim()) {
      return record.text;
    }
  }
  return null;
}

function lastTurnStatus(
  thread: ConversationThreadRow,
  rows: readonly ConversationThreadEventRow[]
): ThreadEventTurnStatus {
  if (thread.status === 'error') return 'failed';
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    if (row.type === 'system/thread/interrupted') return 'interrupted';
    if (row.type !== 'turn/completed') continue;
    const status = payloadRecord(row.payload)?.status;
    if (status === 'failed') return 'failed';
    if (status === 'interrupted') return 'interrupted';
    return 'completed';
  }
  return 'completed';
}

function mentionSource(thread: ConversationThreadRow): ChildThreadNotificationSource {
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title
  };
}

function isSpawnedChild(thread: ConversationThreadRow): boolean {
  return Boolean(thread.parentThreadId) && thread.originKind !== 'fork';
}

async function flushChildThreadTurnNotificationBatch(
  ctx: ProductHttpContext,
  parentThreadId: string
): Promise<void> {
  const batch = childThreadTurnNotificationBatches.get(parentThreadId);
  if (!batch) return;
  childThreadTurnNotificationBatches.delete(parentThreadId);
  try {
    await queueParentSystemMessage(ctx, {
      input: buildChildThreadTurnStatusBatchInput({ items: batch.items }),
      parentThreadId
    });
  } catch (error) {
    console.info(JSON.stringify({
      msg: 'Failed to queue batched parent turn notifications',
      parentThreadId,
      err: error instanceof Error ? error.message : String(error)
    }));
  }
}

function scheduleChildThreadTurnNotificationBatchFlush(
  ctx: ProductHttpContext,
  parentThreadId: string
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    void flushChildThreadTurnNotificationBatch(ctx, parentThreadId);
  }, CHILD_THREAD_TURN_NOTIFICATION_BATCH_DELAY_MS);
}

export async function queueChildThreadTurnNotificationBestEffort(
  ctx: ProductHttpContext,
  args: {
    childThread: ChildThreadNotificationSource;
    parentThreadId: string;
    turnStatus: ThreadEventTurnStatus;
    terminalOutput: string | null;
    activeWorkflowCount: number;
  }
): Promise<void> {
  try {
    const existingBatch = childThreadTurnNotificationBatches.get(args.parentThreadId);
    const item: ChildThreadTurnNotificationBatchItem = {
      activeWorkflowCount: args.activeWorkflowCount,
      childThread: args.childThread,
      terminalOutput: args.turnStatus === 'completed' ? args.terminalOutput : null,
      turnStatus: args.turnStatus
    };
    if (existingBatch) {
      existingBatch.items.push(item);
      clearTimeout(existingBatch.timer);
      existingBatch.timer = scheduleChildThreadTurnNotificationBatchFlush(ctx, args.parentThreadId);
      return;
    }
    childThreadTurnNotificationBatches.set(args.parentThreadId, {
      items: [item],
      timer: scheduleChildThreadTurnNotificationBatchFlush(ctx, args.parentThreadId)
    });
  } catch (error) {
    console.info(JSON.stringify({
      msg: 'Failed to queue parent turn notification',
      childThreadId: args.childThread.id,
      parentThreadId: args.parentThreadId,
      err: error instanceof Error ? error.message : String(error)
    }));
  }
}

export async function queueChildThreadNeedsAttentionNotificationBestEffort(
  ctx: ProductHttpContext,
  args: {
    blockerSummary: string | null;
    childThread: ChildThreadNotificationSource;
    parentThreadId: string;
  }
): Promise<void> {
  try {
    await queueParentSystemMessage(ctx, {
      input: buildChildThreadNeedsAttentionInput({
        blockerSummary: args.blockerSummary,
        childThread: args.childThread
      }),
      parentThreadId: args.parentThreadId
    });
  } catch (error) {
    console.info(JSON.stringify({
      msg: 'Failed to queue parent needs-attention notification',
      childThreadId: args.childThread.id,
      parentThreadId: args.parentThreadId,
      err: error instanceof Error ? error.message : String(error)
    }));
  }
}

export function notifyParentOfChildTurn(
  ctx: ProductHttpContext,
  thread: ConversationThreadRow
): void {
  if (!isSpawnedChild(thread) || !thread.parentThreadId) return;
  if (thread.status !== 'idle' && thread.status !== 'error') return;
  const rows = listConversationThreadEventsWindow(ctx.db, thread.id, {
    limit: BACKGROUND_TASK_EVENT_SCAN_CAP
  });
  void queueChildThreadTurnNotificationBestEffort(ctx, {
    childThread: mentionSource(thread),
    parentThreadId: thread.parentThreadId,
    turnStatus: lastTurnStatus(thread, rows),
    terminalOutput: lastAssistantOutput(rows),
    activeWorkflowCount: countActiveWorkflowsForThread(ctx.db, thread)
  });
}

export function pendingInteractionBlockerSummary(interaction: PendingInteraction): string | null {
  const payload = interaction.payload;
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { kind?: unknown; reason?: unknown; title?: unknown; prompt?: unknown };
  if (typeof record.reason === 'string' && record.reason.trim()) return record.reason.trim();
  if (typeof record.title === 'string' && record.title.trim()) return record.title.trim();
  if (typeof record.prompt === 'string' && record.prompt.trim()) return record.prompt.trim();
  if (record.kind === 'approval') return 'Blocked on command approval.';
  return null;
}

export function notifyParentOfChildNeedsAttention(
  ctx: ProductHttpContext,
  args: { threadId: string; interaction: PendingInteraction }
): void {
  const thread = getConversationThread(ctx.db, args.threadId);
  if (!thread || !isSpawnedChild(thread) || !thread.parentThreadId) return;
  void queueChildThreadNeedsAttentionNotificationBestEffort(ctx, {
    blockerSummary: pendingInteractionBlockerSummary(args.interaction),
    childThread: mentionSource(thread),
    parentThreadId: thread.parentThreadId
  });
}
