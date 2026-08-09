/**
 * The landing page — what the deck shows at rest. A single ZCC hub tile that
 * opens the full capability menu (see zcc-menu-page.ts). Deliberately sparse:
 * the rest of the 8×4 grid is free for non-zcc functions (media, spotify, home
 * automation) the way the original showcase's main page mixed a volume mixer
 * with its Claude folder — this package just owns the ZCC corner.
 *
 * This inverts the old boot flow (which opened straight into the agents grid):
 * the user asked for "1 ZCC icon that, when clicked, displays all the tools".
 */

import { Page, type Key } from '../deck/page.js';
import { composeTile } from '../deck/renderer.js';

export interface MainPageDeps {
  /** Push the ZCC capability menu. */
  openMenu: () => void;
  /**
   * How many agents currently need a human (blocked). When > 0 the hub tile
   * turns amber and badges the count — "N need you" is visible at rest, before
   * the user has even opened the menu.
   */
  blockedCount?: number;
}

/** Build the landing page: a ZCC hub tile at (0,0); the rest left blank. */
export function buildMainPage(deps: MainPageDeps): Page {
  const page = new Page('main');
  const blocked = deps.blockedCount ?? 0;
  const zccTile: Key = {
    col: 0,
    row: 0,
    // The launcher: a house glyph (distinct from the agents robot). Goes amber
    // with a count badge when agents are waiting on a human decision.
    render: () =>
      composeTile({
        status: blocked > 0 ? 'attention' : 'running',
        caption: 'ZCC',
        icon: 'hub',
        badge: blocked > 0 ? String(blocked) : undefined
      }),
    onPress: deps.openMenu
  };
  page.add(zccTile);
  return page;
}
