import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { picklistOptionVisible, placePopoverMenu, splitPicklistOptions } from '../PopoverPicklist.js';

const source = readFileSync(
  join(fileURLToPath(new URL('../../../../../../packages/ui/src/popover-picklist.tsx', import.meta.url))),
  'utf8'
);

describe('PopoverPicklist', () => {
  it('supports disabled choices and keyboard navigation without restoring native selects', () => {
    expect(source).toContain('disabled?: boolean');
    expect(source).toContain('aria-haspopup="listbox"');
    expect(source).toContain('aria-activedescendant');
    expect(source).toContain("event.key === 'ArrowDown'");
    expect(source).toContain("event.key === 'ArrowUp'");
    expect(source).toContain("event.key === 'Enter'");
    expect(source).toContain('placePopoverMenu(');
    expect(source).not.toContain('<select');
  });

  it('keeps sticky action rows visible while the list is filtered', () => {
    expect(source).toContain('sticky?: boolean');
    expect(source).toContain('picklistOptionVisible');
    expect(source).toContain('splitPicklistOptions');
    expect(source).toContain('launch-model-picker-menu--split');
    expect(source).toContain('launch-model-picker-options');
    expect(source).toContain('launch-model-picker-footer');
    expect(picklistOptionVisible({ label: 'New project', sticky: true }, 'core')).toBe(true);
    expect(picklistOptionVisible({ label: 'core-repo' }, 'core')).toBe(true);
    expect(picklistOptionVisible({ label: 'Claude Sonnet', compactLabel: 'Sonnet' }, 'sonnet')).toBe(true);
    expect(picklistOptionVisible({ label: 'Ask', description: 'Plan first' }, 'plan')).toBe(true);
    expect(picklistOptionVisible({ label: 'core-repo' }, 'salesforce')).toBe(false);
    expect(picklistOptionVisible({ label: 'Default Project' }, '')).toBe(true);
  });

  it('pins sticky actions below a filtered scrolling list', () => {
    const split = splitPicklistOptions([
      { value: 'alpha', label: 'alpha-repo' },
      { value: 'core', label: 'core-repo' },
      { value: 'new', label: 'New project', sticky: true },
      { value: 'none', label: "Don't work in a project", sticky: true }
    ], 'core');
    expect(split.items.map((row) => row.value)).toEqual(['core']);
    expect(split.sticky.map((row) => row.value)).toEqual(['new', 'none']);
    expect(splitPicklistOptions([
      { value: 'alpha', label: 'alpha-repo' },
      { value: 'new', label: 'New project', sticky: true }
    ], 'zzz').items).toEqual([]);
    expect(splitPicklistOptions([
      { value: 'alpha', label: 'alpha-repo' },
      { value: 'new', label: 'New project', sticky: true }
    ], 'zzz', false).items.map((row) => row.value)).toEqual(['alpha']);
  });
});

describe('placePopoverMenu', () => {
  it('opens below a left-side trigger and grows to minWidth', () => {
    expect(placePopoverMenu(
      { left: 40, right: 120, top: 80, bottom: 112, width: 80 },
      { width: 1280, height: 800 },
      200
    )).toEqual({
      left: 40,
      width: 200,
      maxHeight: 360,
      top: 116
    });
  });

  it('aligns a right-edge trigger to keep the menu on screen', () => {
    const placed = placePopoverMenu(
      { left: 1117, right: 1164, top: 250, bottom: 282, width: 47 },
      { width: 1280, height: 900 },
      200
    );
    expect(placed.left).toBe(964);
    expect(placed.left + placed.width).toBe(1164);
    expect(placed.left + placed.width).toBeLessThanOrEqual(1272);
    expect(placed.top).toBe(286);
  });

  it('clamps when the menu is wider than the viewport', () => {
    const placed = placePopoverMenu(
      { left: 20, right: 60, top: 40, bottom: 72, width: 40 },
      { width: 180, height: 400 },
      200
    );
    expect(placed.left).toBe(8);
    expect(placed.width).toBe(200);
  });

  it('anchors above when there is not enough room below', () => {
    const placed = placePopoverMenu(
      { left: 40, right: 120, top: 700, bottom: 732, width: 80 },
      { width: 1280, height: 800 },
      200
    );
    expect(placed.bottom).toBe(104);
    expect(placed.top).toBeUndefined();
    expect(placed.maxHeight).toBe(360);
  });

  it('never lets a long project list fill the viewport', () => {
    const placed = placePopoverMenu(
      { left: 40, right: 120, top: 700, bottom: 732, width: 80 },
      { width: 1280, height: 1200 },
      200
    );
    expect(placed.maxHeight).toBeLessThanOrEqual(360);
    expect(placed.maxHeight).toBeLessThanOrEqual(Math.floor(1200 * 0.55));
  });
});
