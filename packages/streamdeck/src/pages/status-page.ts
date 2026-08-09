/**
 * Status overview — an at-a-glance fleet dashboard from the `status` op. Renders
 * count tiles: total agents, how many are working, how many are blocked (amber
 * — the number that wants your attention), projects, and enabled schedules.
 * A Refresh key re-fetches. Read-only: no tile here mutates anything.
 */

import { type Page } from '../deck/page.js';
import { XL, type Geometry } from '../deck/device.js';
import { buildGrid, type TileSpec } from '../deck/layout.js';
import { composeTile } from '../deck/renderer.js';
import type { DeckStatus, StatusSummary } from '../lib/types.js';
import type { GlyphName } from '../deck/glyphs.js';

export interface StatusPageDeps {
  refresh: () => void;
  back: () => void;
  geom?: Geometry;
}

/** Build the status page from a snapshot (or null when the app is unreachable). */
export function buildStatusPage(summary: StatusSummary | null, deps: StatusPageDeps): Page {
  const geom = deps.geom ?? XL;
  const size = geom.keyPx; // native key px (undefined → renderer defaults to 96)

  // A count tile: the label captions it, the number rides the badge corner.
  const count = (status: DeckStatus, label: string, n: number, icon: GlyphName): TileSpec => ({
    render: () => composeTile({ status, caption: label, icon, badge: String(n), size })
  });

  let body: TileSpec[];
  if (!summary) {
    body = [{ render: () => composeTile({ status: 'error', caption: 'No data', icon: 'unknown', size }) }];
  } else {
    const working = summary.agents.filter((a) => a.state === 'working').length;
    const blocked = summary.agents.filter((a) => a.state === 'blocked').length;
    const done = summary.agents.filter((a) => a.state === 'done').length;
    // Count tiles flow row-major; blocked is amber so a non-zero value stands
    // out, done is teal (finished agents ready to collect). All are static.
    body = [
      count('idle', 'Agents', summary.agents.length, 'agents'),
      count('running', 'Working', working, 'working'),
      count(blocked > 0 ? 'attention' : 'idle', 'Blocked', blocked, 'blocked'),
      count(done > 0 ? 'done' : 'idle', 'Done', done, 'done'),
      count('idle', 'Projects', summary.projects, 'projects'),
      count('idle', 'Scheds', summary.enabledSchedules.length, 'schedules')
    ];
  }

  return buildGrid({
    name: 'status',
    geom,
    body,
    nav: [{ render: () => composeTile({ status: 'idle', caption: 'Refresh', icon: 'refresh', size }), onPress: deps.refresh }],
    back: { render: () => composeTile({ status: 'idle', caption: 'Back', icon: 'back', size }), onPress: deps.back }
  });
}
