import type { Project } from '@zana-ai/zcc-domain/product';
import { FollowUpsPanel } from '@/views/follow-ups/FollowUpsView';

/**
 * The per-project Follow-ups tab, mounted in a project's workspace (sibling to
 * the Goals + Tickets tabs). A thin wrapper over {@link FollowUpsPanel} in its
 * project-scoped shape: it filters to this project and locks the create modal's
 * project. The global Follow-ups nav tab mounts the same component with no
 * `projectId` for the cross-project view.
 */
export function ProjectFollowUpsView({ project }: { project: Project }) {
  return <FollowUpsPanel projectId={project.id} />;
}
