import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const view = readFileSync(new URL('./ExtensionsView.tsx', import.meta.url), 'utf8');
const marketplace = readFileSync(new URL('./MarketplaceView.tsx', import.meta.url), 'utf8');
const hub = readFileSync(new URL('./ExtensionsHub.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

describe('ExtensionsView aurora background', () => {
  it('hosts AuroraGrid the same way Home does', () => {
    expect(view).toContain("className=\"settings-panel extensions-panel aurora-host\"");
    expect(view).toContain('<AuroraGrid />');
    expect(view.indexOf('<AuroraGrid />')).toBeLessThan(view.indexOf('className={`settings-inner'));
  });

  it('does not dump plugin settings sections under the plugin list', () => {
    expect(view).not.toContain('PluginSettingsSections');
  });

  it('mounts plugin settings sections on the plugin detail page', () => {
    expect(hub).toContain('PluginSettingsSections');
    expect(hub).toContain('<PluginSettingsSections pluginId={module.id} />');
    expect(hub).toContain('{hasSlotSettings ? null : <PluginDefinedSettings pluginId={module.id} />}');
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
    expect(marketplace).toContain('className="ext-market-list"');
    expect(hub).toContain('className="ext-installed-scroller"');
    expect(hub).toContain('className="ext-installed-panel"');
    expect(css).toContain(
      '.ext-market {\n  display: flex;\n  flex-direction: column;\n  flex: 1;\n  min-height: 0;\n  overflow: hidden;'
    );
    expect(css).toContain(
      '.ext-installed {\n  display: flex;\n  flex-direction: column;\n  gap: 16px;\n  width: 100%;\n  flex: 1;\n  min-height: 0;\n  overflow: hidden;'
    );
  });

  it('attaches the Installed New plugin caret as a split control', () => {
    expect(hub).toContain('ext-install-split');
    expect(hub).toContain('ext-install-split-toggle');
    expect(css).toContain('.ext-install-split {\n  display: inline-flex;\n  align-items: stretch;\n  gap: 0;');
    expect(css).toContain(
      '.ext-install-split > .settings-btn.ext-install-split-toggle {\n  border-radius: 0 8px 8px 0;'
    );
    expect(css).toContain('.ext-install-split > .settings-btn:first-of-type {\n  border-radius: 8px 0 0 8px;');
  });

  it('surfaces plugin enable/disable failures instead of swallowing them', () => {
    expect(hub).toContain('reportPluginEnabledFailure');
    expect(hub).toContain('setHubRowEnabled');
    expect(hub).not.toContain('.catch(() => {}).finally(() => setPending(null))');
  });

  it('opens plugin details from the trailing chevron as well as the row', () => {
    expect(hub).toContain('className="ext-installed-row-chevron"');
    expect(hub).toContain('onClick={onOpen}');
    const chevron = hub.slice(hub.indexOf('ext-installed-row-chevron'));
    expect(chevron.startsWith('ext-installed-row-chevron"\n          onClick={onOpen}')).toBe(true);
  });
});
