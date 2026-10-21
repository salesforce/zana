import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

it.each([
  'views/thread-detail/PluginPanelPaneView.tsx',
  'views/project/ProjectModePane.tsx',
  'views/plugin-view/PluginViewApp.tsx',
  'modules/ModulePanelHost.tsx',
  'plugins/PluginNavPanelHost.tsx'
])('keeps %s on the shared plugin side-panel host', (path) => {
  expect(source(path)).toContain('<PluginPanelHostLayout');
  expect(source(path)).not.toMatch(/launchers\s*=|<ThreadSecondaryPanel/);
});

it('keeps the host independent of the native browser and its rail mandatory', () => {
  const host = source('views/thread-detail/PluginPanelHostLayout.tsx');
  expect(host).not.toMatch(/getDesktopBrowserApi|hasDesktopBridge|launchers\??:/);
  expect(host).toContain('<ThreadSecondaryPanel');
  expect(host).toContain('<PanelAgentTab');
});

it('routes Design Docs conversations through host agent tabs', () => {
  const agents = readFileSync(new URL('../../../../plugins/design-docs/src/app/Agents.tsx', import.meta.url), 'utf8');
  expect(agents).toContain('navigate.openPanelAgent');
  expect(agents).not.toMatch(/<ThreadChat|dd-agent-chat/);
});
