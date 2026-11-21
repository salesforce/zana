import { useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ExternalLink, Plus, RefreshCw, Search } from 'lucide-react';
import type { AppConfig, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import { THREAD_PROVIDER_ID_BY_HARNESS_FAMILY } from '@zana-ai/zcc-domain/launch-provider';
import { ProviderIcon } from '../../components/thread/pickers/ProviderIcon.js';
import { threadModelCatalogForHost, type ThreadModelCatalogSnapshot } from '../../components/thread/pickers/thread-model-catalog.js';
import { useRegisteredThreadProviders, type RegisteredThreadProvider } from '../../hooks/useRegisteredThreadProviders.js';
import { getPluginBrowseRoutePath, getPluginDetailRoutePath } from '../../lib/route-paths.js';
import { HARNESS_ENABLE_KEY, rememberHarnessProviders, harnessRowPrefix, threadProviderSearchId } from '../../lib/settings-search/providers/harness.js';
import { Section } from '../../components/settings/FormFields.js';
import { registeredHarnessStatus } from './registered-harness-status.js';
import { ProviderAuthentication } from './ProviderAuthentication.js';
import { HarnessModelPreferences } from './HarnessModelPreferences.js';
import { ThreadProviderDefaultField } from './ThreadProviderDefaultField.js';
import { RevealContext } from '../../lib/settings-search/reveal.js';
import { sortHarnessDisplayRows } from '../../lib/harness-display-order.js';
import { HarnessModels } from './HarnessModels.js';

import { HarnessInstallationBadge } from './HarnessInstallationBadge.js';
import { PrecedenceStrip } from '../../components/PrecedenceStrip.js';
import './registered-harnesses.css';

type HarnessEntry = {
  id: string;
  displayName: string;
  threads: boolean;
  registration?: RegisteredThreadProvider;
  cli?: HarnessVerifyResult;
};

function groupHarnesses(registrations: readonly RegisteredThreadProvider[], roster: readonly { id: string; displayName: string }[], status: HarnessVerifyResult[]) {
  const rows = new Map<string, HarnessEntry>();
  for (const cli of status) {
    const id = THREAD_PROVIDER_ID_BY_HARNESS_FAMILY[cli.family];
    rows.set(id, { id, displayName: cli.label, cli, threads: false });
  }
  for (const { id, displayName } of roster) {
    rows.set(id, { ...rows.get(id), id, displayName, threads: true });
  }
  for (const registration of registrations) {
    const { id, displayName } = registration;
    rows.set(id, { ...rows.get(id), id, displayName, threads: true, registration });
  }
  return sortHarnessDisplayRows([...rows.values()], row => row.displayName, row => row.id);
}

export function RegisteredHarnesses({ config, status, hostId, hostName, onUpdate, onRefreshStatus, checkingStatus, cliDefault, machineSummary, machineActions, machinesLink, renderCliSettings }: {
  cliDefault?: ReactNode;
  machineSummary?: string;
  machineActions?: ReactNode;
  machinesLink?: ReactNode;
  renderCliSettings?: (probe: HarnessVerifyResult, catalog: ThreadModelCatalogSnapshot) => ReactNode;
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
  const { target } = useContext(RevealContext);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const selected = config.defaultThreadProviderId;
  const search = query.trim().toLocaleLowerCase();
  const rows = useMemo(() => groupHarnesses(inventory.providers, models.providers ?? [], status), [inventory.providers, models.providers, status]);
  const visible = rows.filter(row => [row.displayName, row.id, row.registration?.pluginId].some(value => value?.toLocaleLowerCase().includes(search)));

  useEffect(() => {
    if (!target) return;
    const match = rows.find(row => target === threadProviderSearchId(row.id) || (row.cli && target.startsWith(harnessRowPrefix(row.cli.family))));
    if (match) { setQuery(''); setExpanded(match.id); }
  }, [target, rows]);
  useEffect(() => {
    if (hostId && expanded && !models.byProvider[expanded] && rows.some(row => row.id === expanded && row.threads)) void catalog.ensureProvider(expanded);
  }, [expanded, hostId, catalog, rows, models.byProvider]);
  useEffect(() => { rememberHarnessProviders(inventory.providers); }, [inventory.providers]);
  useEffect(() => { if (hostId) void catalog.ensure(); }, [hostId, catalog]);

  return (
    <>
    <Section searchId="harness.registered" anchorId="harness-registered" title="Your AI harnesses" flush help="Manage installation, sign-in, models, and launch settings for each harness.">
      {/* Bookmarks from the former installation and session sections land on this inventory. */}
      {['harness-status', 'harness-session', 'harness-thread', 'harness-legacy'].map(anchor =>
        <span key={anchor} id={`settings-anchor-${anchor}`} aria-hidden />)}
      <div className="registered-harness-toolbar">
        <span>{hostId ? hostName ?? 'This machine' : 'No connected machine'}{hostId && machineSummary && <> · {machineSummary}</>}</span>
        <div>
          {machineActions}
          <button type="button" className="settings-btn" disabled={inventory.loading || checkingStatus} onClick={() => {
            inventory.refresh();
            onRefreshStatus();
            if (hostId) void catalog.reload();
          }}><RefreshCw size={13} aria-hidden /> {checkingStatus ? 'Checking…' : 'Check status'}</button>
          <Link className="settings-btn" to={getPluginBrowseRoutePath()}><Plus size={13} aria-hidden /> Add harness</Link>
        </div>
      </div>
      <label className="registered-harness-search"><Search size={14} aria-hidden /><input type="search" aria-label="Search harnesses" placeholder="Search harnesses or plugins…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {inventory.error ? <p className="settings-help" role="alert">{inventory.error}</p> : null}
      {saveError ? <p className="settings-help" role="alert">{saveError}</p> : null}
      <ul className="registered-harness-list" data-testid="registered-harness-list" aria-busy={inventory.loading}>
        {visible.map((provider) => {
          const { cli: probe, registration } = provider;
          const pluginId = registration?.pluginId;
          const plugin = inventory.plugins.find(row => row.id === pluginId);
          const family = probe?.family;
          const entry = models.byProvider[provider.id];
          const state = registeredHarnessStatus({ providerId: provider.id, ...registration, connected: Boolean(hostId), installed: probe?.installed, checking: models.inflight.has(provider.id), rosterError: models.rosterError, provisional: models.provisionalProviders.has(provider.id), entry });
          const enableKey = family ? HARNESS_ENABLE_KEY[family] : undefined;
          const enabled = !enableKey || ((config[enableKey] as boolean | undefined) ?? probe?.enabled ?? true);
          const isDefault = provider.id === selected;
          const canDefault = !!registration && state.tone === 'ok';
          const pluginPath = pluginId && getPluginDetailRoutePath(pluginId, { view: 'installed' });
          return <li className="registered-harness" key={provider.id} data-provider-id={provider.threads ? provider.id : undefined}
            data-harness-family={family} id={family ? `settings-anchor-harness-${family}` : undefined}
            data-settings-target={family ? `${harnessRowPrefix(family)}row` : undefined}>
            <div className="registered-harness-main" data-settings-target={provider.threads ? threadProviderSearchId(provider.id) : undefined}>
              <span className="registered-harness-icon" aria-hidden><ProviderIcon providerId={provider.id} size={26} /></span>
              <div className="registered-harness-copy">
                <div className="registered-harness-title"><h4>{provider.displayName}</h4>{isDefault ? <span className="registered-harness-default">Thread default</span> : null}{!enabled ? <span className="registered-harness-tag">CLI disabled</span> : null}</div>
                <div className="registered-harness-source">
                  {probe && <HarnessInstallationBadge h={probe} enabled={enabled} />}
                  {pluginPath && <Link to={pluginPath}>From {plugin?.name ?? pluginId}<ExternalLink size={10} aria-hidden /></Link>}
                </div>
                {provider.threads && <p className={`registered-harness-state registered-harness-state--${state.tone}`}><span aria-hidden>●</span> {state.label}</p>}
              </div>
              <div className="registered-harness-actions">
                <button type="button" className="settings-btn" aria-label={`Configure ${provider.displayName}`} aria-expanded={expanded === provider.id} onClick={() => {
                  setExpanded(expanded === provider.id ? null : provider.id);
                }}>{expanded === provider.id ? 'Close' : 'Configure'} <ChevronDown size={14} aria-hidden /></button>
              </div>
            </div>
            {provider.threads && <div hidden={expanded !== provider.id}>
              <ProviderAuthentication key={`${hostId}:${provider.id}`} providerId={provider.id} name={provider.displayName} hostId={hostId} hostName={hostName} onReady={() => { void catalog.refresh(provider.id); }} />
            </div>}
            {provider.threads && expanded === provider.id ? <div className="registered-harness-models">
              <div className="registered-harness-preferences">
                {state.tone === 'ok' && entry && <HarnessModelPreferences key={provider.id} providerId={provider.id} models={entry.models} moreModels={entry.selectedOnlyModels} />}
                <div className="registered-harness-default-action">
                {registration && (state.tone === 'warn' && pluginPath ? <Link className="settings-btn" to={pluginPath}>Set up</Link> : <button type="button" className="settings-btn" disabled={saving || isDefault || !canDefault} onClick={async () => {
                  setSaving(true); setSaveError(null);
                  try { await onUpdate({ defaultThreadProviderId: provider.id }, { throwOnError: true }); }
                  catch { setSaveError(`Could not save ${provider.displayName} as the default. Try again.`); }
                  finally { setSaving(false); }
                }}>{isDefault ? 'Default' : 'Set as thread default'}</button>)}
                </div>
              </div>
              <HarnessModels name={provider.displayName} entry={entry} status={state.label}
                canReload={Boolean(hostId) && !models.inflight.has(provider.id)} onReload={() => { void catalog.refresh(provider.id); }} />
            </div> : null}
            {expanded === provider.id && probe && renderCliSettings?.(probe, models)}
          </li>;
        })}
        {!visible.length ? <li className="registered-harness-empty">{inventory.loading ? 'Loading registered harnesses…' : search ? 'No harnesses match your search.' : inventory.error ? 'Harness registration could not be loaded. Try refreshing.' : 'No provider plugins registered. Add a provider from Plugins to get started.'}</li> : null}
      </ul>
      {machinesLink && <div className="harness-setup-footer">{machinesLink}</div>}
    </Section>
    <Section title="Defaults" searchId="harness.defaults" anchorId="harness-defaults" help="Choose separate harnesses for new threads and CLI agents. Projects can override either default.">
      <ThreadProviderDefaultField value={selected} providers={inventory.providers} loading={inventory.loading}
        searchId="harness.default-thread-provider" help="Used for new threads. Existing threads and unsent drafts keep their harness."
        onChange={async defaultThreadProviderId => onUpdate({ defaultThreadProviderId }, { throwOnError: true })} />
      {cliDefault}
      <PrecedenceStrip settingKey="harness.target" />
    </Section>
    </>
  );
}
