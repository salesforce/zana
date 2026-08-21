/**
 * Top-level "Extensions" destination — the VSCode-style entry point. It hosts
 * the SAME {@link ExtensionsHub} that lives under Settings → Extensions, but as
 * a first-class rail view opened on the Marketplace tab, so browsing/installing
 * extensions is one click from the sidebar instead of buried two levels deep in
 * Settings. It also launches global extension panels; Settings keeps its
 * Extensions section for versions and per-extension settings.
 *
 * Reuses the settings-panel shell classes so it inherits the same wide,
 * multi-column layout the hub was authored for — no new styling surface.
 *
 * Unlike Settings → Extensions (where the SettingsPane section picker fills
 * column 2), `ListPane` returns null for the 'extensions' nav, so the shell
 * grid would auto-place this panel in the narrow `--col-list` track and leave
 * column 3 empty. The `extensions-panel` modifier spans it cols 2..end, the
 * same fix Personas/Teams use for their list-less panels.
 */
import { useUi } from '../store';
import { ExtensionsHub } from './settings/ExtensionsHub';
import { SkillsBody } from './SkillsPanel';
import { AppPageHeader } from './AppPageHeader';

export function ExtensionsPanel() {
  const tab = useUi((s) => s.extensionsTab);
  const setExtensionsTab = useUi((s) => s.setExtensionsTab);
  const showingSkills = tab === 'skills';

  return (
    <div className="settings-panel extensions-panel">
      <AppPageHeader title={<h1>Extensions</h1>} />
      <div className={`settings-inner${showingSkills ? '' : ' settings-inner--wide'}`}>
        {showingSkills ? (
          <SkillsBody showHeader={false} />
        ) : (
          <ExtensionsHub
            tab={tab}
            onTabChange={setExtensionsTab}
            showTabs={false}
          />
        )}
      </div>
    </div>
  );
}
