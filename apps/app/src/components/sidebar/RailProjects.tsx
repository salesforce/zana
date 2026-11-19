import type { ReactElement } from 'react';
import { useData, useUi } from '../../store.js';
import { listedTerminals } from '../../store.js';
import { ProjectDot } from '../listpane/ProjectDot.js';
import { composerProjectLabel } from '../composer-project-default.js';

/**
 * Icon-only Projects switcher for the 52px rail. Each project shows its own
 * icon (`project.icon`) with an unread cue; click enters project focus, the
 * same action as the expanded Projects list.
 */
export function RailProjects(): ReactElement {
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const unread = useUi((s) => s.unread);
  const focusedProjectId = useUi((s) => s.focusedProjectId);
  const enterProjectFocus = useUi((s) => s.enterProjectFocus);
  return (
    <div className="rail-projects" role="group" aria-label="Projects" data-testid="rail-projects">
      {projects.map((p) => {
        const name = composerProjectLabel(p);
        const hasUnread = listedTerminals(terminals[p.id]).some((t) => unread[t.id]);
        return (
          <button
            key={p.id}
            type="button"
            className={`nav-item rail-project${focusedProjectId === p.id ? ' active' : ''}`}
            aria-label={hasUnread ? `Open ${name} — new activity` : `Open ${name}`}
            title={name}
            data-testid={`rail-project-${p.id}`}
            onClick={() => enterProjectFocus(p.id)}
          >
            <span className="nav-item-icon">
              <ProjectDot project={p} unread={hasUnread} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
