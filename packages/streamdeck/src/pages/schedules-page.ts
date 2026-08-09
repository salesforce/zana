/**
 * Schedules view — a grid of the user's scheduled tasks (from `sched.list`).
 * Tile colour reflects state: green when enabled, slate when disabled, and
 * YELLOW ("busy") while a run's spawned session is still live. A nav toggle
 * flips the body between two readouts:
 *   - `icon` (default): the clock glyph.
 *   - `eta`:            "next run in …" (e.g. "5m", "2h") from `status.nextRunAt`.
 * Pressing a schedule opens an overlay to run it now or toggle it (see
 * schedule-actions-page.ts). Fetched on open, not polled — so the ETA is a
 * snapshot as of the last fetch/refresh, not a live countdown.
 */

import { type Page } from '../deck/page.js';
import { XL, type Geometry } from '../deck/device.js';
import { buildGrid, bodyCapacity } from '../deck/layout.js';
import { composeTile } from '../deck/renderer.js';
import {
  scheduleLabel,
  nextRunEta,
  isScheduleRunning,
  type ScheduleItem
} from '../lib/types.js';

/** XL grid: rows 0–2 × 8 = 24 schedule slots (folds per model); last row is nav. */
export const SCHEDULE_SLOTS = 24;

/** Which readout the schedule tiles show. */
export type ScheduleView = 'icon' | 'eta';

export interface SchedulesPageDeps {
  openSchedule: (schedule: ScheduleItem) => void;
  refresh: () => void;
  back: () => void;
  geom?: Geometry;
  /** Body readout mode; defaults to `icon`. */
  view?: ScheduleView;
  /** Flip between the clock glyph and the "next run in …" readout. */
  toggleView?: () => void;
  /** Session ids of currently-live agents — a schedule whose last run matches
   *  one is mid-run and coloured yellow. Empty set ⇒ none running. */
  liveSessionIds?: ReadonlySet<string>;
  /** Wall-clock "now" in ms for the ETA maths. Defaults to the fetch time. */
  now?: number;
}

/** Build the schedules grid from a snapshot, folded to the deck's geometry. */
export function buildSchedulesPage(schedules: ScheduleItem[], deps: SchedulesPageDeps): Page {
  const geom = deps.geom ?? XL;
  const size = geom.keyPx; // native key px (undefined → renderer defaults to 96)
  const shown = schedules.slice(0, bodyCapacity(geom));
  const view = deps.view ?? 'icon';
  const live = deps.liveSessionIds ?? new Set<string>();
  const now = deps.now ?? Date.now();

  return buildGrid({
    name: 'schedules',
    geom,
    fillBody: true,
    body: shown.map((schedule) => {
      const running = isScheduleRunning(schedule, live);
      // Colour: yellow while a run is live, else green when enabled, else slate.
      const status = running ? 'busy' : schedule.enabled ? 'running' : 'idle';
      return {
        render: () =>
          composeTile({
            status,
            caption: scheduleLabel(schedule),
            // ETA mode shows the "next run in …" text in the icon zone; icon mode
            // shows the clock glyph. A running schedule always shows the glyph
            // (its "next run" is moot while it's mid-run).
            ...(view === 'eta' && !running
              ? { heroText: nextRunEta(schedule, now) }
              : { icon: 'schedules' as const }),
            size
          }),
        onPress: () => deps.openSchedule(schedule)
      };
    }),
    nav: [
      {
        render: () => composeTile({ status: 'idle', caption: 'Refresh', icon: 'refresh', size }),
        onPress: deps.refresh
      },
      {
        render: () =>
          composeTile({
            // Highlight (green) while showing the ETA readout; neutral on the glyph.
            status: view === 'eta' ? 'running' : 'idle',
            // One affordance that flips the body between the clock glyph and the
            // "next run in …" readout — always labelled "Swap".
            caption: 'Swap',
            icon: 'swap',
            size
          }),
        onPress: deps.toggleView ?? deps.refresh
      }
    ],
    back: { render: () => composeTile({ status: 'idle', caption: 'Back', icon: 'back', size }), onPress: deps.back }
  });
}
