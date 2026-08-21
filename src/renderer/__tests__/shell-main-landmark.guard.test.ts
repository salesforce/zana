/**
 * Regression guard — the app shell is always nav + one full content <main>.
 *
 * Source-text (not jsdom): placement is CSS-grid, and a missing landmark or
 * leftover ListPane column would silently pass a DOM-based test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const RENDERER_ROOT = fileURLToPath(new URL('..', import.meta.url));

function src(rel: string): string {
  return readFileSync(join(RENDERER_ROOT, rel), 'utf8');
}

const PANEL_FILES = [
  'components/Workspace.tsx',
  'components/GlobalAgentsBoard.tsx',
  'components/HomePanel.tsx',
  'components/SettingsPanel.tsx',
  'components/SchedulerPanel.tsx',
  'components/FollowUpsPanel.tsx',
  'components/GoalsPanel.tsx',
  'components/ExtensionsPanel.tsx',
  'components/OverviewPanel.tsx',
  'components/ErrorBoundary.tsx'
] as const;

describe('single shell <main> landmark', () => {
  it('App.tsx contains exactly one <main className="shell-main">', () => {
    const app = src('App.tsx');
    const matches = app.match(/<main className="shell-main">/g) ?? [];
    expect(matches).toHaveLength(1);
    expect((app.match(/<main\b/g) ?? []).length).toBe(1);
  });

  it.each(PANEL_FILES)('%s does not emit <main', (file) => {
    expect(src(file)).not.toMatch(/<main\b/);
  });

  it('does not render terminal-surface-host', () => {
    expect(src('App.tsx')).not.toMatch(/terminal-surface-host/);
    expect(src('components/TerminalSurface.tsx')).not.toMatch(/terminal-surface-host/);
  });

  it('mounts GlobalAgentsBoard only when nav === \'agents\'', () => {
    const app = src('App.tsx');
    expect(app).toMatch(/\{nav === 'agents' && <GlobalAgentsBoard \/>\}/);
    expect(app).not.toMatch(/nav === 'projects' && !focusedProjectId/);
  });

  it('never mounts ListPane as a shell column and always applies scoped-no-list', () => {
    const app = src('App.tsx');
    expect(app).not.toMatch(/<ListPane\b/);
    expect(app).not.toMatch(/from '\.\/components\/ListPane'/);
    expect(app).toMatch(/scoped-no-list/);
    expect(app).not.toMatch(/contentOwnsListColumn/);
  });

  it('InboxView keeps an inner list pane; Scheduler is a single full-width surface', () => {
    expect(src('components/InboxView.tsx')).toMatch(/<InboxPane\s*\/>/);
    expect(src('components/SchedulerPanel.tsx')).not.toMatch(/<SchedulerPane\b/);
    expect(src('components/SchedulerPanel.tsx')).not.toMatch(/scheduler-panel--split/);
  });
});
