import type { AgentState, Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import type { ThreadListItem } from '../thread-store';
import { getAgentSessionRoutePath, getThreadRoutePath } from '../lib/route-paths';
import { isUnreadThread } from '../lib/unread-threads';
import { isVisibleThread, threadRailStatus, threadTitle } from './fleet-item';

export interface MobileAgentItem {
  key: string;
  kind: 'thread' | 'session';
  id: string;
  projectId: string;
  title: string;
  projectName: string;
  to: string;
  status: 'Needs you' | 'Working' | 'Idle' | 'Error' | 'Finished' | 'Waiting';
  unread?: boolean;
  createdAt: number;
}

export function mobileCliAgentStatus(session: Pick<TerminalSession, 'status' | 'exitCode'>, state?: AgentState): MobileAgentItem['status'] {
  return session.status === 'exited'
    ? (session.exitCode ? 'Error' : 'Finished')
    : state === 'blocked' ? 'Needs you'
    : state === 'working' || session.status === 'starting' ? 'Working'
    : state === 'waiting' ? 'Waiting'
    : state === 'done' ? 'Finished' : 'Idle';
}

/** Open agents, newest-created first. Activity updates must never move a row. */
export function mobileAgentItems({ projects, threads, terminals, states, projectId }: {
  projects: readonly Pick<Project, 'id' | 'name'>[];
  threads: readonly ThreadListItem[];
  terminals: Record<string, TerminalSession[]>;
  states: Record<string, AgentState | undefined>;
  projectId?: string;
}): MobileAgentItem[] {
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const items: MobileAgentItem[] = threads
    .filter((thread) => isVisibleThread(thread) && (!projectId || thread.projectId === projectId))
    .map((thread) => ({
      key: `thread:${thread.id}`,
      kind: 'thread' as const,
      id: thread.id,
      projectId: thread.projectId,
      title: threadTitle(thread),
      projectName: names.get(thread.projectId) ?? 'Unknown project',
      to: getThreadRoutePath(thread.id, projectId),
      status: threadRailStatus(thread),
      unread: isUnreadThread(thread),
      createdAt: thread.createdAt
    }));
  for (const project of projects) {
    if (projectId && project.id !== projectId) continue;
    for (const session of terminals[project.id] ?? []) {
      if (session.profile === 'shell' || session.status === 'exited') continue;
      const state = states[session.id];
      const status = mobileCliAgentStatus(session, state);
      items.push({
        key: `session:${session.id}`,
        kind: 'session',
        id: session.id,
        projectId: project.id,
        title: session.title || 'Untitled agent',
        projectName: project.name,
        to: getAgentSessionRoutePath(session.id, projectId),
        status,
        createdAt: session.createdAt
      });
    }
  }
  return items.sort((a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key));
}

export function filterMobileAgents(items: readonly MobileAgentItem[], search: string): readonly MobileAgentItem[] {
  const query = search.trim().toLocaleLowerCase();
  return query ? items.filter((item) => `${item.title} ${item.projectName}`.toLocaleLowerCase().includes(query)) : items;
}
