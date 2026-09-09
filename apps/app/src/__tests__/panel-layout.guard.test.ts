/**
 * Panel bodies pick one of two layouts, encoded in CSS — not a user preference.
 *   .settings-inner   — centered reading/config (40px gutters)
 *   .panel-body--full — workbench (no padding)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const css = readFileSync(
  join(fileURLToPath(new URL('../styles', import.meta.url)), 'global.css'),
  'utf8'
);

describe('panel body layouts', () => {
  it('centered .settings-inner has matching left/right gutters', () => {
    const block = css.match(/\.settings-inner\s*\{[^}]+\}/);
    expect(block, '.settings-inner rule is missing').toBeTruthy();
    expect(block![0]).toMatch(/padding:\s*28px\s+40px\s+56px/);
    expect(block![0]).toMatch(/max-width:\s*min\(100%,\s*1040px\)/);
  });

  it('themes settings hyperlinks separately from --accent-blue', () => {
    expect(css).toMatch(/--settings-link:\s*#58a6ff/);
    expect(css).toMatch(/\.settings-panel a \{\s*color:\s*var\(--settings-link\)/);
    expect(css).toMatch(/\.opener-switch--on \{\s*background:\s*var\(--accent-blue\)/);
  });

  it('full .panel-body--full has no padding', () => {
    const block = css.match(/\.panel-body--full\s*\{[^}]+\}/);
    expect(block, '.panel-body--full rule is missing').toBeTruthy();
    expect(block![0]).toMatch(/padding:\s*0/);
  });

  it('does not keep the hybrid scheduler-panel--full + settings-inner override', () => {
    expect(css).not.toMatch(/\.scheduler-panel--full\s+\.settings-inner/);
  });

  it('keeps Scheduler on the shared 1040px centered cap, not a narrower column', () => {
    const block = css.match(/\.scheduler-panel\s+\.settings-inner\s*\{[^}]+\}/);
    expect(block, '.scheduler-panel .settings-inner rule is missing').toBeTruthy();
    expect(block![0]).toMatch(/max-width:\s*min\(100%,\s*1040px\)/);
    expect(block![0]).not.toMatch(/880px/);
  });
});
