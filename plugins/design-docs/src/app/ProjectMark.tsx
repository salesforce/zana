import { experimental_useProjects } from '@zana-ai/zcc-plugin-sdk/app';
import { ProjectMarker } from '@zana-ai/zcc-ui/project-marker';

/**
 * The host's own marker (icon + color) for a project, following recolors live.
 * Loading, unknown/removed, and project-less all render the neutral marker.
 */
export function ProjectMark({ projectId }: { projectId: string | null }) {
  const { status, projects } = experimental_useProjects();
  const project = status === 'ready' && projectId ? projects.find((entry) => entry.id === projectId) : undefined;
  return <ProjectMarker icon={project?.icon} color={project?.color} />;
}
