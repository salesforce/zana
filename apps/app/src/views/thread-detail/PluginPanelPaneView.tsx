import { useMemo, useSyncExternalStore } from 'react';
import { AppModulePanel } from '../../modules/ModulePanelHost.js';
import { useMergedModules } from '../../modules/index.js';
import { listNavPanels, subscribePluginSlots } from '../../plugins/plugin-slots.js';
import { PluginSlotBoundary } from '../../plugins/PluginSlotBoundary.js';

export function PluginPanelPaneView({
  pluginId,
  panelPath,
  subPath
}: {
  pluginId: string;
  panelPath: string;
  subPath: string;
}) {
  const panels = useSyncExternalStore(subscribePluginSlots, listNavPanels, listNavPanels);
  const modules = useMergedModules();
  const panel = useMemo(() => {
    const forPlugin = panels.filter((row) => row.pluginId === pluginId);
    if (forPlugin.length === 0) return null;
    return forPlugin.find((row) => (row.path ?? row.id) === panelPath) ?? forPlugin[0] ?? null;
  }, [panelPath, panels, pluginId]);

  if (panel) {
    const Component = panel.component;
    return (
      <div className="module-panel-host split-plugin-pane">
        <div className="module-panel-slot panel-body--full">
          <PluginSlotBoundary pluginId={panel.pluginId} generation={panel.generation}>
            <Component pluginId={panel.pluginId} subPath={subPath} />
          </PluginSlotBoundary>
        </div>
      </div>
    );
  }

  if (modules.some((row) => row.id === pluginId)) {
    return <AppModulePanel moduleId={pluginId} />;
  }

  return <div className="split-pane-empty">This plugin panel is not available.</div>;
}
