/**
 * Regression guard — in-place modals must dim the whole window.
 *
 * Routed panels are stacking contexts (`.split-workspace { z-index: 0 }`,
 * `.inbox-view` / `.aurora-host { isolation: isolate }`). A `position: fixed;
 * inset: 0` backdrop rendered inside one (GUS detail modal, core dialogs that
 * don't portal) is trapped there, so the sidebar (`z-index: 1`) and the
 * title-bar trigger overlay (`z-index: 50`) paint above it and stay bright and
 * clickable. global.css lifts any content track holding an open modal above
 * that chrome. This guard keeps that rule, its selector coverage, and its
 * z-index ordering against the chrome and root overlays.
 */
import { describe, expect, it } from 'vitest';
import { readSourceText } from './helpers/source-text.js';

const css = readSourceText(new URL('../styles/global.css', import.meta.url));

function zIndexOf(selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(block, `${selector} block`).not.toBeNull();
  const z = /z-index:\s*(\d+)/.exec(block![1]);
  expect(z, `${selector} z-index`).not.toBeNull();
  return Number(z![1]);
}

const MODAL_MARKERS = /:has\(:is\(\[aria-modal='true'\], \.modal-backdrop, \.palette-backdrop\)\)/;

describe('content-track modal lift', () => {
  const rule = /\.shell-main > :has\([^{]*\),\s*\n\.shell-main > \.project-slot > :has\([^{]*\)\s*\{([^}]*)\}/.exec(css);

  it('lifts both direct content tracks and the project shell', () => {
    expect(rule, 'lift rule present in global.css').not.toBeNull();
    const selectors = rule![0].slice(0, rule![0].indexOf('{'));
    // Split the selector list on its top-level comma only (`:is(...)` has its own).
    const list = selectors.split(/,\s*\n/);
    expect(list).toHaveLength(2);
    for (const line of list) expect(line.trim()).toMatch(MODAL_MARKERS);
  });

  it('sits above the sidebar and title-bar trigger, below root overlays', () => {
    const lift = Number(/z-index:\s*(\d+)/.exec(rule![1])?.[1]);
    expect(lift).toBeGreaterThan(zIndexOf('.sidebar'));
    expect(lift).toBeGreaterThan(zIndexOf('.sidebar-trigger-overlay'));
    expect(lift).toBeLessThan(zIndexOf('.toaster'));
    expect(lift).toBeLessThan(zIndexOf('.modal-backdrop'));
  });

  it('keeps the panel stacking contexts that make the lift necessary', () => {
    // If these go away the lift is harmless, but the list-pane-over-sidebar
    // regressions they prevent come back — update this guard deliberately.
    expect(zIndexOf('.split-workspace')).toBe(0);
  });
});
