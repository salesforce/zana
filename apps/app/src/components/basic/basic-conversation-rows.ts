import type { Project } from '@zana-ai/zcc-domain/product';
import type { ThreadListItem } from '../../thread-store.js';
import { composerProjectLabel } from '../composer-project-default.js';
import { DEFAULT_BASIC_CONVERSATION_VIEW, windowCutoff, type BasicConversationView } from './basic-conversation-view.js';

/** One Basic sidebar row: a conversation and the project it belongs to. */
export interface BasicConversationRow {
  thread: ThreadListItem;
  projectName: string;
  projectColor?: string;
}

type ConversationProject = Pick<Project, 'id' | 'name' | 'color' | 'remote' | 'hostId' | 'quickAgent'>;

const lastActivity = (thread: ThreadListItem) => thread.updatedAt ?? thread.createdAt;
const titleOf = (thread: ThreadListItem) => thread.title || 'New conversation';

function compareThreads(sort: BasicConversationView['sort']) {
  if (sort === 'created') return (a: ThreadListItem, b: ThreadListItem) => b.createdAt - a.createdAt;
  if (sort === 'title') return (a: ThreadListItem, b: ThreadListItem) =>
    titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' }) || lastActivity(b) - lastActivity(a);
  return (a: ThreadListItem, b: ThreadListItem) => lastActivity(b) - lastActivity(a);
}

/**
 * Basic history follows the recorded execution host, including scratch
 * conversations. The status filter applies to the rows given, so archived rows must
 * come from history, not the live roster.
 */
export function basicConversationRows(
  threads: readonly ThreadListItem[], projects: readonly ConversationProject[],
  primaryHostId: string | undefined, query: string, scopedProjectId: string | null,
  view: BasicConversationView = DEFAULT_BASIC_CONVERSATION_VIEW, now = Date.now()
): BasicConversationRow[] {
  if (!primaryHostId) return [];
  const needle = query.trim().toLocaleLowerCase();
  const cutoff = windowCutoff(view.window, now);
  const projectById = new Map(projects.map(project => [project.id, project]));
  const rows: BasicConversationRow[] = [];
  const compare = compareThreads(view.sort);
  const rank = (thread: ThreadListItem) => !thread.archivedAt && thread.pinnedAt != null
    ? thread.pinOrder ?? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER;
  const ordered = [...threads].sort((a, b) => rank(a) - rank(b) || compare(a, b));
  for (const thread of ordered) {
    const archived = Boolean(thread.archivedAt);
    if ((view.status === 'active' && archived) || (view.status === 'archived' && !archived)) continue;
    if (thread.visibility === 'hidden' || thread.hostId !== primaryHostId
      || (scopedProjectId && thread.projectId !== scopedProjectId)) continue;
    if (cutoff !== null && lastActivity(thread) < cutoff) continue;
    if (!view.automations && thread.originPluginId) continue;
    const project = projectById.get(thread.projectId);
    if (project?.remote || (project?.hostId && project.hostId !== primaryHostId)) continue;
    const name = project ? composerProjectLabel(project) : 'Project unavailable';
    if (needle && !name.toLocaleLowerCase().includes(needle)
      && !titleOf(thread).toLocaleLowerCase().includes(needle)) continue;
    rows.push({ thread, projectName: name, projectColor: project?.color });
  }
  return rows;
}

/** Maintain first appearance of each project and the existing order of its rows. */
export function groupBasicConversationRows(rows: readonly BasicConversationRow[]): Map<string, BasicConversationRow[]> {
  const groups = new Map<string, BasicConversationRow[]>();
  for (const row of rows) {
    const group = groups.get(row.thread.projectId);
    if (group) group.push(row);
    else groups.set(row.thread.projectId, [row]);
  }
  return groups;
}
