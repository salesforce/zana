import { House } from 'lucide-react';
import type { Project } from '@zana-ai/zcc-domain/product';
import { isScratchWorkspaceProject } from '../composer-project-default.js';

export type ProjectDotProject = Pick<Project, 'name' | 'quickAgent' | 'color'>;

/**
 * Rail / list marker for a project. The built-in default workspace
 * (`~/zcc-workspace`) uses a home glyph so it does not look like another
 * colored project dot.
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
  return (
    <span
      className={`project-dot ${unread ? 'unread' : ''}`}
      style={project.color ? { background: project.color } : undefined}
      title={unreadTitle}
      aria-hidden
    />
  );
}
