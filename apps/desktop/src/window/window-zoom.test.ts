import { describe, expect, it } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import {
  DEFAULT_RENDERER_ZOOM_FACTOR,
  MAX_RENDERER_ZOOM_FACTOR,
  MIN_RENDERER_ZOOM_FACTOR,
  steppedZoomLevel,
  zoomFactorFromLevel,
  zoomLevelFromFactor,
  zoomMenuItems,
  type ZoomTarget
} from './window-zoom.js';

function fakeTarget(factor = DEFAULT_RENDERER_ZOOM_FACTOR) {
  let level = zoomLevelFromFactor(factor);
  const calls: string[] = [];
  const target: ZoomTarget = {
    getZoomLevel: () => level,
    setZoomLevel: (next) => {
      calls.push(`level:${next}`);
      level = next;
    },
    setZoomFactor: (next) => {
      calls.push(`factor:${next}`);
      level = zoomLevelFromFactor(next);
    }
  };
  return { target, calls, factor: () => zoomFactorFromLevel(level) };
}

function byAccelerator(items: MenuItemConstructorOptions[], accelerator: string) {
  const item = items.find((entry) => entry.accelerator === accelerator);
  if (!item) throw new Error(`no menu item for ${accelerator}`);
  return item;
}

function press(item: MenuItemConstructorOptions, times = 1) {
  for (let i = 0; i < times; i++) (item.click as () => void)();
}

describe('zoom level maths', () => {
  it('converts between Chromium zoom levels and factors', () => {
    expect(zoomFactorFromLevel(0)).toBe(1);
    expect(zoomFactorFromLevel(1)).toBeCloseTo(1.2);
    expect(zoomLevelFromFactor(DEFAULT_RENDERER_ZOOM_FACTOR)).toBeCloseTo(-0.2813, 3);
    expect(zoomFactorFromLevel(zoomLevelFromFactor(2.5))).toBeCloseTo(2.5);
  });

  it('steps half a level and clamps to Chromium’s 25%–500% range', () => {
    expect(steppedZoomLevel(0, 1)).toBe(0.5);
    expect(steppedZoomLevel(0, -1)).toBe(-0.5);
    expect(zoomFactorFromLevel(steppedZoomLevel(zoomLevelFromFactor(4.9), 1))).toBeCloseTo(MAX_RENDERER_ZOOM_FACTOR);
    expect(zoomFactorFromLevel(steppedZoomLevel(zoomLevelFromFactor(0.26), -1))).toBeCloseTo(MIN_RENDERER_ZOOM_FACTOR);
    expect(steppedZoomLevel(Number.NaN, 1)).toBeCloseTo(zoomLevelFromFactor(DEFAULT_RENDERER_ZOOM_FACTOR) + 0.5);
  });
});

describe('zoomMenuItems on Windows and Linux', () => {
  for (const platform of ['win32', 'linux'] as const) {
    it(`${platform}: plain Ctrl+= zooms in, which Electron's zoomIn role (Ctrl+Plus = Shift+=) never did`, () => {
      const { target, factor } = fakeTarget();
      const items = zoomMenuItems(platform, () => target);
      expect(items.some((item) => item.role === 'zoomIn' || item.role === 'zoomOut')).toBe(false);
      const zoomIn = byAccelerator(items, 'CmdOrCtrl+=');
      expect(zoomIn).toMatchObject({ label: 'Zoom In' });
      expect(zoomIn.visible).not.toBe(false);
      press(zoomIn);
      expect(factor()).toBeCloseTo(1.041, 3);
    });
  }

  it('reaches at least 200% with Ctrl+= and stops at 500%', () => {
    const { target, factor } = fakeTarget();
    const zoomIn = byAccelerator(zoomMenuItems('win32', () => target), 'CmdOrCtrl+=');
    press(zoomIn, 8);
    expect(factor()).toBeGreaterThan(1.95);
    press(zoomIn, 9);
    expect(factor()).toBeGreaterThan(4.4);
    press(zoomIn, 5);
    expect(factor()).toBeCloseTo(MAX_RENDERER_ZOOM_FACTOR);
    press(zoomIn);
    expect(factor()).toBeCloseTo(MAX_RENDERER_ZOOM_FACTOR);
  });

  it('keeps Ctrl+Shift+= and the numpad keys as hidden aliases that work while hidden', () => {
    const { target, factor } = fakeTarget();
    const items = zoomMenuItems('win32', () => target);
    for (const accelerator of ['CmdOrCtrl+Plus', 'CmdOrCtrl+numadd', 'CmdOrCtrl+numsub']) {
      expect(byAccelerator(items, accelerator)).toMatchObject({ visible: false, acceleratorWorksWhenHidden: true });
    }
    press(byAccelerator(items, 'CmdOrCtrl+Plus'));
    press(byAccelerator(items, 'CmdOrCtrl+numadd'));
    expect(factor()).toBeCloseTo(zoomFactorFromLevel(zoomLevelFromFactor(DEFAULT_RENDERER_ZOOM_FACTOR) + 1));
    press(byAccelerator(items, 'CmdOrCtrl+numsub'));
    press(byAccelerator(items, 'CmdOrCtrl+-'), 20);
    expect(factor()).toBeCloseTo(MIN_RENDERER_ZOOM_FACTOR);
  });

  it('Reset Zoom returns to the 0.95 default', () => {
    const { target, calls, factor } = fakeTarget(3);
    press(byAccelerator(zoomMenuItems('win32', () => target), 'CmdOrCtrl+0'));
    expect(calls).toEqual([`factor:${DEFAULT_RENDERER_ZOOM_FACTOR}`]);
    expect(factor()).toBeCloseTo(DEFAULT_RENDERER_ZOOM_FACTOR);
  });

  it('does nothing when no app window is focused', () => {
    const items = zoomMenuItems('win32', () => null);
    for (const item of items) expect(() => press(item)).not.toThrow();
  });
});

describe('zoomMenuItems on macOS', () => {
  it('keeps Electron’s zoomIn / zoomOut roles, as on main', () => {
    const { target, calls } = fakeTarget();
    const items = zoomMenuItems('darwin', () => target);
    expect(items.map((item) => item.role ?? item.label)).toEqual(['Reset Zoom', 'zoomIn', 'zoomOut']);
    press(items[0]);
    expect(calls).toEqual([`factor:${DEFAULT_RENDERER_ZOOM_FACTOR}`]);
  });
});
