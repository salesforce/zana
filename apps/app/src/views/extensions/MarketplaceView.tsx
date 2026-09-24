import { product } from '../../lib/product-client.js';
import { DelayedStencilList } from '../../components/ui/Skeleton.js';
/**
 * Plugins → Browse (Marketplace). Lists first-party plugins the app ships
 * (offline) plus configured community catalogs and, when opted in, the signed
 * remote registry.
 *
 * The catalog comes from `product.extensions.marketplaceList()`. Each row is a
 * {@link MarketplaceEntry} already joined with this host's install state
 * (installed / hasUpdate / compatible), so the button label is a pure projection
 * of those flags — no extension id is hard-coded here (Rule #6: we iterate
 * `entry.id` variables; the renderer guard enforces no bare literal).
 *
 * Install/Update routes through `extensions.install({kind:'marketplace', id})`
 * or `{kind:'bundled', id}` for first-party rows. Main owns both trust paths;
 * the renderer only names the source kind + id. A permission-widening remote
 * release comes back as a typed `NEEDS_CONSENT` failure we surface inline.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  RefreshCw,
  Search,
  GitBranch,
  FolderOpen,
  FileArchive,
  ChevronDown,
  Plus,
  Package,
  Trash2,
  ArrowUpAZ,
  ArrowDownAZ
} from 'lucide-react';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import type { MarketplaceCatalogRow } from '@zana-ai/zcc-domain';
import { PERMISSION_LABELS, pluginCapabilityLines } from '@/components/ExtensionConsent';
import { InstallFromGitDialog } from '@/components/InstallFromGitDialog';
import { Modal } from '@/components/Modal';
import { PromptModal } from '@/components/PromptModal';
import {
  BrowseArchetypeCards,
  BrowseHeroCarousel
} from '@/components/plugin/browse-hero/BrowseHeroCarousel';
import { nextComposerRequestNonce } from '@/components/plugin/browse-hero/browse-hero-archetypes';
import { CREATE_PLUGIN_PROMPT } from '@/lib/create-resource-prompts';
import { getPluginDetailRoutePath } from '@/lib/route-paths';
import { filterMarketplaceEntries, type MarketplaceTag } from './marketplace-filter.js';
import { catalogCountLabel, catalogErrorText, catalogKindLabel } from './marketplace-catalogs.js';
import { reportHubInstallFailure } from './hub-install.js';
import { useUi } from '@/store';
import { PluginAuthorPage } from './PluginAuthorPage.js';
import { PluginCatalogCard, PluginCatalogGrid } from './PluginCatalogCard.js';
import {
  pluginBrowseShelves,
  pluginCategoryFilterId,
  pluginCategoryFilterOptions,
  shelfPreviewEntries,
  sortPluginEntries,
  type PluginBrowseShelf,
  type PluginBrowseSort
} from './plugin-browse-discovery.js';

const MARKET_FILTERS: { id: MarketplaceTag | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'official', label: 'Official' },
  { id: 'community', label: 'Community' },
  { id: 'update', label: 'Update' }
];

export function MarketplaceView({
  toolbarExtra
}: {
  toolbarExtra?: ReactNode;
} = {}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const creating = searchParams.get('view') === 'create';
  const authorKeyParam = searchParams.get('author');
  const [prompt, setPrompt] = useState(CREATE_PLUGIN_PROMPT);
  const [composing, setComposing] = useState(creating);
  const [heroRequest, setHeroRequest] = useState<{ nonce: number; seed?: string } | null>(() =>
    creating ? { nonce: nextComposerRequestNonce(), seed: CREATE_PLUGIN_PROMPT } : null
  );
  const [entries, setEntries] = useState<MarketplaceEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [gitOpen, setGitOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<MarketplaceEntry | null>(null);
  const [tag, setTag] = useState<MarketplaceTag | 'all'>('all');
  const [sort, setSort] = useState<PluginBrowseSort>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [expandedShelves, setExpandedShelves] = useState<Set<string>>(() => new Set());
  const [npmOpen, setNpmOpen] = useState(false);
  const [catalogs, setCatalogs] = useState<MarketplaceCatalogRow[] | null>(null);
  const [catalogSource, setCatalogSource] = useState('');
  const [catalogBusy, setCatalogBusy] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [installMenuOpen, setInstallMenuOpen] = useState(false);
  const installMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!installMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (installMenuRef.current && !installMenuRef.current.contains(e.target as Node)) {
        setInstallMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setInstallMenuOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [installMenuOpen]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    product.extensions
      .marketplaceList()
      .then((res) => {
        if (res.ok) setEntries(res.value);
        else {
          setError(res.message);
          setEntries([]);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setEntries([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const refreshCatalogs = useCallback(() => {
    product.marketplaces
      .list()
      .then((rows) => setCatalogs(Array.isArray(rows) ? rows : []))
      .catch(() => setCatalogs([]));
  }, []);

  useEffect(() => {
    refresh();
    refreshCatalogs();
    const offExt = product.extensions.onChanged(() => refresh());
    const offApps = product.pluginApps?.onChanged?.(() => {
      refresh();
      refreshCatalogs();
    }) ?? (() => {});
    // Background git.soma seed can finish after first paint.
    const later = window.setTimeout(() => {
      refresh();
      refreshCatalogs();
    }, 2_000);
    const last = window.setTimeout(() => {
      refresh();
      refreshCatalogs();
    }, 9_000);
    return () => {
      offExt();
      offApps();
      window.clearTimeout(later);
      window.clearTimeout(last);
    };
  }, [refresh, refreshCatalogs]);

  const install = (entry: MarketplaceEntry) => {
    const verb = entry.hasUpdate ? 'Updating…' : 'Installing…';
    setBusy((b) => ({ ...b, [entry.id]: verb }));
    setRowError((e) => {
      const next = { ...e };
      delete next[entry.id];
      return next;
    });
    const source =
      entry.source === 'bundled'
        ? ({ kind: 'bundled', id: entry.id } as const)
        : ({ kind: 'marketplace', id: entry.id } as const);
    product.extensions
      .install(source)
      .then((res) => {
        if (!res.ok) {
          setRowError((e) => ({ ...e, [entry.id]: res.message }));
          return;
        }
        setEntries((current) =>
          (current ?? []).map((row) =>
            row.id === entry.id
              ? { ...row, installed: true, installedVersion: row.installedVersion ?? row.version }
              : row
          )
        );
        refresh();
        navigate(getPluginDetailRoutePath(entry.id, { view: 'installed' }));
      })
      .catch((err) =>
        setRowError((e) => ({
          ...e,
          [entry.id]: err instanceof Error ? err.message : String(err)
        }))
      )
      .finally(() =>
        setBusy((b) => {
          const next = { ...b };
          delete next[entry.id];
          return next;
        })
      );
  };

  const runCatalogAction = async (label: string, work: () => Promise<unknown>) => {
    setCatalogBusy(label);
    setCatalogError(null);
    try {
      await work();
      refreshCatalogs();
      refresh();
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : String(err));
    } finally {
      setCatalogBusy(null);
    }
  };

  const addCatalog = () => {
    const source = catalogSource.trim();
    if (!source) return;
    void runCatalogAction('Adding…', async () => {
      await product.marketplaces.add(source);
      setCatalogSource('');
    });
  };

  const filtered = useMemo(() => {
    if (!entries) return entries;
    return filterMarketplaceEntries(entries, query, tag);
  }, [entries, query, tag]);

  const categoryOptions = useMemo(
    () => pluginCategoryFilterOptions(filtered ?? [], categoryFilters),
    [filtered, categoryFilters]
  );

  const visibleEntries = useMemo(() => {
    if (!filtered) return [];
    if (categoryFilters.length === 0) return filtered;
    const selected = new Set(categoryFilters);
    return filtered.filter((entry) => selected.has(pluginCategoryFilterId(entry)));
  }, [categoryFilters, filtered]);

  const shelves = useMemo(() => pluginBrowseShelves(visibleEntries), [visibleEntries]);
  const showGrid = query.trim().length > 0 || categoryFilters.length > 0 || sort === 'name';
  const gridEntries = useMemo(
    () => (sort === 'name' ? sortPluginEntries(visibleEntries, 'name', sortDir) : visibleEntries),
    [sort, sortDir, visibleEntries]
  );

  const openPlugin = (entry: MarketplaceEntry) => {
    navigate(getPluginDetailRoutePath(entry.id));
  };
  const openAuthor = (author: string) => {
    setSearchParams({ author });
  };
  const startCreate = () => {
    setPrompt(CREATE_PLUGIN_PROMPT);
    setComposing(true);
    setHeroRequest({ nonce: nextComposerRequestNonce(), seed: CREATE_PLUGIN_PROMPT });
    setSearchParams({ view: 'create' });
  };
  const backToBrowse = () => {
    setComposing(false);
    setHeroRequest(null);
    setSearchParams({});
  };
  const onComposingChange = useCallback(
    (next: boolean) => {
      setComposing(next);
      if (next) {
        setSearchParams({ view: 'create' });
        return;
      }
      setHeroRequest(null);
      if (searchParams.get('view') === 'create') setSearchParams({});
    },
    [searchParams, setSearchParams]
  );

  const hasCatalog = !!entries && entries.length > 0;
  const confirmDialog = pendingConfirm ? (
    <PluginInstallConfirm
      entry={pendingConfirm}
      onCancel={() => setPendingConfirm(null)}
      onConfirm={() => {
        const entry = pendingConfirm;
        setPendingConfirm(null);
        install(entry);
      }}
    />
  ) : null;

  const installMenus = (
    <>
      {gitOpen && <InstallFromGitDialog onClose={() => setGitOpen(false)} />}
      {npmOpen && (
        <PromptModal
          title="Install from npm"
          hint="Package name or name@version. Installs through PluginService as npm:spec."
          label="Package"
          placeholder="zcc-plugin-notes"
          confirmLabel="Install"
          onClose={() => setNpmOpen(false)}
          onSubmit={(spec) => {
            setNpmOpen(false);
            product.extensions
              .install({ kind: 'npm', spec })
              .then((res) => reportHubInstallFailure(res, useUi.getState().pushToast))
              .catch((err) =>
                useUi.getState().pushToast(err instanceof Error ? err.message : String(err), 'error')
              );
          }}
        />
      )}
    </>
  );

  const createSplit = (
    <div className="ext-install-menu-wrap ext-install-split" ref={installMenuRef}>
      <button type="button" className="settings-btn primary" onClick={startCreate}>
        <Plus size={14} />
        Create a plugin
      </button>
      <button
        type="button"
        className="settings-btn primary ext-install-split-toggle"
        onClick={() => setInstallMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={installMenuOpen}
        aria-label="Install a plugin"
        title="Install from a local folder, archive, git repository, or npm"
      >
        <ChevronDown size={12} />
      </button>
      {installMenuOpen && (
        <div className="ext-install-menu" role="menu" aria-label="Install from">
          <button
            type="button"
            role="menuitem"
            className="ext-install-menu-item"
            onClick={() => {
              setInstallMenuOpen(false);
              product.extensions
                .install({ kind: 'localDir' })
                .then((res) => reportHubInstallFailure(res, useUi.getState().pushToast))
                .catch((err) =>
                  useUi.getState().pushToast(err instanceof Error ? err.message : String(err), 'error')
                );
            }}
          >
            <FolderOpen size={14} />
            Folder…
          </button>
          <button
            type="button"
            role="menuitem"
            className="ext-install-menu-item"
            onClick={() => {
              setInstallMenuOpen(false);
              product.extensions
                .install({ kind: 'localArchive' })
                .then((res) => reportHubInstallFailure(res, useUi.getState().pushToast))
                .catch((err) =>
                  useUi.getState().pushToast(err instanceof Error ? err.message : String(err), 'error')
                );
            }}
          >
            <FileArchive size={14} />
            Archive…
          </button>
          <button
            type="button"
            role="menuitem"
            className="ext-install-menu-item"
            onClick={() => {
              setInstallMenuOpen(false);
              setGitOpen(true);
            }}
          >
            <GitBranch size={14} />
            Repository…
          </button>
          <button
            type="button"
            role="menuitem"
            className="ext-install-menu-item"
            onClick={() => {
              setInstallMenuOpen(false);
              setNpmOpen(true);
            }}
          >
            <Package size={14} />
            npm package…
          </button>
        </div>
      )}
    </div>
  );

  if (authorKeyParam) {
    return (
      <section className="settings-section ext-market">
        <div className="ext-market-scroller">
          <PluginAuthorPage
            authorKey={authorKeyParam}
            entries={entries ?? []}
            busy={busy}
            errors={rowError}
            onBack={backToBrowse}
            onOpen={openPlugin}
            onInstall={(entry) => setPendingConfirm(entry)}
          />
        </div>
        {installMenus}
        {confirmDialog}
      </section>
    );
  }

  return (
    <section className="settings-section ext-market">
      <div className="ext-market-toolbar">
        <div className="settings-btn-row ext-market-toolbar-actions">
          {createSplit}
          {toolbarExtra}
        </div>
      </div>

      <div className="ext-market-scroller">
        <BrowseHeroCarousel
          composing={composing}
          prompt={prompt}
          onPromptChange={setPrompt}
          onComposingChange={onComposingChange}
          openRequest={heroRequest}
        />

        {composing ? (
          <>
            <button type="button" className="settings-btn ext-browse-back-create" onClick={backToBrowse}>
              Back to Browse
            </button>
            <BrowseArchetypeCards
              onSelect={(next) => {
                setPrompt(next);
                setHeroRequest({ nonce: nextComposerRequestNonce(), seed: next });
              }}
            />
          </>
        ) : (
          <>
            <details className="ext-market-catalogs" data-testid="marketplace-catalogs">
              <summary className="ext-market-catalogs-title">Catalog sources</summary>
              <p className="settings-help">
                Official plugins install offline from the app. Community catalogs are provenance-only —
                refresh never runs plugin code. Add a manifest URL, a bare HTTPS repository URL,{' '}
                <code>git:&lt;url&gt;[@ref]</code>, <code>git@host:owner/repository.git</code>, or{' '}
                <code>path:&lt;dir&gt;</code>.
              </p>
              <div className="ext-market-catalogs-add">
                <input
                  type="text"
                  className="settings-input"
                  value={catalogSource}
                  onChange={(e) => setCatalogSource(e.target.value)}
                  placeholder="https://…/catalog or git@host:owner/catalog.git"
                  aria-label="Marketplace catalog source"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCatalog();
                    }
                  }}
                />
                <button
                  type="button"
                  className="settings-btn primary"
                  disabled={!catalogSource.trim() || catalogBusy !== null}
                  onClick={addCatalog}
                >
                  Add catalog
                </button>
              </div>
              {catalogError && <p className="modal-error">{catalogError}</p>}
              {catalogs && catalogs.length > 0 && (
                <ul className="ext-market-catalog-list">
                  {catalogs.map((row) => {
                    const catalogErr = catalogErrorText(row);
                    return (
                      <li key={row.source} className="ext-market-catalog-row">
                        <div className="ext-market-catalog-body">
                          <div className="ext-market-catalog-head">
                            <span className="ext-market-catalog-name">{row.displayName}</span>
                            <span className="ext-market-item-source">{catalogKindLabel(row.sourceKind)}</span>
                            {row.official && (
                              <span className="ext-market-item-source ext-market-item-source--official">
                                Official
                              </span>
                            )}
                            <span className="ext-market-catalog-count">{catalogCountLabel(row)}</span>
                          </div>
                          <p className="ext-market-catalog-source">{row.source}</p>
                          {catalogErr && <p className="modal-error">{catalogErr}</p>}
                        </div>
                        <div className="ext-market-catalog-actions">
                          <button
                            type="button"
                            className="settings-btn"
                            disabled={catalogBusy !== null}
                            onClick={() =>
                              void runCatalogAction('Refreshing…', () => product.marketplaces.refresh(row.source))
                            }
                          >
                            <RefreshCw size={14} />
                            Refresh
                          </button>
                          <button
                            type="button"
                            className="settings-btn"
                            disabled={row.official || catalogBusy !== null}
                            title={row.official ? 'Official catalogs cannot be removed' : 'Remove catalog'}
                            onClick={() =>
                              void runCatalogAction('Removing…', () => product.marketplaces.remove(row.source))
                            }
                          >
                            <Trash2 size={14} />
                            Remove
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </details>

            {hasCatalog && (
              <div className="ext-browse-controls">
                <div className="ext-market-search">
                  <Search size={14} className="ext-market-search-icon" />
                  <input
                    type="text"
                    className="ext-market-search-input"
                    placeholder="Search plugins…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search plugins"
                  />
                  <span className="ext-market-search-count">
                    {visibleEntries.length} of {entries?.length ?? 0}
                  </span>
                  <button
                    type="button"
                    className="ext-market-search-refresh"
                    disabled={loading}
                    onClick={refresh}
                    title="Reload the catalog"
                    aria-label="Reload the catalog"
                  >
                    <RefreshCw size={14} className={loading ? 'ext-spin' : undefined} />
                  </button>
                </div>
                <div className="settings-btn-row">
                  <label className="ext-browse-category-select">
                    <span className="sr-only">Filter by category</span>
                    <select
                      value={categoryFilters[0] ?? ''}
                      aria-label="All categories"
                      onChange={(event) => {
                        const value = event.target.value;
                        setCategoryFilters(value ? [value] : []);
                      }}
                    >
                      <option value="">All categories</option>
                      {categoryOptions
                        .filter((option) => option.id !== 'all')
                        .map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className={`settings-btn${sort === null ? ' is-active' : ''}`}
                    onClick={() => setSort(null)}
                  >
                    Featured
                  </button>
                  <button
                    type="button"
                    className={`settings-btn${sort === 'name' ? ' is-active' : ''}`}
                    onClick={() => {
                      if (sort === 'name') setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
                      else {
                        setSort('name');
                        setSortDir('asc');
                      }
                    }}
                    aria-label={`Sort by name ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
                  >
                    {sortDir === 'asc' ? <ArrowUpAZ size={14} /> : <ArrowDownAZ size={14} />}
                    Name
                  </button>
                </div>
              </div>
            )}

            {hasCatalog && (
              <div className="ext-market-tags" role="group" aria-label="Filter by tag">
                {MARKET_FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    className={`ext-market-tag ${tag === filter.id ? 'is-active' : ''}`}
                    onClick={() => setTag(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            )}

            {error && <p className="modal-error">{error}</p>}

            {entries === null ? (
              <DelayedStencilList label="Loading marketplace" className="zcc-stencil-padded" />
            ) : entries.length === 0 ? (
              <p className="settings-help settings-help--muted">
                No plugins to show. First-party plugins ship with the app; if this list is empty, the
                bundled plugins root was not found. Add a community catalog above, or install from a
                local folder, archive, git repository, or npm package.
              </p>
            ) : visibleEntries.length === 0 ? (
              <p className="settings-help settings-help--muted">
                {query.trim()
                  ? `No plugins match “${query.trim()}”.`
                  : 'No plugins match these filters.'}
              </p>
            ) : showGrid ? (
              <PluginCatalogGrid
                entries={gridEntries}
                showCategory
                busy={busy}
                errors={rowError}
                onOpen={openPlugin}
                onInstall={(entry) => setPendingConfirm(entry)}
                onOpenAuthor={openAuthor}
              />
            ) : (
              <div className="ext-browse-shelves" data-testid="plugin-browse-shelves">
                {shelves.map((shelf) => (
                  <BrowseShelf
                    key={shelf.key}
                    shelf={shelf}
                    expanded={expandedShelves.has(shelf.key)}
                    busy={busy}
                    errors={rowError}
                    onExpand={() =>
                      setExpandedShelves((current) => new Set(current).add(shelf.key))
                    }
                    onOpen={openPlugin}
                    onInstall={(entry) => setPendingConfirm(entry)}
                    onOpenAuthor={openAuthor}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {installMenus}
      {confirmDialog}
    </section>
  );
}

function BrowseShelf({
  shelf,
  expanded,
  busy,
  errors,
  onExpand,
  onOpen,
  onInstall,
  onOpenAuthor
}: {
  shelf: PluginBrowseShelf;
  expanded: boolean;
  busy: Record<string, string>;
  errors: Record<string, string>;
  onExpand: () => void;
  onOpen: (entry: MarketplaceEntry) => void;
  onInstall: (entry: MarketplaceEntry) => void;
  onOpenAuthor: (author: string) => void;
}) {
  const visible = shelfPreviewEntries(shelf.entries, expanded);
  return (
    <section className="ext-browse-shelf" data-plugin-shelf>
      <header className="ext-browse-shelf-head">
        <span
          className="ext-browse-shelf-dot"
          data-category={shelf.category ?? 'uncategorized'}
          aria-hidden="true"
        />
        <div>
          <h3>{shelf.label}</h3>
          {shelf.description ? <p className="settings-help">{shelf.description}</p> : null}
        </div>
        {visible.length < shelf.entries.length ? (
          <button type="button" className="settings-btn" onClick={onExpand}>
            See all
          </button>
        ) : null}
      </header>
      <div className="ext-browse-shelf-grid" data-plugin-shelf-grid>
        {visible.map((entry) => (
          <PluginCatalogCard
            key={entry.id}
            entry={entry}
            busy={busy[entry.id]}
            error={errors[entry.id]}
            onOpen={() => onOpen(entry)}
            onInstall={() => onInstall(entry)}
            onOpenAuthor={onOpenAuthor}
          />
        ))}
      </div>
    </section>
  );
}

export { MarketplaceView as Marketplace };

/**
 * Pre-install publisher-trust confirm. Uses the shared {@link Modal} so the
 * backdrop portals to `document.body` — the Plugins list pane (`.sidebar`)
 * creates a stacking context (`z-index: 1`) that would otherwise paint over
 * an in-tree overlay and leave the left nav looking undimmed / highlighted.
 */
export function PluginInstallConfirm({
  entry,
  onCancel,
  onConfirm
}: {
  entry: MarketplaceEntry;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const capabilities = pluginCapabilityLines(entry);
  return (
    <Modal
      title={`Install ${entry.title}?`}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={onConfirm}>
            Install with full trust
          </button>
        </>
      }
    >
      <p>
        This plugin runs in-process on the server with full trust after install.
        Host-daemon tokens stay on the server. Only continue if you trust the
        publisher.
      </p>
      {entry.description && <p>{entry.description}</p>}
      {capabilities.length > 0 && (
        <ul>
          {capabilities.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {entry.permissions && entry.permissions.length > 0 && (
        <ul>
          {entry.permissions.map((perm) => (
            <li key={perm}>{PERMISSION_LABELS[perm] ?? perm}</li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
