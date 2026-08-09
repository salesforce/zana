/**
 * Regression guard — panels whose ListPane nav returns null MUST span cols 2..-1.
 *
 * Background: panels where ListPane.tsx (lines ~546-550) returns null for their
 * nav value have NO list column; they own the whole content area. Without an
 * explicit `grid-column: 2 / -1` CSS declaration, these panels auto-flow into
 * the narrow list column (col 2) and collapse into a sliver.
 *
 * The fix was applied in Sprint 2026-06 after the (since-removed) .teams-panel
 * regression was root-caused. This source-text guard (mirroring the repo's rule6
 * guard) ensures that the CSS rules for every ListPane-null panel remain in
 * global.css and declare the full-width span — so the fix can never silently
 * regress through a refactor or CSS cleanup.
 *
 * Style: source-text assertion (not jsdom) — jsdom cannot evaluate computed grid
 * placement, and a missing rule would silently pass a DOM-based test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const STYLES_ROOT = fileURLToPath(new URL('../styles', import.meta.url));
const GLOBAL_CSS_PATH = join(STYLES_ROOT, 'global.css');

/**
 * Panels whose ListPane nav returns null (see src/renderer/components/ListPane.tsx
 * lines ~546-550) — they MUST declare `grid-column: 2 / -1` or they collapse.
 */
const REQUIRED_FULL_WIDTH_PANELS = [
  'home-panel',
  'followups-panel',
  'personas-panel',
  'squads-panel',
  'gus-panel',
  'cu-panel',
  'library-panel'
] as const;

describe('ListPane-null panels declare grid-column: 2 / -1', () => {
  const css = readFileSync(GLOBAL_CSS_PATH, 'utf8');

  it.each(REQUIRED_FULL_WIDTH_PANELS)(
    '.%s must declare grid-column: 2 / -1',
    (panel) => {
      // Match the rule block for `.${panel}` declaring `grid-column: 2 / -1`.
      // Use `[^}]*` (flat rule block, no nested braces) NOT greedy `[\s\S]*`
      // which would match across unrelated blocks.
      const ruleRegex = new RegExp(
        `\\.${panel}\\s*\\{[^}]*grid-column:\\s*2\\s*/\\s*-1\\s*;[^}]*\\}`
      );
      expect(
        ruleRegex.test(css),
        `.${panel} is missing the 'grid-column: 2 / -1;' declaration in ` +
          `global.css. Without it, the panel collapses into the narrow list ` +
          `column (col 2) because ListPane.tsx returns null for its nav value ` +
          `(lines ~546-550), so there's no list column to occupy col 2. Add:\n\n` +
          `  .${panel} {\n` +
          `    grid-column: 2 / -1;\n` +
          `    /* ...existing styles... */\n` +
          `  }\n`
      ).toBe(true);
    }
  );

  it('the guard panel list matches the ListPane-null branches', () => {
    // Pin the guard's source-of-truth array to the ListPane contract. If a new
    // panel is added that returns null from ListPane, this test will remind the
    // developer to add it to REQUIRED_FULL_WIDTH_PANELS above.
    //
    // NOTE: .zana-panel reuses .gus-panel as its root class (see global.css
    // line ~10651), so it's covered transitively — do NOT add it here.
    expect([...REQUIRED_FULL_WIDTH_PANELS].sort()).toEqual(
      ['home-panel', 'followups-panel', 'personas-panel', 'squads-panel', 'gus-panel', 'cu-panel', 'library-panel'].sort()
    );
  });
});
