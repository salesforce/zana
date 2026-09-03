import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const panel = readFileSync(
  fileURLToPath(new URL('./SchedulerView.tsx', import.meta.url)),
  'utf8'
);

describe('SchedulerPanel has no inner list rail', () => {
  it('does not mount SchedulerPane or a list/detail split', () => {
    expect(panel).not.toContain('<SchedulerPane');
    expect(panel).not.toContain('scheduler-panel--split');
    expect(panel).not.toContain('list-pane');
    expect(panel).toContain('settings-inner');
    expect(panel).toContain('scheduler-page');
  });

  it('keeps groups management on the center surface', () => {
    expect(panel).toContain('ScheduleGroupsModal');
    expect(panel).toContain('Manage schedule groups');
  });

  it('opens schedules on dedicated routes instead of a modal editor', () => {
    expect(panel).not.toContain('ScheduleModal');
    expect(panel).toContain('getScheduleRoutePath');
    expect(panel).toContain('getNewScheduleRoutePath');
    expect(panel).toContain('openScheduleInSplit');
  });
});
