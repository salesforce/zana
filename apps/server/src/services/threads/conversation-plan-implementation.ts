import type { ConversationThreadRow } from '@zana-ai/zcc-db';
import { classifyExecutionMode, isPlanExecutionMode } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { getDurableThreadPlanView } from './conversation-plan.js';
import { ensureConversationThreadIsWritable } from './conversation-send-request.js';

export function assertPlanRevision(ctx: Pick<ProductHttpContext, 'db'>, threadId: string, revision: number): string {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new ThreadCreateError(400, 'invalid_revision', 'A saved plan revision is required');
  }
  const plan = getDurableThreadPlanView(ctx.db, threadId);
  if (!plan?.markdown?.trim()) throw new ThreadCreateError(409, 'empty_plan', 'Write a plan before implementing it');
  if (plan.revision !== revision) throw new ThreadCreateError(409, 'stale_plan', 'The plan changed. Review the latest revision before implementing it.');
  return plan.markdown;
}

export function assertPlanImplementationReady(ctx: ProductHttpContext, thread: ConversationThreadRow, revision: number): void {
  ensureConversationThreadIsWritable(thread);
  assertPlanRevision(ctx, thread.id, revision);
  if (thread.status !== 'idle' && thread.status !== 'error') {
    throw new ThreadCreateError(409, 'already_active', 'Wait for the current turn before implementing the plan');
  }
  if (ctx.pendingInteractions.hasPendingThreadInteraction(thread.id)) {
    throw new ThreadCreateError(409, 'awaiting_user_interaction', 'Resolve the pending interaction before implementing the plan');
  }
  if (!ctx.hostHub.connectedHostIds?.().includes(thread.hostId)) {
    throw new ThreadCreateError(409, 'host_unavailable', 'Connect the host before implementing the plan');
  }
}

export function planImplementationMode(mode: unknown, previousNativeMode?: string | null): string {
  // Empty explicitly clears an inherited Plan selection for slash-command providers.
  if (mode === undefined || mode === '') {
    if (isPlanExecutionMode(previousNativeMode)) {
      throw new ThreadCreateError(409, 'execution_mode_required', 'Select an Agent mode before implementing this native plan.');
    }
    return '';
  }
  if (typeof mode !== 'string' || classifyExecutionMode(mode) !== 'execute') {
    throw new ThreadCreateError(400, 'invalid_mode', 'Implement plan requires an execution mode');
  }
  return mode;
}

export function planImplementationPrompt(markdown: string, revision: number): string {
  return `Implement the following reviewed plan (revision ${revision}). Follow its scope and acceptance criteria, then run the relevant tests and report the result.\n\n${markdown}`;
}
