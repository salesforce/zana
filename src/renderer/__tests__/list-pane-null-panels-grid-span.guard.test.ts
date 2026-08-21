/**
 * Regression guard — the shell is always nav + full content.
 *
 * Background: the app shell is two tracks (`var(--col-nav) minmax(0, 1fr)`),
 * plus the collapsed-sidebar one-track variant. Panels that used to sit in a
 * middle ListPane column now own any inner list/detail chrome. Without an
 * explicit `grid-column: 2 / -1` a panel that still declares that span (or a
 * new full-width panel) can regress into a sliver if a third track returns.
 *
 * This source-text guard ensures full-content panels keep spanning the remaining
 * track in global.css.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const STYLES_ROOT = fileURLToPath(new URL('../styles', import.meta.url));
const GLOBAL_CSS_PATH = join(STYLES_ROOT, 'global.css');

/**
 * Content panels that occupy the remaining shell track (column 2 of the
 * always-full nav+content grid).
 */
const REQUIRED_FULL_WIDTH_PANELS = [
  'home-panel',
  'followups-panel',
  'inbox-view',
  'agents-board--global',
  'gus-panel',
  'cu-panel',
  'scheduler-page'
] as const;

describe('shell content panels span the remaining track', () => {
  const css = readFileSync(GLOBAL_CSS_PATH, 'utf8');

  it('the shell grid is always nav + full content', () => {
    expect(css).toMatch(
      /\.app-shell\s*\{[^}]*grid-template-columns:\s*var\(--col-nav\)\s+minmax\(0,\s*1fr\);/
    );
    expect(css).not.toMatch(/Inbox and Scheduler deliberately do not receive/);
  });

  it.each(REQUIRED_FULL_WIDTH_PANELS)(
    '.%s must declare grid-column: 2 / -1',
    (panel) => {
      const ruleRegex = new RegExp(
        `\\.${panel}\\s*\\{[^}]*grid-column:\\s*2\\s*/\\s*-1\\s*;[^}]*\\}`
      );
      expect(
        ruleRegex.test(css),
        `.${panel} is missing the 'grid-column: 2 / -1;' declaration in ` +
          `global.css. The shell is always full content; without the span a ` +
          `panel can collapse if a list track reappears.\n`
      ).toBe(true);
    }
  );
});
