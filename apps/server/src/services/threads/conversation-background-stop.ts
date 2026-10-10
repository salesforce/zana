import { getConversationThread, listConversationOpenBackgroundTaskItems } from '@zana-ai/zcc-db';
import {
  isSettledBackgroundTaskStatus,
  threadEventBackgroundTaskItemSchema,
  type ThreadEventBackgroundTaskItem
} from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { sendConversationTurn } from './conversation-lifecycle.js';

export interface BackgroundStopResult {
  ok: true;
  /** Items the provider stopped itself; their completion rows follow as events. */
  stopped: string[];
  /** Items the agent was asked to stop because the provider could not. */
  requested: string[];
  /** Set when the agent could not be asked; `stopped` still holds. */
  fallbackError?: string;
}

export function backgroundStopPrompt(descriptions: readonly string[]): string {
  const listed = descriptions.length > 0 ? descriptions.join('; ') : 'the running background tasks';
  return (
    `Stop these running background tasks now: ${listed}. ` +
    'Use KillShell, TaskStop or the equivalent tool so they exit. Do not start new ones.'
  );
}

/**
 * Stop a thread's running background tasks (all of them when `itemIds` is
 * omitted). Only items still open in this thread's event log are eligible, so
 * a caller cannot reach another thread's task. Each item is first stopped
 * through the provider; whatever the provider cannot stop is handed to the
 * agent in one follow-up message. A failed follow-up does not undo the native
 * stops, so it is reported in `fallbackError` instead of thrown.
 */
export async function stopConversationBackgroundTasks(
  ctx: ProductHttpContext,
  threadId: string,
  itemIds?: readonly string[]
): Promise<BackgroundStopResult> {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) {
    throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  }
  const open = listConversationOpenBackgroundTaskItems(ctx.db, thread.id).flatMap((raw) => {
    const parsed = threadEventBackgroundTaskItemSchema.safeParse(raw);
    return parsed.success && !isSettledBackgroundTaskStatus(parsed.data.taskStatus) ? [parsed.data] : [];
  });
  const wanted = itemIds ? new Set(itemIds) : null;
  const targets = wanted ? open.filter((item) => wanted.has(item.id)) : open;
  if (targets.length === 0) {
    throw new ThreadCreateError(409, 'not-running', 'No matching background task is running in this thread');
  }

  const results = await Promise.all(targets.map((item) => stopOnHost(ctx, thread.hostId, thread.id, item.id)));
  const stopped = targets.filter((_, index) => results[index]).map((item) => item.id);
  const leftover: ThreadEventBackgroundTaskItem[] = targets.filter((_, index) => !results[index]);
  if (leftover.length === 0) return { ok: true, stopped, requested: [] };

  const descriptions = leftover
    .map((item) => (item.workflowName ?? item.description).trim())
    .filter(Boolean);
  try {
    await sendConversationTurn(ctx, thread.id, backgroundStopPrompt(descriptions), 'auto');
  } catch (error) {
    // Nothing was stopped at all: let the route report the real failure.
    if (stopped.length === 0) throw error;
    return { ok: true, stopped, requested: [], fallbackError: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, stopped, requested: leftover.map((item) => item.id) };
}

async function stopOnHost(
  ctx: ProductHttpContext,
  hostId: string,
  threadId: string,
  itemId: string
): Promise<boolean> {
  try {
    const result = await ctx.hostHub.callHostOnlineRpc<{ threadId: string; stopped: boolean }>({
      hostId,
      command: { type: 'thread.background.stop', threadId, itemId }
    });
    return result.threadId === threadId && result.stopped;
  } catch (error) {
    // An unreachable host or a provider error leaves the agent fallback.
    console.warn(
      `[threads] native background stop failed for thread ${threadId}:`,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}
