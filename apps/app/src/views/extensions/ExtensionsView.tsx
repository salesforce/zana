/**
 * Top-level "Extensions" destination — the VSCode-style entry point. It hosts
 * the plugin hub, Skills, and MCP catalogues as a first-class rail view, so
 * browsing/installing extensions and managing skills/MCP is one click from the
 * sidebar instead of buried in Settings.
 *
 * Reuses the settings-panel shell classes so it inherits the same wide,
 * multi-column layout the hub was authored for — no new styling surface.
 *
 * `ListPane` returns null for the 'extensions' nav, so the shell grid would
 * auto-place this panel in the narrow `--col-list` track and leave column 3
 * empty. The `extensions-panel` modifier spans it cols 2..end, the same fix
 * Personas/Teams use for their list-less panels.
 */
import { AuroraGrid } from '@/components/AuroraGrid';
import { useRouteState } from '@/hooks/useRouteState';
import { useUi } from '@/store';
import { PluginPanelPaneView } from '@/views/thread-detail/PluginPanelPaneView';
import { ExtensionsHub } from '@/views/extensions/ExtensionsHub';
import { SkillsBody } from '@/views/extensions/SkillsView';
import { McpBody } from '@/views/extensions/McpView';

export function ExtensionsView() {
  const tab = useUi((s) => s.extensionsTab);
  const setExtensionsTab = useUi((s) => s.setExtensionsTab);
  const route = useRouteState();
  const showingCatalogue = tab === 'skills' || tab === 'mcp';
  const hubPage =
    tab === 'page' && route.extensionsHubPluginId && route.pluginPanelPath
      ? {
          pluginId: route.extensionsHubPluginId,
          pageId: route.pluginPanelPath,
          subPath: route.pluginSubPath
        }
      : null;

  return (
    <div className="settings-panel extensions-panel aurora-host">
      <AuroraGrid />
      <div className={`settings-inner${showingCatalogue ? '' : ' settings-inner--wide'}`}>
        {tab === 'skills' ? (
          <SkillsBody showHeader={false} />
        ) : tab === 'mcp' ? (
          <McpBody showHeader={false} />
        ) : hubPage ? (
          <PluginPanelPaneView
            pluginId={hubPage.pluginId}
            panelPath={hubPage.pageId}
            subPath={hubPage.subPath}
          />
        ) : (
          <ExtensionsHub
            tab={tab === 'page' ? 'installed' : tab}
            onTabChange={(next) => setExtensionsTab(next)}
            showTabs={false}
          />
        )}
      </div>
    </div>
  );
}

export { ExtensionsView as ExtensionsPanel };
