import {
  countDeferredThreadMessages, getConversationThread, getPrimaryHost,
  relocateConversationThread, type ConversationThreadRow
} from '@zana-ai/zcc-db';
import type { MoveThreadRequest } from '@zana-ai/zcc-server-contract';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { conversationThreadView } from './conversation-create.js';
import { stopConversation } from './conversation-lifecycle.js';
import { hasPendingConversationSend, withConversationSendCancellation } from './conversation-send-guard.js';
import { provisionProjectEnvironment } from './spawn-environment-provision.js';
import { copyMovedThreadAttachments } from './conversation-move-attachments.js';

const moving = new WeakMap<ProductHttpContext, Set<string>>();

function validateMove(ctx: ProductHttpContext, threadId: string, input: MoveThreadRequest) {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) throw new ThreadCreateError(404, 'unknown-thread', 'Session is not registered.');
  if (thread.projectId !== input.expectedProjectId) throw new ThreadCreateError(409, 'project-changed', 'This session’s project changed. Refresh and try again.');
  if (thread.archivedAt) throw new ThreadCreateError(409, 'archived-thread', 'Restore this session before moving it.');
  if (thread.projectId === input.projectId) return { thread, project: null };
  const project = ctx.toProjects().find(row => row.id === input.projectId);
  if (!project) throw new ThreadCreateError(404, 'unknown-project', 'Destination project is not registered.');
  const hostId = project.hostId ?? (project.remote ? undefined : getPrimaryHost(ctx.db)?.id);
  if (hostId !== thread.hostId) throw new ThreadCreateError(409, 'different-machine', 'Sessions can only move between projects on the same machine.');
  if (thread.originPluginId || thread.parentThreadId || thread.visibility === 'hidden'
    || ctx.db.sqlite.prepare('SELECT 1 FROM threads WHERE parent_thread_id = ? AND archived_at IS NULL LIMIT 1').get(threadId)) {
    throw new ThreadCreateError(409, 'owned-session', 'Move is unavailable for plugin assistants or sessions with parent or child sessions.');
  }
  if (countDeferredThreadMessages(ctx.db, threadId) > 0) throw new ThreadCreateError(409, 'queued-messages', 'Send or remove queued messages before moving this session.');
  const view = conversationThreadView(ctx, thread);
  if ((hasPendingConversationSend(ctx.db, threadId) || ['active', 'starting', 'stopping'].includes(thread.status)
    || Object.values(view.activity ?? {}).some(count => count > 0)) && !input.stop) {
    throw new ThreadCreateError(409, 'session-running', 'This session must stop before moving.');
  }
  return { thread, project };
}

export async function moveConversationToProject(
  ctx: ProductHttpContext, threadId: string, input: MoveThreadRequest
): Promise<ConversationThreadRow> {
  const pending = moving.get(ctx) ?? new Set<string>();
  const threadKey = `thread:${threadId}`;
  const destinationKey = `project:${input.projectId}`;
  if (pending.has(threadKey) || pending.has(destinationKey)) throw new ThreadCreateError(409, 'move-in-progress', 'A session move is already in progress. Try again when it finishes.');
  // Rejected moves must not cancel a turn that is still being prepared.
  const initial = validateMove(ctx, threadId, input);
  if (!initial.project) return initial.thread;
  pending.add(threadKey);
  pending.add(destinationKey);
  moving.set(ctx, pending);
  try {
    return await withConversationSendCancellation(ctx.db, threadId, async () => {
      const { thread, project } = validateMove(ctx, threadId, input);
      if (!project) return thread;
      // Provision performs registered-project/host resolution and realpath validation on the host.
      const environment = await provisionProjectEnvironment(ctx, {
        projectId: project.id, hostId: thread.hostId, choice: { kind: 'unmanaged' }
      });
      if (environment.hostId !== thread.hostId) throw new ThreadCreateError(409, 'different-machine', 'The destination resolved to another machine.');
      await stopConversation(ctx, threadId, { requireHostRelease: true });
      const cleanupAttachments = await copyMovedThreadAttachments(ctx, threadId, thread.projectId, project.id);
      let moved: ConversationThreadRow;
      try {
        // Project registrations, ownership and queued work can change during host/file I/O.
        validateMove(ctx, threadId, input);
        const relocated = relocateConversationThread(ctx.db, {
          threadId, expectedProjectId: thread.projectId, projectId: project.id, environmentId: environment.id
        });
        if (!relocated) throw new ThreadCreateError(409, 'project-changed', 'This session changed while moving. Refresh and try again.');
        moved = relocated;
      } catch (error) {
        await cleanupAttachments();
        throw error;
      }
      // After the database commits, notification failures must not remove its attachments.
      ctx.hub.emit('threads:updated', conversationThreadView(ctx, moved));
      return moved;
    });
  } finally {
    pending.delete(threadKey);
    pending.delete(destinationKey);
    if (pending.size === 0) moving.delete(ctx);
  }
}
