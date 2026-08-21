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
import { useUi } from '@/store';
import { ExtensionsHub } from '@/views/extensions/ExtensionsHub';
import { PluginSettingsSections } from '@/plugins/PluginSettingsSections';
import { SkillsBody } from '@/views/extensions/SkillsView';
import { McpBody } from '@/views/extensions/McpView';
import { AppPageHeader } from '@/components/AppPageHeader';

function extensionsTitle(tab: string): string {
  if (tab === 'skills') return 'Skills';
  if (tab === 'mcp') return 'MCP';
  return 'Extensions';
}

export function ExtensionsView() {
  const tab = useUi((s) => s.extensionsTab);
  const setExtensionsTab = useUi((s) => s.setExtensionsTab);
  const showingCatalogue = tab === 'skills' || tab === 'mcp';

  return (
    <div className="settings-panel extensions-panel">
      <AppPageHeader title={<h1>{extensionsTitle(tab)}</h1>} />
      <div className={`settings-inner${showingCatalogue ? '' : ' settings-inner--wide'}`}>
        {tab === 'skills' ? (
          <SkillsBody showHeader={false} />
        ) : tab === 'mcp' ? (
          <McpBody showHeader={false} />
        ) : (
          <>
            <ExtensionsHub
              tab={tab}
              onTabChange={(next) => setExtensionsTab(next)}
              showTabs={false}
            />
            <PluginSettingsSections />
          </>
        )}
      </div>
    </div>
  );
}

export { ExtensionsView as ExtensionsPanel };
