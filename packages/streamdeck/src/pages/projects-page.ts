/**
 * Projects view — a grid of the user's registered projects (from `project.list`).
 * Pressing a project tile opens a per-project action overlay (spawn an agent
 * into it — see project-actions-page.ts). This is the "browse projects + spawn"
 * capability: the deck's answer to opening a project and hitting "+" in the app.
 *
 * Fetched on open (projects change slowly), not polled — so the page is built
 * from a snapshot the caller already resolved.
 */

import { type Page } from '../deck/page.js';
import { XL, type Geometry } from '../deck/device.js';
import { buildGrid, bodyCapacity } from '../deck/layout.js';
import { composeTile } from '../deck/renderer.js';
import { projectLabel, projectColor, type ProjectItem } from '../lib/types.js';

/** XL grid: rows 0–2 × 8 = 24 project slots (folds per model); last row is nav. */
export const PROJECT_SLOTS = 24;

export interface ProjectsPageDeps {
  openProject: (project: ProjectItem) => void;
  refresh: () => void;
  back: () => void;
  geom?: Geometry;
}

/** Build the projects grid from a snapshot, folded to the deck's geometry. */
export function buildProjectsPage(projects: ProjectItem[], deps: ProjectsPageDeps): Page {
  const geom = deps.geom ?? XL;
  const size = geom.keyPx; // native key px (undefined → renderer defaults to 96)
  const shown = projects.slice(0, bodyCapacity(geom));
  return buildGrid({
    name: 'projects',
    geom,
    fillBody: true,
    body: shown.map((project) => ({
      // Project-identity dot (top-left) — the same colour the agent tiles carry,
      // so a project reads consistently across the agents and projects views.
      render: () => composeTile({ status: 'idle', caption: projectLabel(project), icon: 'projects', dot: projectColor(project.id), size }),
      onPress: () => deps.openProject(project)
    })),
    nav: [{ render: () => composeTile({ status: 'idle', caption: 'Refresh', icon: 'refresh', size }), onPress: deps.refresh }],
    back: { render: () => composeTile({ status: 'idle', caption: 'Back', icon: 'back', size }), onPress: deps.back }
  });
}
