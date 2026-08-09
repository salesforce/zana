/**
 * Per-project action overlay, pushed when a project tile is pressed. The one
 * write a project affords from the deck is spawning a new agent into it — the
 * hardware analogue of the app's "+" launcher. One spawn tile is offered per
 * profile the app reports as spawnable (`harness.list` → enabled × installed
 * harness families); each is a `term.create` intent addressed by the project's
 * id, with cwd confined server-side to that project. When the app is too old to
 * know `harness.list`, the caller passes the `claude` / `claude-yolo` fallback.
 */

import { type Page } from '../deck/page.js';
import { XL, type Geometry } from '../deck/device.js';
import { buildOverlay } from '../deck/layout.js';
import { composeTile } from '../deck/renderer.js';
import {
  projectLabel,
  projectColor,
  FALLBACK_SPAWN_PROFILES,
  type ProjectItem,
  type SpawnProfileInfo
} from '../lib/types.js';
import type { ActionQueue } from '../lib/actions.js';

export interface ProjectActionsDeps {
  queue: ActionQueue;
  back: () => void;
  geom?: Geometry;
  /**
   * Spawn profiles to offer, from the app's `harness.list`. Defaults to the
   * `claude` / `claude-yolo` baseline when omitted (or the app didn't report any).
   */
  profiles?: readonly SpawnProfileInfo[];
}

export function buildProjectActionsPage(project: ProjectItem, deps: ProjectActionsDeps): Page {
  const { queue, back } = deps;
  const geom = deps.geom ?? XL;
  const size = geom.keyPx; // native key px (undefined → renderer defaults to 96)
  const profiles = deps.profiles?.length ? deps.profiles : FALLBACK_SPAWN_PROFILES;

  const spawn = (p: SpawnProfileInfo) => ({
    // A yolo (permission-bypass) variant reads as an "attention" tile so it's
    // visually distinct from its safe sibling; ordinary profiles stay idle.
    render: () =>
      composeTile({ status: p.yolo ? 'attention' : 'idle', caption: `+ ${p.label}`, icon: 'spawn', size }),
    onPress: () => queue.enqueue({ kind: 'spawn' as const, projectId: project.id, profile: p.id })
  });

  return buildOverlay({
    name: 'project_actions',
    geom,
    // Header: the project this overlay targets. Static (flat) tile.
    header: { render: () => composeTile({ status: 'running', caption: projectLabel(project), icon: 'projects', dot: projectColor(project.id), pressable: false, size }) },
    // Spawn an agent with a chosen profile. Labels kept short — the renderer
    // draws a single line and truncates past ~12 chars.
    actions: profiles.map(spawn),
    back: { render: () => composeTile({ status: 'idle', caption: 'Back', icon: 'back', size }), onPress: back }
  });
}
