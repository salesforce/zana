import type { Project } from '@shared/types';
import { GoalsPanel } from './GoalsPanel';

/**
 * The per-project Goals tab, mounted in a project's workspace (sibling to the
 * Tickets tab). A thin wrapper over {@link GoalsPanel} in its project-scoped
 * shape: it filters to this project, locks the create modal's project, and
 * writes new goals under the project's `.zcc/goals`. The global Goals nav tab
 * mounts the same component with no `projectId` for the cross-project view.
 */
export function ProjectGoalsView({ project }: { project: Project }) {
  return <GoalsPanel projectId={project.id} />;
}
