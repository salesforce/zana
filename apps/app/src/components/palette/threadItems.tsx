import { MessageSquare } from 'lucide-react';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { ThreadListItem } from '../../thread-store.js';
import type { PaletteItem } from './buildItems.js';

/** Match the sidebar's visible roster and the window's registered project scope. */
export function buildThreadPaletteItems(
  threads: readonly ThreadListItem[], projects: readonly Project[],
  open: (thread: ThreadListItem) => void,
  scopedProjectId: string | null = null
): PaletteItem[] {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  return threads
    .filter((thread) => !thread.archivedAt && projectById.has(thread.projectId)
      && (!scopedProjectId || thread.projectId === scopedProjectId))
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
    .map((thread) => ({
      key: `thread:${thread.id}`,
      icon: <MessageSquare size={16} aria-hidden="true" />,
      label: thread.title?.trim() || 'Untitled thread',
      hint: `${projectById.get(thread.projectId)!.name} · ${thread.providerId}`,
      keywords: [thread.branchName ?? '', thread.cwd ?? ''],
      category: 'Threads', source: 'core',
      run: () => open(thread)
    }));
}
