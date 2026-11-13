import { House } from 'lucide-react';
import type { Project } from '@zana-ai/zcc-domain/product';
import { isProjectIcon } from '@zana-ai/zcc-domain';
import { ProjectMarker } from '@zana-ai/zcc-ui/project-marker';
import { isScratchWorkspaceProject } from '../composer-project-default.js';

export type ProjectDotProject = Pick<Project, 'name' | 'quickAgent' | 'color' | 'icon'>;

/**
 * Rail / list marker for a project. The built-in default workspace
 * (`~/zcc-workspace`) uses a home glyph so it does not look like another
 * colored project dot. Everything else renders through the shared
 * `ProjectMarker`, keeping the `project-dot*` classes as host styling hooks.
 */
export function ProjectDot({
  project,
  unread = false
}: {
  project: ProjectDotProject;
  unread?: boolean;
}) {
  const unreadTitle = unread ? 'New activity' : undefined;
  if (isScratchWorkspaceProject(project)) {
    return (
      <span
        className={`project-dot project-dot--home ${unread ? 'unread' : ''}`}
        title={unreadTitle}
        aria-hidden
      >
        <House size={12} strokeWidth={2.25} />
      </span>
    );
  }
  const isIcon = isProjectIcon(project.icon) && project.icon !== 'Circle';
  return (
    <ProjectMarker
      icon={isIcon ? project.icon : undefined}
      color={project.color || undefined}
      unread={unread}
      title={unreadTitle}
      className={isIcon ? 'project-dot project-dot--icon' : 'project-dot'}
    />
  );
}
