import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ExternalLink, Plus, RefreshCw, Search } from 'lucide-react';
import type { AppConfig, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import { harnessFamilyForThreadProviderId } from '@zana-ai/zcc-domain/launch-provider';
import { ProviderIcon } from '../../components/thread/pickers/ProviderIcon.js';
import { threadModelCatalogForHost } from '../../components/thread/pickers/thread-model-catalog.js';
import { useRegisteredThreadProviders } from '../../hooks/useRegisteredThreadProviders.js';
import { getPluginBrowseRoutePath, getPluginDetailRoutePath } from '../../lib/route-paths.js';
import { HARNESS_ENABLE_KEY } from '../../lib/settings-search/providers/harness.js';
import { Section } from '../../components/settings/FormFields.js';
import { registeredHarnessStatus } from './registered-harness-status.js';
import { ProviderAuthentication } from './ProviderAuthentication.js';
import { ThreadProviderDefaultField } from './ThreadProviderDefaultField.js';
import './registered-harnesses.css';

export function RegisteredHarnesses({ config, status, hostId, hostName, onUpdate, onRefreshStatus, checkingStatus, cliDefault }: {
  cliDefault?: ReactNode;
  config: AppConfig;
  status: HarnessVerifyResult[];
  hostId?: string;
  hostName?: string;
  onUpdate: (patch: Partial<AppConfig>, options?: { throwOnError?: boolean }) => Promise<void>;
  onRefreshStatus: () => void;
  checkingStatus: boolean;
}) {
  const inventory = useRegisteredThreadProviders();
  const catalog = threadModelCatalogForHost(hostId);
  const models = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot, catalog.getSnapshot);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modelLimit, setModelLimit] = useState(50);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const selected = config.defaultThreadProviderId;
  const search = query.trim().toLocaleLowerCase();
  const providers = [...inventory.providers].sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
  const visible = providers.filter((row) => `${row.displayName} ${row.pluginId}`.toLocaleLowerCase().includes(search));

  useEffect(() => { if (hostId) void catalog.ensure(); }, [hostId, catalog]);

  return (
    <>
    <Section title="Defaults" searchId="harness.defaults" anchorId="harness-defaults" help="Choose separate harnesses for new threads and CLI agents. Projects can override either default.">
      <ThreadProviderDefaultField value={selected} providers={providers} loading={inventory.loading}
        searchId="harness.default-thread-provider" help="Used for new threads. Existing threads and unsent drafts keep their harness."
        onChange={async defaultThreadProviderId => onUpdate({ defaultThreadProviderId }, { throwOnError: true })} />
      {cliDefault}
    </Section>
    <Section searchId="harness.registered" anchorId="harness-registered" title="Your AI harnesses" flush help="Provided by your installed plugins. Choose a harness in the composer, or set your thread default.">
      <div className="registered-harness-toolbar">
        <span>{hostName ?? 'No connected machine'} · {inventory.providers.length} registered</span>
        <div>
          <button type="button" className="settings-btn" disabled={inventory.loading || checkingStatus || models.inflight.size > 0} onClick={() => {
            inventory.refresh();
            onRefreshStatus();
            if (hostId) void catalog.reload();
          }}><RefreshCw size={13} aria-hidden /> Refresh harnesses</button>
          <Link className="settings-btn" to={getPluginBrowseRoutePath()}><Plus size={13} aria-hidden /> Add harness</Link>
        </div>
      </div>
      <label className="registered-harness-search"><Search size={14} aria-hidden /><input type="search" aria-label="Search installed harnesses" placeholder="Search harnesses or plugins…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {inventory.error ? <p className="settings-help" role="alert">{inventory.error}</p> : null}
      {saveError ? <p className="settings-help" role="alert">{saveError}</p> : null}
      <ul className="registered-harness-list" data-testid="registered-harness-list" aria-busy={inventory.loading}>
        {visible.map((provider) => {
          const plugin = inventory.plugins.find((row) => row.id === provider.pluginId);
          const family = harnessFamilyForThreadProviderId(provider.id);
          const probe = status.find((row) => row.family === family);
          const entry = models.byProvider[provider.id];
          const state = registeredHarnessStatus({ ...provider, connected: Boolean(hostId), installed: probe?.installed, checking: models.inflight.has(provider.id), rosterError: models.rosterError, provisional: models.provisionalProviders.has(provider.id), entry });
          const enableKey = family ? HARNESS_ENABLE_KEY[family] : undefined;
          const enabled = !enableKey || ((config[enableKey] as boolean | undefined) ?? probe?.enabled ?? true);
          const isDefault = provider.id === selected;
          const canDefault = state.tone === 'ok';
          const pluginPath = getPluginDetailRoutePath(provider.pluginId, { view: 'installed' });
          return <li className="registered-harness" key={provider.id} data-provider-id={provider.id}>
            <div className="registered-harness-main">
              <span className="registered-harness-icon" aria-hidden><ProviderIcon providerId={provider.id} size={26} /></span>
              <div className="registered-harness-copy">
                <div className="registered-harness-title"><h4>{provider.displayName}</h4>{isDefault ? <span className="registered-harness-default">Thread default</span> : null}{!enabled ? <span className="registered-harness-tag">CLI disabled</span> : null}</div>
                <div className="registered-harness-source"><Link to={pluginPath}>From {plugin?.name ?? provider.pluginId}<ExternalLink size={10} aria-hidden /></Link>{probe?.version ? <span>Agent {probe.version}</span> : null}</div>
                <p className={`registered-harness-state registered-harness-state--${state.tone}`}><span aria-hidden>●</span> {state.label}</p>
              </div>
              <div className="registered-harness-actions">
                <button type="button" className="settings-btn" aria-label={`Browse ${provider.displayName} models`} aria-expanded={expanded === provider.id} onClick={() => {
                  setExpanded(expanded === provider.id ? null : provider.id);
                  setModelLimit(50);
                  if (hostId && !entry) void catalog.ensureProvider(provider.id);
                }}>Models <ChevronDown size={12} aria-hidden /></button>
                {state.tone === 'warn' ? <Link className="settings-btn" to={pluginPath}>Set up</Link> : <button type="button" className="settings-btn" disabled={saving || isDefault || !canDefault} onClick={async () => {
                  setSaving(true); setSaveError(null);
                  try { await onUpdate({ defaultThreadProviderId: provider.id }, { throwOnError: true }); }
                  catch { setSaveError(`Could not save ${provider.displayName} as the default. Try again.`); }
                  finally { setSaving(false); }
                }}>{isDefault ? 'Default' : 'Set as thread default'}</button>}
              </div>
            </div>
            <ProviderAuthentication key={`${hostId}:${provider.id}`} providerId={provider.id} name={provider.displayName} hostId={hostId} hostName={hostName} onReady={() => { void catalog.refresh(provider.id); }} />
            {expanded === provider.id ? <div className="registered-harness-models">
              <div className="registered-harness-model-heading"><strong>{provider.displayName} models</strong><button type="button" className="settings-btn" disabled={!hostId || models.inflight.has(provider.id)} onClick={() => { void catalog.refresh(provider.id); }}>Reload models</button></div>
              {entry?.modelLoadErrorDetail ? <p className="settings-help" role="status">{entry.modelLoadErrorDetail}</p> : null}
              {entry?.models.length ? <ul>{entry.models.slice(0, modelLimit).map((model) => <li key={model.id}><span>{model.displayName}</span><code>{model.model}</code>{model.isDefault ? <span className="registered-harness-tag">Provider default</span> : null}</li>)}</ul> : <p className="settings-help">{state.label}</p>}
              {entry && entry.models.length > modelLimit ? <button className="settings-btn" type="button" onClick={() => setModelLimit((value) => value + 50)}>Show more models ({modelLimit} of {entry.models.length})</button> : null}
            </div> : null}
          </li>;
        })}
        {!visible.length ? <li className="registered-harness-empty">{inventory.loading ? 'Loading registered harnesses…' : search ? 'No harnesses match your search.' : inventory.error ? 'Harness registration could not be loaded. Try refreshing.' : 'No provider plugins registered. Add a provider from Plugins to get started.'}</li> : null}
      </ul>
      <p className="registered-harness-footnote">The thread default applies to new threads without a project override or draft choice. Choosing a harness for one thread does not change the default. Models are chosen in the composer.</p>
    </Section>
    </>
  );
}
