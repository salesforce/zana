/**
 * The ZCC capability menu — the fan-out the user described: press the ZCC hub
 * icon and every zcc capability appears as its own tile. Each tile navigates to
 * a sub-page (agents/projects/schedules/status). Back returns to the landing page.
 *
 * Scope is grounded in the control plane's operator-class op set: reads
 * (agent.list / project.list / sched.list / status) and the writes those pages
 * drive (term.reply / term.create / sched.*). There is deliberately no "kanban
 * columns" tile — the control plane exposes no ticket/board ops.
 */

import { type Page } from '../deck/page.js';
import { XL, type Geometry } from '../deck/device.js';
import { buildGrid } from '../deck/layout.js';
import { composeTile } from '../deck/renderer.js';

export interface ZccMenuDeps {
  openAgents: () => void;
  openProjects: () => void;
  openSchedules: () => void;
  openStatus: () => void;
  /** Back to the landing page. */
  back: () => void;
  geom?: Geometry;
  /**
   * Agents currently blocked (needs-you count). Badges the Agents tile so the
   * menu shows where the attention is owed.
   */
  blockedCount?: number;
}

/**
 * Build the capability menu. Body = the four navigable views (row-major); the
 * last row carries only Back. On XL this is the familiar
 * Agents/Projects/Schedules/Status across row 0; on a 5×3 the four views still
 * fit row 0 and Back folds onto row 2.
 */
export function buildZccMenuPage(deps: ZccMenuDeps): Page {
  const geom = deps.geom ?? XL;
  const size = geom.keyPx; // native key px (undefined → renderer defaults to 96)
  const blocked = deps.blockedCount ?? 0;
  const blockedBadge = blocked > 0 ? String(blocked) : undefined;
  return buildGrid({
    name: 'zcc_menu',
    geom,
    body: [
      { render: () => composeTile({ status: blocked > 0 ? 'attention' : 'idle', caption: 'Agents', icon: 'agents', badge: blockedBadge, size }), onPress: deps.openAgents },
      { render: () => composeTile({ status: 'idle', caption: 'Projects', icon: 'projects', size }), onPress: deps.openProjects },
      { render: () => composeTile({ status: 'idle', caption: 'Schedules', icon: 'schedules', size }), onPress: deps.openSchedules },
      { render: () => composeTile({ status: 'idle', caption: 'Status', icon: 'status', size }), onPress: deps.openStatus }
    ],
    back: { render: () => composeTile({ status: 'idle', caption: 'Back', icon: 'back', size }), onPress: deps.back }
  });
}
