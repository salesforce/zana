import {
  getConversationThread,
  listMenubarConversationThreads,
  type ConversationThreadRow,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import {
  menubarAgentRowKey,
  menubarAgentState,
  type MenubarThreadAgent
} from '@zana-ai/zcc-domain';
import type { ProjectStore } from '../../project-store.js';
import type { ProductHub } from '../../http/product-hub.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { conversationThreadViews } from './conversation-thread-view.js';

export const MENUBAR_THREAD_LIMIT = 100;

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
    ...(thread.status === 'error' ? { question: 'Thread error - open for details' } : {})
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
      return rows.slice(0, bounded);
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
