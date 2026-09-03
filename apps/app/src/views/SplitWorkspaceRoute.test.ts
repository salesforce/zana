import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('./SplitWorkspaceRoute.tsx', import.meta.url), 'utf8');
const area = readFileSync(new URL('./thread-detail/SplitThreadArea.tsx', import.meta.url), 'utf8');
const host = readFileSync(new URL('./thread-detail/SplitWorkspaceSecondaryPanelHost.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

describe('SplitWorkspaceRoute', () => {
  it('stays mounted from App so focus changes do not remount the tree', () => {
    expect(app).toContain('<SplitWorkspaceRoute />');
    expect(app).toContain('<Route path={APP_ROOT_ROUTE_PATH} element={null} />');
    expect(app).toContain('<Route path={AGENTS_ROUTE_PATH} element={null} />');
    expect(app).toContain('<Route path={NEW_THREAD_ROUTE_PATH} element={null} />');
    expect(app).toContain('<Route path={THREAD_ROUTE_PATH} element={null} />');
    expect(app).toContain('<Route path={SESSION_ROUTE_PATH} element={null} />');
    expect(app).toContain('<Route path={SCHEDULER_ROUTE_PATH} element={null} />');
    expect(app).toContain('<Route path={SCHEDULE_ROUTE_PATH} element={null} />');
    expect(app).toContain('<Route path={NEW_SCHEDULE_ROUTE_PATH} element={null} />');
    expect(app).toContain('<Route path={PROJECT_SESSION_ROUTE_PATH} element={null} />');
    expect(app).toContain('<Route path={PLUGIN_PANEL_ROOT_ROUTE_PATH} element={null} />');
    expect(app).toContain('isSplitWorkspacePath(location.pathname)');
    expect(route).toContain('extensionsHubRedirectForPath(location.pathname)');
    expect(route).toContain('<Navigate to={hubRedirect} replace />');
    expect(route).toContain('<SplitThreadArea routeContent={routeContent} />');
  });

  it('hosts recursive panes, a shared secondary, and numbered focus shortcuts', () => {
    expect(area).toContain('<AgentSessionPage');
    expect(area).toContain("content.kind === 'agent-session'");
    expect(area).toContain('<ScheduleDetailPage');
    expect(area).toContain("content.kind === 'schedule'");
    expect(area).toContain("content.kind === 'scheduler'");
    expect(area).toContain('<SchedulerView />');
    expect(area).toContain('const routeKey = paneContentRoute(routeContent)');
    expect(area).toContain('addEventListener(\'keydown\', onKey, true)');
    expect(area).toContain('stopImmediatePropagation()');
    expect(area).toContain('/^Digit([1-8])$/');
    expect(area).toContain('<SplitWorkspaceSecondaryPanelHost');
    expect(host).toContain('data-testid="split-workspace-host"');
    expect(css).toContain('.split-workspace {');
    expect(css).toContain('.split-pane.is-maximized {');
    expect(css).toContain('.split-pane-scrim.is-dimmed {');
    expect(css).toContain('.split-pane-minimap {');
    expect(css).toContain('.split-pane > *:not(.split-pane-scrim) {');
    expect(css).toContain('.thread-detail-view--split-pane .thread-detail-column {');
    expect(css).toContain('.split-tree-child {');
    expect(css).toContain('.split-workspace .agents-board,');
    expect(css).toContain('.split-workspace .scheduler-page,');
  });
});
