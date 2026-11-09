import {
  getConversationThread,
  getConversationAssistantPreview,
  getConversationFailurePreview,
  getConversationPreviewVersions,
  listPendingInteractionsByThread,
  listMenubarConversationThreads,
  type ConversationThreadRow,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import {
  menubarAgentRowKey,
  menubarAgentState,
  type MenubarThreadAgent
} from '@zana-ai/zcc-domain';
import { pendingInteractionPayloadSchema } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProjectStore } from '../../project-store.js';
import type { ProductHub } from '../../http/product-hub.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { conversationThreadViews } from './conversation-thread-view.js';

export const MENUBAR_THREAD_LIMIT = 100;

function pendingContext(db: ZccDatabase, threadId: string): MenubarThreadAgent['context'] {
  const row = listPendingInteractionsByThread(db, { threadId, statuses: ['pending'], limit: 1 })[0];
  // A corrupt/oversized payload must not suppress the rest of the fleet.
  if (!row || row.payload.length > 128 * 1024) return undefined;
  try {
    const parsed = pendingInteractionPayloadSchema.safeParse(JSON.parse(row.payload));
    if (!parsed.success) return undefined;
    const payload = parsed.data;
    const questions = payload.kind === 'user_question' ? payload.questions : undefined;
    let prompt = questions?.[0]?.prompt ?? 'Waiting for your input';
    if (payload.kind === 'approval') {
      const subject = payload.subject;
      prompt = subject.kind === 'command' ? `Approve command: ${subject.command}`
        : subject.kind === 'file_change' ? `Approve file changes${subject.writeScope ? `: ${subject.writeScope}` : ''}`
        : subject.kind === 'plan' ? 'Review the proposed plan' : 'Permission requested';
    } else if ('title' in payload) prompt = payload.title;
    const lastMessage = getConversationAssistantPreview(db, threadId, row.turnId, row.createdAt);
    return { interactionId: row.id, createdAt: row.createdAt, prompt: prompt.slice(0, 4000), questions, lastMessage };
  } catch {
    return undefined;
  }
}

interface MenubarThreadSourceDeps {
  db: ZccDatabase;
  projects: ProjectStore;
  hub: ProductHub;
  viewContext: ProductHttpContext;
}

function projectThread(
  thread: ReturnType<typeof conversationThreadViews>[number],
  project?: { name: string; color?: string }
): MenubarThreadAgent | null {
  const state = menubarAgentState(
    thread.status,
    thread.hasPendingInteraction,
    thread.activity.activeBackgroundCommandCount
  );
  if (state !== 'blocked' && state !== 'working') return null;
  const agent: MenubarThreadAgent = {
    kind: 'thread', agentId: thread.id, threadId: thread.id, projectId: thread.projectId, rowKey: '',
    projectName: project?.name ?? 'project', projectColor: project?.color, title: thread.title ?? 'Untitled thread',
    state, favorite: false, canFavorite: false, canReply: false, createdAt: thread.createdAt,
    status: thread.status, hasPendingInteraction: thread.hasPendingInteraction,
    ...(thread.status === 'error' ? { question: 'Thread failed' } : {})
  };
  agent.rowKey = menubarAgentRowKey(agent);
  return agent;
}

function compareMenubarThreads(a: MenubarThreadAgent, b: MenubarThreadAgent): number {
  const rank = Number(a.state !== 'blocked') - Number(b.state !== 'blocked');
  return rank || b.createdAt - a.createdAt || a.agentId.localeCompare(b.agentId);
}

function isOpenableThread(thread: ConversationThreadRow | null, projectId: string): thread is ConversationThreadRow {
  return !!thread && thread.projectId === projectId && thread.archivedAt === null && thread.visibility === 'visible';
}

export function createMenubarThreadSource(deps: MenubarThreadSourceDeps) {
  let cache = new Map<string, { key: string; context?: MenubarThreadAgent['context']; failure?: string }>();
  const enrich = (agents: MenubarThreadAgent[]) => {
    const attention = agents.filter((agent) => agent.status === 'error' || agent.hasPendingInteraction);
    const versions = new Map(getConversationPreviewVersions(deps.db, attention.map((a) => a.threadId)).map((v) => [v.threadId, v]));
    const next: typeof cache = new Map();
    for (const agent of attention) {
      const version = versions.get(agent.threadId);
      const key = JSON.stringify([agent.status, agent.hasPendingInteraction, version]);
      const previous = version ? cache.get(agent.threadId) : undefined;
      const entry = previous?.key === key ? previous : {
        key,
        ...(agent.status === 'error'
          ? { failure: getConversationFailurePreview(deps.db, agent.threadId) }
          : { context: pendingContext(deps.db, agent.threadId) })
      };
      if (version) next.set(agent.threadId, entry);
      agent.context = entry.context;
      if (entry.failure) agent.question = `Thread failed: ${entry.failure}`;
      else if (entry.context) agent.question = entry.context.prompt;
    }
    // Retain only this bounded fleet, including negative results for unchanged threads.
    cache = next;
  };
  return {
    list(limit = MENUBAR_THREAD_LIMIT): MenubarThreadAgent[] {
      const bounded = Math.max(1, Math.min(limit, MENUBAR_THREAD_LIMIT));
      const projects = new Map(deps.projects.list().map((project) => [project.id, project]));
      const rows = conversationThreadViews(
        deps.viewContext,
        listMenubarConversationThreads(deps.db, { limit: bounded })
      ).flatMap((thread) => {
        const agent = projectThread(thread, projects.get(thread.projectId));
        return agent ? [agent] : [];
      });
      rows.sort(compareMenubarThreads);
      const selected = rows.slice(0, bounded);
      enrich(selected);
      return selected;
    },

    open(threadId: string, projectId: string): { ok: boolean; reason?: string } {
      const thread = getConversationThread(deps.db, threadId);
      if (!isOpenableThread(thread, projectId)) return { ok: false, reason: 'thread unavailable' };
      deps.hub.emit('threads:open', {
        type: 'thread-open',
        threadId: thread.id,
        projectId: thread.projectId,
        split: 'right',
        file: null
      });
      return { ok: true };
    }
  };
}
