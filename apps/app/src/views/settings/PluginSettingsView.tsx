import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import type { PluginSettingsSnapshot } from '@zana-ai/zcc-domain/product';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { getHost } from '@/modules/ModulePanelHost';
import { PluginSettingsForm } from '@/plugins/PluginDefinedSettings';
import { PluginSettingsSections } from '@/plugins/PluginSettingsSections';
import { PluginLoadFailure } from '@/plugins/PluginLoadFailure';
import { usePluginSettingsIndex } from '@/plugins/plugin-settings-index';
import { retryInstalledPlugins } from '@/plugins/installed-plugin-store';
import { revealPluginSetting } from '@/plugins/reveal-plugin-setting';
import { product } from '@/lib/product-client';
import { decodeRouteParam, getPluginDetailRoutePath } from '@/lib/route-paths';
import { hostSettingsPanelOf, rowEnabled, shouldMountHostSettings, type HubRow } from '../extensions/installed-plugins';
import './settings.css';
import './plugin-settings.css';

/** One selected plugin owns its settings snapshot and mounted contributions. */
export function PluginSettingsView() {
  const id = decodeRouteParam(useParams().pluginId ?? '');
  const index = usePluginSettingsIndex();
  const row = index.rows.find(item => item.module.id === id);
  return <div className="settings-panel settings-panel--preferences settings-panel--plugin" aria-label="Plugin settings">
    <div className="settings-inner settings-inner--plugin">
      {!row ? <>
        <header className="settings-header"><h1>Plugin settings</h1></header>
        <p role="status">{index.loading ? 'Loading plugin…' : index.error || 'This plugin is no longer installed.'}</p>
        {index.error ? <button type="button" className="settings-btn" onClick={retryInstalledPlugins}>Try again</button> : null}
        <Link to="/extensions/plugins" className="settings-btn">Manage plugins</Link>
      </> : <PluginSettingsPage key={id} row={row} hasCustomSections={index.sections.some(section => section.pluginId === id)}
        customTitle={index.sections.filter(section => section.pluginId === id).length === 1 ? index.sections.find(section => section.pluginId === id)?.title : undefined} />}
    </div>
  </div>;
}

function PluginSettingsPage({ row, hasCustomSections, customTitle }: { row: HubRow; hasCustomSections: boolean; customTitle?: string }) {
  const { module, plugin, entry } = row;
  const location = useLocation();
  const requestedArea = new URLSearchParams(location.search).get('area');
  const field = new URLSearchParams(location.search).get('setting');
  const [area, setArea] = useState(requestedArea === 'configuration' || field ? 'configuration' : 'plugin');
  const [snap, setSnap] = useState<PluginSettingsSnapshot | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const version = useRef(0);
  const enabled = rowEnabled(row) && !entry?.needsConsent;
  const SettingsPanel = hostSettingsPanelOf(row);
  const hasCustom = hasCustomSections || !!SettingsPanel;
  const hasConfiguration = !!snap && Object.keys(snap.descriptors).length > 0;
  const activeArea = hasCustom && (!hasConfiguration || area === 'plugin') ? 'plugin' : 'configuration';

  useEffect(() => {
    setArea(requestedArea === 'configuration' || field ? 'configuration' : 'plugin');
  }, [requestedArea, field, location.key]);
  useEffect(() => {
    let current = true;
    version.current++;
    setSnap(null); setError('');
    if (!enabled || !plugin) return;
    void product.pluginApps.getSettings(module.id).then(next => { if (current) setSnap(next); })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : 'Could not load plugin settings.'); });
    return () => { current = false; };
  }, [module.id, enabled, plugin?.id, plugin?.appUrl, plugin?.status, retry]);
  useEffect(() => {
    if (!enabled || activeArea !== 'configuration') return;
    if (location.hash === '#plugin-configure') document.getElementById('plugin-configure')?.focus({ preventScroll: true });
    if (field) return revealPluginSetting(field);
  }, [enabled, activeArea, field, location.key, hasConfiguration]);

  const unavailable = plugin?.status === 'degraded';
  return <>
    <header className="settings-header">
      <div className="settings-header-title"><span className="settings-header-desc">Plugins</span><h1>{module.title}</h1>
        {plugin?.description ? <span className="settings-header-desc">{plugin.description}</span> : null}</div>
      <Link className="settings-btn" to={getPluginDetailRoutePath(module.id, { view: 'installed' })}>Plugin details</Link>
    </header>
    {!enabled ? <p role="status">{entry?.needsConsent ? 'Review this plugin before opening its settings.' : 'This plugin is disabled. Enable it from Plugin details to configure it.'}</p> : <>
      {plugin?.statusDetail ? <p className="settings-help" role="status">{plugin.statusDetail}</p> : null}
      {module.loadError && plugin ? <PluginLoadFailure pluginId={module.id} name={module.title} detail={module.loadError} /> : null}
      {error ? <div role="alert"><p>{error}</p><button className="settings-btn" type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : null}
      {plugin && !snap && !error ? <p role="status">Loading configuration…</p> : null}
      {hasConfiguration && hasCustom ? <nav className="ext-plugin-settings-areas" aria-label="Plugin settings areas">
        <button type="button" aria-pressed={activeArea === 'plugin'} onClick={() => setArea('plugin')}>{customTitle || 'Plugin settings'}</button>
        <button type="button" aria-pressed={activeArea === 'configuration'} onClick={() => setArea('configuration')}>Configuration</button>
      </nav> : null}
      {hasConfiguration ? <section className="ext-plugin-section ext-plugin-section--config" id="plugin-configure" tabIndex={-1} hidden={activeArea !== 'configuration'}>
        <h3>Configuration</h3>
        <PluginSettingsForm snap={snap!} onSave={async (key, value) => {
          const savedVersion = version.current;
          const next = await product.pluginApps.setSettings(module.id, { [key]: value });
          if (savedVersion === version.current) setSnap(next);
        }} />
      </section> : null}
      <div hidden={activeArea !== 'plugin'}>
        <PluginSettingsSections pluginId={module.id} />
        {!hasCustomSections && SettingsPanel && !module.loadError ? shouldMountHostSettings(row) ?
          <ErrorBoundary key={module.id}><SettingsPanel host={getHost(module.id)} /></ErrorBoundary> :
          <p role="status">This extension’s main process is not running, so its settings cannot load. Open Plugin details to review its status.</p> : null}
      </div>
      {!hasCustom && !hasConfiguration && (!plugin || snap) && !error ? <p role="status">{unavailable ? 'Plugin settings are unavailable while its runtime is not running. Open Plugin details to recover it.' : 'This plugin does not expose any settings.'}</p> : null}
    </>}
  </>;
}
