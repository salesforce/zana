import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const view = readFileSync(new URL('./ExtensionsView.tsx', import.meta.url), 'utf8');
const marketplace = readFileSync(new URL('./MarketplaceView.tsx', import.meta.url), 'utf8');
const hero = readFileSync(
  new URL('../../components/plugin/browse-hero/BrowseHeroCarousel.tsx', import.meta.url),
  'utf8'
);
const hub = ['ExtensionsHub.tsx', 'InstalledPluginCard.tsx', 'InstalledPluginCollection.tsx']
  .map((file) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')).join('\n');
const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

describe('ExtensionsView plugin catalogue', () => {
  it('does not host the Home aurora grid on Plugins', () => {
    expect(view).toContain('className="settings-panel extensions-panel"');
    expect(view).not.toContain('aurora-host');
    expect(view).not.toContain('<AuroraGrid />');
  });

  it('mounts hub pages from plugin navPanels inside the extensions panel', () => {
    expect(view).toContain('PluginPanelPaneView');
    expect(view).toContain('extensionsHubPluginId');
  });

  it('does not dump plugin settings sections under the plugin list', () => {
    expect(view).not.toContain('PluginSettingsSections');
  });

  it('mounts plugin settings sections on the plugin detail page', () => {
        expect(hub).toContain('PluginSettingsSections');
        expect(hub).toContain('<PluginSettingsSections pluginId={module.id} />');
        expect(hub).toContain('<PluginSettingsForm snap={settingsSnap}');
        expect(hub).toContain('PluginHubIncludes');
        expect(hub).toContain('id="plugin-configure"');
        expect(hub).toContain('ext-plugin-section--config');
        expect(hub).toContain('ext-plugin-detail-stack');
  });

  it('pins the grid to the panel and lifts hub content above it', () => {
    const panelStart = css.indexOf('.extensions-panel {\n  display: flex;');
    expect(panelStart).toBeGreaterThan(-1);
    const panel = css.slice(panelStart, css.indexOf('}', panelStart));
    expect(panel).toContain('display: flex;');
    expect(panel).toContain('flex-direction: column;');
    expect(panel).toContain('height: 100%;');
    expect(panel).toContain('overflow: hidden;');

    const innerStart = css.indexOf('.extensions-panel .settings-inner {');
    expect(innerStart).toBeGreaterThan(-1);
    const inner = css.slice(innerStart, css.indexOf('}', innerStart));
    expect(inner).toContain('position: relative;');
    expect(inner).toContain('z-index: 1;');
    expect(inner).toContain('flex: 1 1 auto;');
    expect(inner).toContain('min-height: 0;');
    expect(inner).toContain('overflow-y: auto;');
    expect(inner).toContain('width: 100%;');
    expect(inner).toContain('scrollbar-width: none;');

    expect(css).toContain('.extensions-panel .settings-inner::-webkit-scrollbar {');
    expect(css).toContain('.extensions-panel .settings-inner:has(.ext-hub-shell) {\n  overflow: hidden;');
    expect(css).toContain('.ext-market-scroller {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow-y: auto;');
    expect(css).toContain('.ext-installed-scroller {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow-y: auto;');
    expect(css).toContain('.ext-market-scroller::-webkit-scrollbar {');
    expect(css).toContain('.ext-installed-scroller::-webkit-scrollbar {');
    expect(css).toContain('.ext-market-search-refresh {');

    expect(css).toContain('.extensions-panel .ext-market.settings-section {');
    expect(css).toContain('.extensions-panel .ext-market-item {\n  background: var(--bg-panel);');
  });

  it('scrolls only the plugin list on Browse and Installed', () => {
    expect(marketplace).toContain('className="ext-market-scroller"');
    expect(marketplace).toContain('Available to install');
    expect(marketplace).toContain('Already in your app');
    expect(hub).toContain('className="ext-installed-scroller ext-plugin-collection-main"');
    expect(hub).toContain('className="ext-installed-panel"');
    expect(css).toContain(
      '.ext-market {\n  display: flex;\n  flex-direction: column;\n  flex: 1;\n  min-height: 0;\n  overflow: hidden;'
    );
    expect(css).toContain(
      '.ext-installed {\n  display: flex;\n  flex-direction: column;\n  gap: 16px;\n  width: 100%;\n  flex: 1;\n  min-height: 0;\n  overflow: hidden;'
    );
  });

  it('uses one Add plugin menu and compact responsive rows', () => {
    expect(hub).toContain('Add plugin');
    expect(hub).toContain('aria-label="Add a plugin"');
    const collectionCss = readFileSync(new URL('./installed-plugin-collection.css', import.meta.url), 'utf8');
    expect(collectionCss).toContain('.ext-installed-row.is-selected');
    expect(collectionCss).toContain('@container plugin-collection (max-width: 950px)');
    expect(collectionCss).toContain('@container plugin-collection (max-width: 650px)');
  });

  it('keeps primary button hover on the accent fill so the label stays readable', () => {
    expect(css).toContain(
      '.settings-btn:hover:not(:disabled):not(.primary):not(.settings-btn--primary) {\n  background: var(--bg-hover);'
    );
    expect(css).toContain(
      '.settings-btn.primary:hover:not(:disabled),\n.settings-btn--primary:hover:not(:disabled) {\n  color: #fff;\n  background: color-mix(in srgb, var(--accent) 88%, #000);'
    );
  });

  it('keeps Browse Create a plugin on the page with an example card grid', () => {
    expect(marketplace).toContain("searchParams.get('view') === 'create'");
    expect(marketplace).toContain('BrowseHeroCarousel');
    expect(hero).toContain('HomeAgentComposer');
    expect(hero).toContain('{composing ? (');
    expect(hero).toContain('Turn ZCC into');
    expect(hero).not.toContain('onFocusCapture');
    expect(marketplace).toContain('Back to Browse');
    expect(marketplace).toContain('setHeroRequest(null)');
    expect(marketplace).toContain('ext-install-split');
    expect(marketplace).toContain('BrowseArchetypeCards');
    expect(marketplace).not.toContain('onCreate');
    expect(css).toContain('.ext-browse-archetypes {\n  display: grid;');
  });

  it('surfaces plugin enable/disable failures instead of swallowing them', () => {
    expect(hub).toContain('reportPluginEnabledFailure');
    expect(hub).toContain('setHubRowEnabled');
    expect(hub).not.toContain('.catch(() => {}).finally(() => setPending(null))');
  });

  it('surfaces folder/npm/archive install failures instead of swallowing them', () => {
    expect(hub).toContain('reportHubInstallFailure');
    expect(marketplace).toContain('reportHubInstallFailure');
    expect(hub).not.toContain("install({ kind: 'localDir' }).catch(() => {})");
    expect(marketplace).not.toContain("install({ kind: 'localDir' }).catch(() => {})");
    expect(marketplace).not.toContain("install({ kind: 'localArchive' }).catch(() => {})");
    expect(marketplace).not.toContain("install({ kind: 'npm', spec }).catch(() => {})");
  });

  it('does not stuff not-running into the 36px enable switch', () => {
    expect(hub).toContain('notRunning && !runtime');
    expect(hub).toContain('data-testid={`plugin-not-running-${row.module.id}`}');
    const switchBlock = hub.slice(hub.indexOf('className="ext-installed-switch"'));
    expect(switchBlock.startsWith('className="ext-installed-switch"')).toBe(true);
    expect(switchBlock.slice(0, 400)).not.toContain('plugin-not-running');
  });

  it('renders plugin health as a wrapping callout instead of a hint dump', () => {
    expect(hub).toContain('ext-plugin-health');
    expect(hub).toContain('ext-plugin-health-summary');
    expect(hub).toContain('ext-plugin-health-detail');
    expect(css).toContain('.ext-plugin-health-detail {\n  margin: 8px 0 0;');
    expect(css).toContain('overflow-wrap: anywhere;');
  });

  it('opens plugin details from a card button, independently of footer actions', () => {
    expect(hub).toContain('className="ext-installed-row-open" onClick={onOpen}');
    expect(hub).toContain('className="ext-installed-row-toggle"');
    expect(hub).not.toContain('className="ext-installed-row-chevron"');
  });

  it('keeps Details as a borderless grid and boxes Release rows', () => {
    expect(css).toContain(
      '.ext-plugin-section--config:not(:has(.ext-plugin-settings-panel, .plugin-settings-sections)) {\n  display: none;'
    );
    expect(css).toContain(
      '.ext-plugin-meta-grid > div {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;'
    );
    expect(css).not.toContain(
      '.ext-plugin-meta-grid > div {\n  display: grid;\n  grid-template-columns: minmax(7rem, 11rem)'
    );
    expect(css).toContain(
      '.ext-plugin-table {\n  display: flex;\n  flex-direction: column;\n  margin: 0;\n  overflow: hidden;\n  border: 1px solid var(--border);'
    );
    expect(css).toContain('.ext-plugin-table > div:first-child {\n  border-top: 0;');
    expect(css).toContain('.ext-plugin-detail-stack > .ext-plugin-section {\n  margin: 0;\n  padding: 24px 0;\n  border-top: 1px solid var(--border);');
  });
});
