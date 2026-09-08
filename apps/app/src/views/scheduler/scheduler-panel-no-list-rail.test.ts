import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const panel = readFileSync(
  fileURLToPath(new URL('./SchedulerView.tsx', import.meta.url)),
  'utf8'
);
const groups = readFileSync(
  fileURLToPath(new URL('../../components/ScheduleGroupsModal.tsx', import.meta.url)),
  'utf8'
);
const css = readFileSync(
  fileURLToPath(new URL('../../styles/global.css', import.meta.url)),
  'utf8'
);
const detail = readFileSync(
  fileURLToPath(new URL('./ScheduleDetailPage.tsx', import.meta.url)),
  'utf8'
);
const area = readFileSync(
  fileURLToPath(new URL('../thread-detail/SplitThreadArea.tsx', import.meta.url)),
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

  it('hosts AuroraGrid the same way Home and Plugins do', () => {
    expect(panel).toContain('scheduler-panel aurora-host');
    expect(panel).toContain('<AuroraGrid />');
    expect(panel.indexOf('<AuroraGrid />')).toBeLessThan(panel.indexOf('className="settings-inner"'));

    const innerStart = css.indexOf('.scheduler-panel .settings-inner {');
    expect(innerStart).toBeGreaterThan(-1);
    const inner = css.slice(innerStart, css.indexOf('}', innerStart));
    expect(inner).toContain('position: relative;');
    expect(inner).toContain('z-index: 1;');
    expect(inner).toContain('max-width: min(100%, 1040px);');

    expect(css).toContain('.scheduler-panel.aurora-host {\n  display: flex;');
    expect(css).toContain('.scheduler-panel.aurora-host .settings-inner {\n  flex: 1 1 auto;');
  });

  it('portals the groups dialog out of the aurora stacking context', () => {
    expect(groups).toContain('return createPortal(node, document.body)');
    expect(groups).toContain('className="modal-backdrop"');
  });

  it('keeps groups management on the center surface', () => {
    expect(panel).toContain('ScheduleGroupsModal');
    expect(panel).toContain('Manage schedule groups');
  });

  it('opens schedules on dedicated routes as a normal page', () => {
    expect(panel).toContain('getScheduleRoutePath');
    expect(panel).toContain('getNewScheduleRoutePath');
    expect(panel).toContain('openScheduleInSplit');
    expect(detail).toContain('className="schedule-detail-pane"');
    expect(detail).not.toContain('<Modal');
    expect(detail).not.toContain('className="schedule-detail-modal"');
    expect(detail).not.toContain('ThreadSecondaryPanel');
    expect(area).not.toContain('isSplitPane ? null : <SchedulerView');
  });

  it('paints overview cards with the opaque panel token', () => {
    expect(css).toMatch(/\.overview-kpi \{\n  background: var\(--bg-panel\);/);
    expect(css).toMatch(/\.scheduler-overview \.overview-card \{\n  background: var\(--bg-panel\);/);
    expect(css).not.toContain('var(--panel-bg, rgba(255, 255, 255, 0.03))');
  });
});
