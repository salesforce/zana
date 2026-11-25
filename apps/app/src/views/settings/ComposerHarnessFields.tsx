import { useEffect, useSyncExternalStore } from 'react';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { threadModelCatalogForHost } from '@/components/thread/pickers/thread-model-catalog';
import { useHosts, primaryHost } from '@/hooks/useHosts';
import { useRegisteredThreadProviders } from '@/hooks/useRegisteredThreadProviders';
import { ThreadProviderDefaultField } from './ThreadProviderDefaultField';
import { HarnessModelPreferences } from './HarnessModelPreferences';

export function ComposerHarnessFields({ value, onChange }: {
  value: AppConfig['defaultThreadProviderId'];
  onChange: (id: string | null) => Promise<void>;
}) {
  const registry = useRegisteredThreadProviders();
  const primary = primaryHost(useHosts());
  const hostId = primary?.status === 'connected' ? primary.id : undefined;
  const catalog = threadModelCatalogForHost(hostId);
  const snapshot = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot, catalog.getSnapshot);
  const provider = registry.providers.find(row => row.id === value);
  const availableId = provider?.available === false ? undefined : provider?.id;
  useEffect(() => { if (hostId && availableId) void catalog.ensureProvider(availableId); }, [catalog, hostId, availableId]);
  const entry = value ? snapshot.byProvider[value] : undefined;
  const pending = Boolean(value && snapshot.inflight.has(value));
  const ready = Boolean(hostId && availableId && !snapshot.rosterError && !entry?.modelLoadError && !snapshot.provisionalProviders.has(availableId));
  return <>
    <ThreadProviderDefaultField value={value} providers={registry.providers} loading={registry.loading}
      searchId="composer.thread-harness" help="Used for new threads unless a project chooses another harness." onChange={onChange} />
    {registry.error && <p role="alert" className="settings-help">{registry.error}</p>}
    {availableId && (ready && entry && (entry.models.length > 0 || entry.selectedOnlyModels?.length > 0) ? <HarnessModelPreferences key={availableId} providerId={availableId} models={entry.models} moreModels={entry.selectedOnlyModels} />
      : <p className="settings-help" role="status">{!hostId ? 'Connect the machine to view its models.' : pending ? 'Loading models…'
          : entry?.modelLoadErrorDetail || snapshot.rosterError || 'Models are unavailable.'}
          {hostId && !pending && <button type="button" className="settings-btn" onClick={() => { void catalog.refresh(availableId); }}>Reload models</button>}
        </p>)}
  </>;
}
