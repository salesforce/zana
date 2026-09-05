import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('./SplitWorkspaceRoute.tsx', import.meta.url), 'utf8');
const area = readFileSync(new URL('./thread-detail/SplitThreadArea.tsx', import.meta.url), 'utf8');
const bar = readFileSync(new URL('./thread-detail/SplitPaneBar.tsx', import.meta.url), 'utf8');
const pane = readFileSync(new URL('./thread-detail/PaneContext.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
const help = readFileSync(new URL('../components/ShortcutsHelp.tsx', import.meta.url), 'utf8');

describe('SplitWorkspaceRoute', () => {
  it('stays mounted from App so focus changes do not remount the tree', () => {
    expect(app).toContain('<SplitWorkspaceRoute />');
    expect(app).toContain('<Route path={APP_ROOT_ROUTE_PATH} element={null} />');
    expect(app).toContain('<Route path={INBOX_ROUTE_PATH} element={null} />');
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
    expect(app).toContain('&& !splitWorkspace');
    expect(app).not.toContain('titlebar-split');
    expect(app).not.toContain('openEmptySplitColumn');
    expect(css).not.toContain('.titlebar-split');
    expect(app).toContain('<Route path={PROJECT_MODE_ROUTE_PATH} element={null} />');
    expect(route).toContain('extensionsHubRedirectForPath(location.pathname)');
    expect(route).toContain('<Navigate to={hubRedirect} replace />');
    expect(route).toContain('<SplitThreadArea routeContent={routeContent} />');
  });

  it('hosts recursive panes and numbered focus shortcuts', () => {
    expect(area).toContain('<AgentSessionPage');
    expect(area).toContain("content.kind === 'agent-session'");
    expect(area).toContain("content.kind === 'home'");
    expect(area).toContain('<HomeView />');
    expect(area).toContain("content.kind === 'inbox'");
    expect(area).toContain('<InboxView />');
    expect(area).toContain("content.kind === 'agents'");
    expect(area).toContain('<AgentsView />');
    expect(area).toContain('<ScheduleDetailPage');
    expect(area).toContain("content.kind === 'schedule'");
    expect(area).toContain("content.kind === 'scheduler'");
    expect(area).toContain('<SchedulerView />');
    expect(area).toContain("content.kind === 'project-view'");
    expect(area).toContain('<ProjectModePane');
    expect(area).toContain('data-split="false"');
    expect(area).toContain('data-split-pane-id={paneId}');
    expect(area).toContain("content.kind === 'empty'");
    expect(area).toContain('data-testid="split-pane-empty"');
    expect(area).toContain('Drop a view here');
    expect(area).not.toContain('data-testid="split-pane-empty-close"');
    expect(area).not.toContain('split-pane-empty-header');
    expect(area).toContain('<SplitPaneBar');
    expect(bar).toContain('data-testid="split-pane-bar"');
    expect(area).not.toContain('split-pane-host-chrome');
    expect(css).toContain('.split-pane-bar {');
    expect(css).not.toContain('.split-pane-host-chrome {');
    expect(area).toContain('activateScope(scopeKey)');
    expect(area).toContain('[routeKey, scopeKey, updateLayout]');
    expect(area).toContain('const routeKey = paneContentRoute(routeContent)');
    expect(area).toContain('addEventListener(\'keydown\', onKey, true)');
    expect(area).toContain('stopImmediatePropagation()');
    expect(area).toContain('/^Digit([1-8])$/');
    expect(area).not.toContain('<SplitWorkspaceSecondaryPanelHost');
    expect(area).not.toContain('createPaneSecondaryPanelRegistry');
    expect(area).toContain('secondaryPanelRegistry={null}');
    expect(css).toContain('.split-workspace {\n  display: flex;');
    expect(css).toContain(
      '.split-workspace {\n  display: flex;\n  flex-direction: column;\n  min-width: 0;\n  min-height: 0;\n  width: 100%;\n  height: 100%;\n  grid-column: 2 / -1;\n  /* Grid item with a non-auto z-index creates a stacking context, so nested\n     list-pane z-index (Inbox) cannot paint over the sidebar. */\n  z-index: 0;\n}'
    );
    expect(css).toContain('.split-pane.is-maximized {');
    expect(css).toContain('.split-pane-scrim.is-dimmed {');
    expect(css).toContain('.split-pane-minimap {');
    expect(css).toContain('.split-pane > *:not(.split-pane-scrim):not(.split-pane-bar) {');
    expect(css).toContain('.thread-detail-view--split-pane .thread-detail-column {');
    expect(css).toContain('.split-tree-child {');
    expect(css).toContain('.split-workspace .agents-board,');
    expect(css).toContain('.split-workspace .scheduler-page,');
    expect(css).toContain('.split-workspace .inbox-view,');
    expect(css).not.toContain('.split-pane:hover .split-pane-header-actions');
    expect(help).toContain("title: 'Split'");
    expect(help).toContain('Close focused pane');
    expect(help).toContain('⌘');
    expect(help).toContain('⌥');
    expect(help).toContain('W');
  });

  it('does not clear and republish the hosted secondary panel on every model identity change', () => {
    expect(pane).toContain('if (model) host.publish(model);');
    expect(pane).toContain('No cleanup here');
    expect(pane).toContain('}, [host]);');
  });
});
