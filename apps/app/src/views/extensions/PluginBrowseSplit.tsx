import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { PluginDetailPage } from './PluginDetailPage.js';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { appNavigate } from '../../lib/app-navigate.js';
import { getPluginBrowseRoutePath, getPluginDetailRoutePath } from '../../lib/route-paths.js';
import { CatalogPluginDetail } from './CatalogPluginDetail.js';
import { Marketplace, PluginInstallConfirm } from './MarketplaceView.js';

export function PluginBrowseSplit({
  pluginId,
  toolbarExtra
}: {
  pluginId: string | null;
  toolbarExtra?: ReactNode;
}) {
  const [entries, setEntries] = useState<MarketplaceEntry[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [pending, setPending] = useState<MarketplaceEntry | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [error, setError] = useState<Record<string, string>>({});

  const refresh = useCallback(() => {
    product.extensions
      .marketplaceList()
      .then((res) => {
        if (res.ok) { setEntries(res.value); setCatalogError(null); }
        else setCatalogError(res.message);
      })
      .catch((error) => setCatalogError(error instanceof Error ? error.message : 'Could not load plugin details'));
  }, []);

  useEffect(() => {
    refresh();
    const off = product.extensions.onChanged(() => refresh());
    return () => off();
  }, [refresh]);

  const entry = pluginId ? ((entries ?? []).find((row) => row.id === pluginId) ?? null) : null;

  const close = () => {
    appNavigate(getPluginBrowseRoutePath());
  };

  const install = (target: MarketplaceEntry) => {
    setBusy((current) => ({ ...current, [target.id]: target.hasUpdate ? 'Updating…' : 'Installing…' }));
    setError((current) => ({ ...current, [target.id]: '' }));
    const source =
      target.source === 'bundled'
        ? ({ kind: 'bundled', id: target.id } as const)
        : ({ kind: 'marketplace', id: target.id } as const);
    product.extensions
      .install(source)
      .then((res) => {
        if (!res.ok) {
          setError((current) => ({ ...current, [target.id]: res.message }));
          return;
        }
        appNavigate(getPluginDetailRoutePath(target.id, { view: 'installed' }));
      })
      .catch((err) => setError((current) => ({ ...current, [target.id]: err instanceof Error ? err.message : String(err) })))
      .finally(() => setBusy((current) => { const next = { ...current }; delete next[target.id]; return next; }));
  };

  return (
    <div className="ext-plugin-workbench" data-testid="plugin-browse-split">
      <div className="ext-plugin-collection-main" hidden={!!pluginId}>
        <Marketplace toolbarExtra={toolbarExtra} />
      </div>
      {pluginId ? <PluginDetailPage key={pluginId} label="Marketplace plugin" onBack={close}>
        <div data-testid="plugin-browse-side-panel">
          {entry ? <CatalogPluginDetail
            entry={entry} catalog={entries ?? []} busy={busy[entry.id]} error={error[entry.id]}
            onInstall={(next) => setPending(next)}
            onManage={() => appNavigate(getPluginDetailRoutePath(entry.id, { view: 'installed' }))}
            onOpenPlugin={(next) => appNavigate(getPluginDetailRoutePath(next.id))}
            onOpenAuthor={(author) => appNavigate(`${getPluginBrowseRoutePath()}?author=${encodeURIComponent(author)}`)}
          /> : catalogError ? <p role="alert" className="modal-error">{catalogError}</p>
            : <p role="status" className="settings-help settings-help--muted">{entries === null ? 'Loading plugin details…' : 'Plugin not found.'}</p>}
        </div>
      </PluginDetailPage> : null}
      {pending ? <PluginInstallConfirm entry={pending} onCancel={() => setPending(null)} onConfirm={() => {
        const target = pending; setPending(null); install(target);
      }} /> : null}
    </div>
  );
}
