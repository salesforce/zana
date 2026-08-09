/**
 * The primary "agent kanban" page: live agents laid out on the 8×4 grid as
 * status-colored mascot tiles. Rows 0–2 (24 slots) hold agent tiles; row 3 is a
 * global action bar. Pressing an agent tile pushes a per-agent action overlay
 * (see agent-actions-page.ts) so a single key can approve, deny, or message it.
 *
 * This replaces the showcase's `claude_folder` page. The structural difference:
 * tiles are keyed by a STABLE agent identity (handle/sessionId) from the live
 * `agent.list`, not by a fragile screen-position pairing against VS Code tabs.
 */

import { type Page } from '../deck/page.js';
import { XL, type Geometry } from '../deck/device.js';
import { buildGrid } from '../deck/layout.js';
import { composeTile } from '../deck/renderer.js';
import { stateToDeckStatus, agentLabel, projectColor, isScheduled, type AgentListItem, type AgentState } from '../lib/types.js';
import type { GlyphName } from '../deck/glyphs.js';

/** XL grid capacity for agent tiles: rows 0–2 × 8 cols = 24 (folds per model). */
export const AGENT_SLOTS = 24;

/**
 * The GLYPH an agent tile carries. Every agent — whatever its state — wears the
 * SAME robot mark; status is conveyed purely by the tile's FILL colour (green =
 * working, yellow = blocked, teal = done, rust = unknown) plus the red alert
 * border when blocked. So the shape says "this is an agent" and the colour says
 * "how it's doing", rather than the glyph itself morphing per state.
 */
const AGENT_GLYPH: GlyphName = 'agents';

/**
 * Attention priority for the agents grid: the tiles that need a human come
 * first (blocked), then done (ready to collect), then live work, then idle, then
 * stale/unknown last. Sorting by this before slicing keeps the tiles that want
 * you top-left and on-device even when the fleet overflows the grid.
 */
const STATE_PRIORITY: Record<AgentState, number> = {
  blocked: 0,
  done: 1,
  working: 2,
  idle: 3,
  unknown: 4
};

export interface AgentsPageDeps {
  /** Push the per-agent action overlay for the given agent. */
  openAgent: (agent: AgentListItem) => void;
  /** Global-bar handlers. */
  refresh: () => void;
  /** Back to the ZCC menu (agents is now a pushed page, not the root). */
  back: () => void;
  /** Physical deck grid; defaults to XL. */
  geom?: Geometry;
  /** Current overflow page (0-based); defaults to 0. */
  pageIndex?: number;
  /** Advance to the next overflow page (caller bumps index + rebuilds). */
  onMore?: () => void;
  /**
   * Open the schedules view. When provided, the scheduled-agents clock tile in
   * the nav bar becomes pressable (jump straight to the schedule list); when
   * omitted the clock is a passive count indicator.
   */
  openSchedules?: () => void;
}

/**
 * Build (or rebuild) the agents page from a fresh snapshot. Rebuilding a whole
 * Page and swapping the Navigator's reference is cheaper and race-free vs.
 * mutating keys in place — the caller renders after the swap. The body folds to
 * the deck's capacity (24 on XL, 10 on a 5×3) so no tile lands off-device.
 */
export function buildAgentsPage(agents: AgentListItem[], deps: AgentsPageDeps): Page {
  const geom = deps.geom ?? XL;
  const size = geom.keyPx; // native key px (undefined → renderer defaults to 96)

  // Scheduler-spawned agents are background jobs, not tiles the user drives, so
  // they're kept OUT of the interactive grid and represented by a single clock
  // tile in the nav bar (badged with how many are currently working).
  const interactive = agents.filter((a) => !isScheduled(a));
  const scheduledWorking = agents.filter((a) => isScheduled(a) && a.state === 'working').length;

  // Priority sort: needs-you tiles (blocked) first, stale last. Stable within a
  // bucket (Array.prototype.sort is stable) so same-state agents keep list order.
  const ordered = [...interactive].sort((a, b) => STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state]);

  return buildGrid({
    name: 'agents',
    geom,
    fillBody: true,
    body: ordered.map((agent) => ({
      render: () =>
        composeTile({
          status: stateToDeckStatus(agent.state),
          caption: agentLabel(agent),
          icon: AGENT_GLYPH,
          // Project-identity dot (top-left) + red "needs you" border when blocked.
          dot: projectColor(agent.projectId),
          alert: agent.state === 'blocked',
          size
        }),
      onPress: () => deps.openAgent(agent)
    })),
    // Page through the fleet instead of dropping agents past the grid capacity.
    paging: deps.onMore ? { pageIndex: deps.pageIndex ?? 0, onMore: deps.onMore } : undefined,
    nav: [
      { render: () => composeTile({ status: 'idle', caption: 'Refresh', icon: 'refresh', size }), onPress: deps.refresh },
      {
        // Scheduled jobs live behind one clock tile (the schedules glyph is a
        // clock face), badged with how many are working now — running=green when
        // any are active, else idle. Pressing it jumps to the schedules view when
        // that handler is wired.
        render: () =>
          composeTile({
            status: scheduledWorking > 0 ? 'running' : 'idle',
            caption: 'Scheduled',
            icon: 'schedules',
            badge: scheduledWorking > 0 ? String(scheduledWorking) : undefined,
            size
          }),
        onPress: deps.openSchedules
      }
    ],
    back: { render: () => composeTile({ status: 'idle', caption: 'Back', icon: 'back', size }), onPress: deps.back }
  });
}
