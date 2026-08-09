/**
 * Schedules grid: two body readouts (clock glyph vs "next run in …") flipped by
 * a nav toggle, and a yellow ("busy") fill while a run's session is still live.
 * We read the rendered tiles' hints (`heroText`/`icon`/`status`, set by
 * composeTile) off the built Page without a device.
 */

import { describe, it, expect } from 'vitest';

import { buildSchedulesPage } from '../pages/schedules-page.js';
import { XL } from '../deck/device.js';
import type { ScheduleItem } from '../lib/types.js';

const NOW = 1_700_000_000_000;
const inMin = (m: number) => new Date(NOW + m * 60_000).toISOString();

const enabled: ScheduleItem = {
  id: 'sc-1',
  name: 'nightly',
  enabled: true,
  projectId: 'p-1',
  schedule: { every: '24h' },
  status: { nextRunAt: inMin(125) } // 2h 5m out
};
const running: ScheduleItem = {
  id: 'sc-2',
  name: 'sync',
  enabled: true,
  projectId: 'p-2',
  schedule: { every: '1h' },
  status: { nextRunAt: inMin(30), lastRunSessionId: 'sess-live' }
};

const build = (view: 'icon' | 'eta', live: string[] = []) =>
  buildSchedulesPage([enabled, running], {
    openSchedule: () => {},
    refresh: () => {},
    toggleView: () => {},
    back: () => {},
    geom: XL,
    view,
    liveSessionIds: new Set(live),
    now: NOW
  });

describe('schedules grid — icon vs ETA readout', () => {
  it('shows the clock glyph in icon mode (no heroText)', () => {
    const key = build('icon').get(0, 0)!.render();
    expect(key.icon).toBe('schedules');
    expect(key.heroText).toBeUndefined();
  });

  it('shows the "next run in …" text in ETA mode (no glyph)', () => {
    const key = build('eta').get(0, 0)!.render();
    expect(key.heroText).toBe('2h 5m');
    expect(key.icon).toBeUndefined();
  });

  it('nav row is Refresh then a "Swap" toggle (swap glyph)', () => {
    const navRow = XL.rows - 1;
    // col 0 = Refresh, col 1 = the Swap toggle, in both modes.
    expect(build('icon').get(0, navRow)!.render().label).toBe('Refresh');
    const swapIcon = build('icon').get(1, navRow)!.render();
    expect(swapIcon.label).toBe('Swap');
    expect(swapIcon.icon).toBe('swap');
    const swapEta = build('eta').get(1, navRow)!.render();
    expect(swapEta.label).toBe('Swap');
    expect(swapEta.icon).toBe('swap');
  });
});

describe('schedules grid — running colour', () => {
  it('colours a schedule yellow (busy) while its run session is live', () => {
    // running is the 2nd body tile → (1, 0). With its session live it's busy.
    expect(build('icon', ['sess-live']).get(1, 0)!.render().status).toBe('busy');
    // Not live → falls back to green (enabled).
    expect(build('icon', []).get(1, 0)!.render().status).toBe('running');
  });

  it('a running schedule keeps the glyph even in ETA mode (next run is moot)', () => {
    const key = build('eta', ['sess-live']).get(1, 0)!.render();
    expect(key.icon).toBe('schedules');
    expect(key.heroText).toBeUndefined();
  });
});
