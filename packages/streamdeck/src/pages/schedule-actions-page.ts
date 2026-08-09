/**
 * Per-schedule action overlay, pushed when a schedule tile is pressed. Two
 * writes: fire it immediately (`sched.runNow`), or flip its enabled flag
 * (`sched.setEnabled`). The toggle sends the INVERSE of the snapshot's current
 * `enabled`, so the tile it came from tells the button which way to flip.
 */

import { type Page } from '../deck/page.js';
import { XL, type Geometry } from '../deck/device.js';
import { buildOverlay } from '../deck/layout.js';
import { composeTile } from '../deck/renderer.js';
import { scheduleLabel, type ScheduleItem } from '../lib/types.js';
import type { ActionQueue } from '../lib/actions.js';

export interface ScheduleActionsDeps {
  queue: ActionQueue;
  back: () => void;
  geom?: Geometry;
}

export function buildScheduleActionsPage(schedule: ScheduleItem, deps: ScheduleActionsDeps): Page {
  const { queue, back } = deps;
  const geom = deps.geom ?? XL;
  const size = geom.keyPx; // native key px (undefined → renderer defaults to 96)

  return buildOverlay({
    name: 'schedule_actions',
    geom,
    // Header: the schedule this overlay targets (green when enabled). Static.
    header: { render: () => composeTile({ status: schedule.enabled ? 'running' : 'idle', caption: scheduleLabel(schedule), icon: 'schedules', pressable: false, size }) },
    actions: [
      // Run now, then toggle — label + intent are the inverse of current. The
      // power ring is drawn filled when enabling (turning on), hollow when off.
      { render: () => composeTile({ status: 'idle', caption: 'Run now', icon: 'run', size }), onPress: () => queue.enqueue({ kind: 'sched-run', id: schedule.id }) },
      {
        render: () => composeTile({ status: 'idle', caption: schedule.enabled ? 'Disable' : 'Enable', icon: 'power', filled: schedule.enabled, size }),
        onPress: () => queue.enqueue({ kind: 'sched-toggle', id: schedule.id, enabled: !schedule.enabled })
      }
    ],
    back: { render: () => composeTile({ status: 'idle', caption: 'Back', icon: 'back', size }), onPress: back }
  });
}
