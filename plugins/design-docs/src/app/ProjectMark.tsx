import type { MouseEvent, ReactNode } from 'react';
import { experimental_useProjectAppearanceMenu, experimental_useProjects } from '@zana-ai/zcc-plugin-sdk/app';
import { ProjectMarker } from '@zana-ai/zcc-ui/project-marker';

/**
 * The host's own marker (icon + color) for a project, following recolors live.
 * Loading, unknown/removed, and project-less all render the neutral marker.
 *
 * Right-clicking the marker (and any adjacent `children`, e.g. the project
 * name) opens the host's Icon + Color menu for a known project. The plugin
 * never writes project data; unknown projects keep the surrounding menu.
 */
export function ProjectMark({ projectId, children }: { projectId: string | null; children?: ReactNode }) {
  const { status, projects } = experimental_useProjects();
  const appearance = experimental_useProjectAppearanceMenu();
  const project = status === 'ready' && projectId ? projects.find((entry) => entry.id === projectId) : undefined;
  const onContextMenu = project
    ? (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        appearance.open(project.id, { x: event.clientX, y: event.clientY });
      }
    : undefined;
  return (
    <span className="dd-project-target" style={{ display: 'contents' }} onContextMenu={onContextMenu}>
      <ProjectMarker icon={project?.icon} color={project?.color} />
      {children}
    </span>
  );
}
