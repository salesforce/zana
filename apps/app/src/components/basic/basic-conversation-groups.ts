import type { Project } from '@zana-ai/zcc-domain/product';
import type { ThreadListItem } from '../../thread-store.js';
import { composerProjectLabel } from '../composer-project-default.js';

export interface BasicConversationGroup {
  projectId: string;
  name: string;
  threads: ThreadListItem[];
}

type ConversationProject = Pick<Project, 'id' | 'name' | 'remote' | 'hostId' | 'quickAgent'>;

/** Basic history follows the recorded execution host, including scratch conversations. */
export function basicConversationGroups(
  threads: readonly ThreadListItem[], projects: readonly ConversationProject[],
  primaryHostId: string | undefined, query: string, scopedProjectId: string | null
): BasicConversationGroup[] {
  if (!primaryHostId) return [];
  const needle = query.trim().toLocaleLowerCase();
  const projectById = new Map(projects.map(project => [project.id, project]));
  const groups = new Map<string, BasicConversationGroup>();
  const recent = [...threads].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
  for (const thread of recent) {
    if (thread.archivedAt || thread.visibility === 'hidden' || thread.hostId !== primaryHostId
      || (scopedProjectId && thread.projectId !== scopedProjectId)) continue;
    const project = projectById.get(thread.projectId);
    if (project?.remote || (project?.hostId && project.hostId !== primaryHostId)) continue;
    const name = project ? composerProjectLabel(project) : 'Project unavailable';
    if (needle && !name.toLocaleLowerCase().includes(needle)
      && !(thread.title || 'New conversation').toLocaleLowerCase().includes(needle)) continue;
    let group = groups.get(thread.projectId);
    if (!group) {
      group = { projectId: thread.projectId, name, threads: [] };
      groups.set(thread.projectId, group);
    }
    group.threads.push(thread);
  }
  return [...groups.values()];
}
