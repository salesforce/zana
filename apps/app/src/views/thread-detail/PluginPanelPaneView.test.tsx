import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const slots = vi.hoisted(() => ({
  panels: [] as Array<{
    pluginId: string;
    id: string;
    path?: string;
    generation: number;
    component: (props: { pluginId: string; subPath: string }) => unknown;
  }>,
  modules: [] as Array<{ id: string; title: string }>
}));

vi.mock('../../plugins/plugin-slots.js', () => ({
  subscribePluginSlots: (listener: () => void) => {
    listener();
    return () => undefined;
  },
  listNavPanels: () => slots.panels
}));

vi.mock('../../modules/index.js', () => ({
  useMergedModules: () => slots.modules
}));

vi.mock('../../modules/ModulePanelHost.js', () => ({
  AppModulePanel: ({ moduleId }: { moduleId: string }) => (
    <div data-testid="compiled-module">{moduleId}</div>
  )
}));

vi.mock('../../plugins/PluginSlotBoundary.js', () => ({
  PluginSlotBoundary: ({ children }: { children: unknown }) => children
}));

import { PluginPanelPaneView } from './PluginPanelPaneView.js';

describe('PluginPanelPaneView', () => {
  it('renders a plugin navPanel slot when one is registered', () => {
    slots.panels = [
      {
        pluginId: 'tasks',
        id: 'panel',
        path: 'panel',
        generation: 1,
        component: ({ pluginId }) => <div>slot:{pluginId}</div>
      }
    ];
    slots.modules = [];
    const html = renderToStaticMarkup(
      <PluginPanelPaneView pluginId="tasks" panelPath="panel" subPath="" />
    );
    expect(html).toContain('slot:tasks');
    expect(html).not.toContain('compiled-module');
    slots.panels = [];
  });

  it('falls back to the compiled AppModule panel when Docs has no navPanel slot', () => {
    slots.panels = [];
    slots.modules = [{ id: 'docs', title: 'Docs' }];
    const html = renderToStaticMarkup(
      <PluginPanelPaneView pluginId="docs" panelPath="panel" subPath="" />
    );
    expect(html).toContain('compiled-module');
    expect(html).toContain('docs');
    expect(html).not.toContain('This plugin panel is not available');
    slots.modules = [];
  });

  it('shows the empty state when neither a slot nor an AppModule exists', () => {
    slots.panels = [];
    slots.modules = [];
    const html = renderToStaticMarkup(
      <PluginPanelPaneView pluginId="missing" panelPath="panel" subPath="" />
    );
    expect(html).toContain('This plugin panel is not available');
  });
});
