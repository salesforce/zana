import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { appNavigate } from '../../lib/app-navigate.js';
import { resolveIcon } from '../../lib/resolveIcon.js';
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
  const [entries, setEntries] = useState<MarketplaceEntry[]>([]);
  const [pending, setPending] = useState<MarketplaceEntry | null>(null);
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 840px)');
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const refresh = useCallback(() => {
    product.extensions
      .marketplaceList()
      .then((res) => {
        if (res.ok) setEntries(res.value);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const off = product.extensions.onChanged(() => refresh());
    return () => off();
  }, [refresh]);

  const entry = pluginId ? (entries.find((row) => row.id === pluginId) ?? null) : null;
  const panelOpen = pluginId != null;
  const hideBrowse = narrow && panelOpen;
  const Icon = resolveIcon(entry?.icon ?? 'Package');

  const close = () => {
    appNavigate(getPluginBrowseRoutePath());
  };

  const install = (target: MarketplaceEntry) => {
    setBusy(target.hasUpdate ? 'Updating…' : 'Installing…');
    setError(undefined);
    const source =
      target.source === 'bundled'
        ? ({ kind: 'bundled', id: target.id } as const)
        : ({ kind: 'marketplace', id: target.id } as const);
    product.extensions
      .install(source)
      .then((res) => {
        if (!res.ok) {
          setError(res.message);
          return;
        }
        appNavigate(getPluginDetailRoutePath(target.id, { view: 'installed' }));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(undefined));
  };

  return (
    <div
      className={`ext-browse-split${panelOpen ? ' is-open' : ''}${hideBrowse ? ' is-narrow-detail' : ''}`}
      data-testid="plugin-browse-split"
    >
      {hideBrowse ? null : (
        <div className="ext-browse-split-main">
          <Marketplace toolbarExtra={toolbarExtra} />
        </div>
      )}
      {panelOpen ? (
        <aside className="ext-browse-split-panel" data-testid="plugin-browse-side-panel">
          <header className="ext-browse-split-chrome">
            {hideBrowse ? (
              <button type="button" className="settings-btn" onClick={close}>
                <ChevronLeft size={14} />
                Back to Browse
              </button>
            ) : (
              <span className="ext-browse-split-tab">
                <Icon size={14} />
                <span>{entry?.title ?? pluginId}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Close plugin details"
                  onClick={close}
                >
                  <X size={14} />
                </button>
              </span>
            )}
          </header>
          <div className="ext-browse-split-body">
            {entry ? (
              <CatalogPluginDetail
                entry={entry}
                catalog={entries}
                busy={busy}
                error={error}
                onInstall={(next) => setPending(next)}
                onOpenPlugin={(next) => appNavigate(getPluginDetailRoutePath(next.id))}
                onOpenAuthor={(author) =>
                  appNavigate(`${getPluginBrowseRoutePath()}?author=${encodeURIComponent(author)}`)
                }
              />
            ) : (
              <p className="settings-help settings-help--muted">Plugin not found.</p>
            )}
          </div>
        </aside>
      ) : null}
      {pending ? (
        <PluginInstallConfirm
          entry={pending}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const target = pending;
            setPending(null);
            install(target);
          }}
        />
      ) : null}
    </div>
  );
}
