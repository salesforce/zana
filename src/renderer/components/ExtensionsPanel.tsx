/**
 * Top-level "Extensions" destination — the VSCode-style entry point. It hosts
 * the SAME {@link ExtensionsHub} that lives under Settings → Extensions, but as
 * a first-class rail view opened on the Marketplace tab, so browsing/installing
 * extensions is one click from the sidebar instead of buried two levels deep in
 * Settings. Settings keeps its Extensions section (versions & per-extension
 * settings); this is the discovery front door.
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
import { Blocks } from 'lucide-react';
import { ExtensionsHub } from './settings/ExtensionsHub';

export function ExtensionsPanel() {
  return (
    <main className="settings-panel extensions-panel">
      <div className="settings-inner settings-inner--wide">
        <header className="settings-header">
          <div className="settings-header-title">
            <Blocks size={18} />
            <h2>Extensions</h2>
            <span className="settings-header-desc">Browse, install & manage extensions</span>
          </div>
        </header>
        <ExtensionsHub initialTab="marketplace" />
      </div>
    </main>
  );
}
