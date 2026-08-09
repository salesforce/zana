/**
 * CSS regression guard for the Squad Flow scrollable canvas fix (A3).
 *
 * Ensures `.squad-flow-canvas` remains mouse-navigable (overflow: auto, NOT
 * hidden) and that the positioned content wrapper (`.squad-flow-content`)
 * exists to contain the graph layout. These rules were added to fix the
 * truncation bug where over-tall cards + rightmost nodes were unreachable.
 *
 * Style: source-text assertion (no run), mirroring the Rule-6 guard convention.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const GLOBAL_CSS = join(
  fileURLToPath(new URL('..', import.meta.url)),
  'styles',
  'global.css'
);

/** Extract the full rule block for a given selector (naive but sufficient). */
function extractRule(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) return '';
  const openBrace = css.indexOf('{', start);
  if (openBrace === -1) return '';
  let depth = 1;
  let i = openBrace + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') depth--;
    i++;
  }
  return css.slice(openBrace + 1, i - 1);
}

describe('Squad Flow canvas scrollability (A3 fix)', () => {
  const css = readFileSync(GLOBAL_CSS, 'utf8');

  it('.squad-flow-canvas has overflow: auto (NOT hidden)', () => {
    const rule = extractRule(css, '.squad-flow-canvas');
    expect(rule, 'squad-flow-canvas rule not found').not.toBe('');
    expect(
      rule,
      'overflow should be auto for mouse navigation; hidden would clip over-tall cards'
    ).toMatch(/overflow\s*:\s*auto/);
    expect(
      rule,
      'must NOT revert to overflow: hidden (the pre-fix behavior)'
    ).not.toMatch(/overflow\s*:\s*hidden/);
  });

  it('.squad-flow-content exists with position: relative', () => {
    const rule = extractRule(css, '.squad-flow-content');
    expect(rule, 'squad-flow-content rule not found — wrapper is required').not.toBe('');
    expect(
      rule,
      'position: relative is required for abs-positioned node buttons to be scoped'
    ).toMatch(/position\s*:\s*relative/);
  });

  it('.squad-flow-canvas fills its container (flex:1, not capped at 56vh)', () => {
    // The Flow view shows ONE focused squad at a time (see SquadSwitcher), so
    // the canvas should fill the whole board area and scroll internally — NOT
    // be capped to a 56vh slice (the old stacked-squads behavior).
    const rule = extractRule(css, '.squad-flow-canvas');
    expect(rule, 'canvas should flex to fill the board').toMatch(/flex\s*:\s*1/);
    expect(rule, 'must NOT re-cap the canvas at 56vh').not.toMatch(/max-height\s*:\s*56vh/);
  });
});
