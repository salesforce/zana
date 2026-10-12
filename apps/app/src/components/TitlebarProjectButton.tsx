import { useState, type MouseEvent } from 'react';
import { ChevronDown, Network } from 'lucide-react';
import type { Project } from '@zana-ai/zcc-domain/product';
import { composerProjectLabel, isRemoteWorkspaceProject } from './composer-project-default.js';
import { FocusedProjectMenu } from './listpane/FocusedProjectMenu.js';

/**
 * Centered titlebar name for a single-project view. It replaces the plain
 * title text and opens the same project actions menu (editors, Finder, copy
 * path, settings) the rail's project row used to own — click, Enter or
 * right-click. The help / followed / bell buttons are absolutely positioned
 * siblings, so this stays centered and never shifts them.
 */
export function TitlebarProjectButton({ project }: { project: Project }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const name = composerProjectLabel(project);

  const openBelow = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu((open) => (open ? null : { x: rect.left, y: rect.bottom + 4 }));
  };

  return (
    <>
      <button
        type="button"
        className={`titlebar-title titlebar-project ${menu ? 'active' : ''}`}
        data-testid="titlebar-project"
        title={project.path}
        aria-label={`Project actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        // Toggle on mousedown would race the menu's outside-click dismiss;
        // keep the trigger out of it so a second click closes the menu.
        onMouseDown={(event) => { if (menu) event.stopPropagation(); }}
        onClick={openBelow}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <span className="titlebar-project-name">{name}</span>
        {isRemoteWorkspaceProject(project) && (
          <Network size={11} strokeWidth={2} className="project-remote-icon" aria-label="Remote SSH project" />
        )}
        <ChevronDown size={12} aria-hidden="true" className="titlebar-project-chevron" />
      </button>
      {menu && <FocusedProjectMenu project={project} {...menu} onClose={() => setMenu(null)} />}
    </>
  );
}
