import { product } from '../../lib/product-client.js';
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
import {
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ArrowUpCircle,
  Search,
  GitBranch,
  FolderOpen,
  FileArchive,
  ChevronDown,
  Plus,
  Package,
  Trash2
} from 'lucide-react';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import type { MarketplaceCatalogRow } from '@zana-ai/zcc-domain';
import { resolveIcon } from '@/lib/resolveIcon';
import { PERMISSION_LABELS, pluginCapabilityLines } from '@/components/ExtensionConsent';
import { InstallFromGitDialog } from '@/components/InstallFromGitDialog';
import { Modal } from '@/components/Modal';
import { PromptModal } from '@/components/PromptModal';
import { CreatePluginExamples } from '@/components/plugin/CreatePluginExamples';
import { CREATE_PLUGIN_PROMPT } from '@/lib/create-resource-prompts';
import { filterMarketplaceEntries, type MarketplaceTag } from './marketplace-filter.js';
import { catalogCountLabel, catalogErrorText, catalogKindLabel } from './marketplace-catalogs.js';

const MARKET_FILTERS: { id: MarketplaceTag | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'official', label: 'Official' },
  { id: 'community', label: 'Community' },
  { id: 'update', label: 'Update' }
];

export function MarketplaceView({
  onCreate,
  toolbarExtra
}: {
  onCreate?: (prompt?: string) => void;
  toolbarExtra?: ReactNode;
} = {}) {
  const [entries, setEntries] = useState<MarketplaceEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-row in-flight state, keyed by id, so one install doesn't disable the rest.
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [gitOpen, setGitOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<MarketplaceEntry | null>(null);
  const [tag, setTag] = useState<MarketplaceTag | 'all'>('all');
  const [npmOpen, setNpmOpen] = useState(false);
  const [catalogs, setCatalogs] = useState<MarketplaceCatalogRow[] | null>(null);
  const [catalogSource, setCatalogSource] = useState('');
  const [catalogBusy, setCatalogBusy] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  // "Install from…" dropdown — groups the three source pickers (folder/archive/
  // repo) behind one button so the toolbar doesn't read as five flat peers.
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
      .then(setCatalogs)
      .catch(() => setCatalogs([]));
  }, []);

  useEffect(() => {
    refresh();
    refreshCatalogs();
    // An install/update (or a watcher tick) re-stamps the installed set; refresh
    // the catalog so installed/hasUpdate flags stay accurate.
    const offExt = product.extensions.onChanged(() => refresh());
    const offApps = product.pluginApps?.onChanged?.(() => refresh()) ?? (() => {});
    return () => {
      offExt();
      offApps();
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
    // Route by provenance: a bundled row installs from the app's own resources
    // (offline), a remote row downloads + verifies from the registry. Main owns
    // both trust paths; the renderer only names the source kind + id.
    const source =
      entry.source === 'bundled'
        ? ({ kind: 'bundled', id: entry.id } as const)
        : ({ kind: 'marketplace', id: entry.id } as const);
    product.extensions
      .install(source)
      .then((res) => {
        if (!res.ok) {
          setRowError((e) => ({ ...e, [entry.id]: res.message }));
        }
        // Success: the onChanged push triggers refresh(); the consent overlay
        // (if the extension declares permissions) fires from the hub shell.
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

  // Client-side filter over the already-fetched catalog (title/id/description/
  // author). No network — just narrows what's shown.
  const filtered = useMemo(() => {
    if (!entries) return entries;
    return filterMarketplaceEntries(entries, query, tag);
  }, [entries, query, tag]);

  const hasCatalog = !!entries && entries.length > 0;

  return (
    <section className="settings-section ext-market">
      <p className="ext-market-note">
        Official plugins install offline from the app. Community catalogs are
        provenance-only — refresh never runs plugin code. Plugins run in-process
        after install: only install from publishers you trust.
      </p>

      <div className="ext-market-catalogs" data-testid="marketplace-catalogs">
        <h3 className="ext-market-catalogs-title">Catalog sources</h3>
        <p className="settings-help">
          Add <code>https://…/marketplace.json</code>, <code>git:&lt;url&gt;[@ref]</code>, or{' '}
          <code>path:&lt;dir&gt;</code>. Indexes are cached; a failed refresh keeps the last good catalog.
        </p>
        <div className="ext-market-catalogs-add">
          <input
            type="text"
            className="settings-input"
            value={catalogSource}
            onChange={(e) => setCatalogSource(e.target.value)}
            placeholder="https://…/marketplace.json"
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
              const error = catalogErrorText(row);
              return (
                <li key={row.source} className="ext-market-catalog-row">
                  <div className="ext-market-catalog-body">
                    <div className="ext-market-catalog-head">
                      <span className="ext-market-catalog-name">{row.displayName}</span>
                      <span className="ext-market-item-source">{catalogKindLabel(row.sourceKind)}</span>
                      {row.official && (
                        <span className="ext-market-item-source ext-market-item-source--official">Official</span>
                      )}
                      <span className="ext-market-catalog-count">{catalogCountLabel(row)}</span>
                    </div>
                    <p className="ext-market-catalog-source">{row.source}</p>
                    {error && <p className="modal-error">{error}</p>}
                  </div>
                  <div className="ext-market-catalog-actions">
                    <button
                      type="button"
                      className="settings-btn"
                      disabled={catalogBusy !== null}
                      onClick={() => void runCatalogAction('Refreshing…', () => product.marketplaces.refresh(row.source))}
                    >
                      <RefreshCw size={14} />
                      Refresh
                    </button>
                    <button
                      type="button"
                      className="settings-btn"
                      disabled={row.official || catalogBusy !== null}
                      title={row.official ? 'Official catalogs cannot be removed' : 'Remove catalog'}
                      onClick={() => void runCatalogAction('Removing…', () => product.marketplaces.remove(row.source))}
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
      </div>
      <div className="ext-market-toolbar">
        {hasCatalog && (
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
              {filtered?.length ?? 0} of {entries?.length ?? 0}
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
        )}
        <div className="settings-btn-row ext-market-toolbar-actions">
          {!hasCatalog && (
            <button
              type="button"
              className="settings-btn"
              disabled={loading}
              onClick={refresh}
              title="Reload the catalog"
              aria-label="Reload the catalog"
            >
              <RefreshCw size={14} className={loading ? 'ext-spin' : undefined} />
            </button>
          )}
          <div className="ext-install-menu-wrap" ref={installMenuRef}>
            <button
              type="button"
              className="settings-btn primary"
              onClick={() => setInstallMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={installMenuOpen}
              title="Install from a local folder, archive, or git repository"
            >
              <Download size={14} />
              Install
              <ChevronDown size={12} className="ext-install-menu-caret" />
            </button>
            {installMenuOpen && (
              <div className="ext-install-menu" role="menu" aria-label="Install from">
                <button
                  type="button"
                  role="menuitem"
                  className="ext-install-menu-item"
                  onClick={() => {
                    setInstallMenuOpen(false);
                    product.extensions.install({ kind: 'localDir' }).catch(() => {});
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
                    product.extensions.install({ kind: 'localArchive' }).catch(() => {});
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
          {onCreate && (
            <button
              type="button"
              className="settings-btn"
              onClick={() => onCreate(CREATE_PLUGIN_PROMPT)}
            >
              <Plus size={14} />
              Create a plugin
            </button>
          )}
          {toolbarExtra}
        </div>
      </div>

      {onCreate && (
        <CreatePluginExamples onSelect={(prompt) => onCreate(prompt)} />
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
            product.extensions.install({ kind: 'npm', spec }).catch(() => {});
          }}
        />
      )}

      {error && <p className="modal-error">{error}</p>}

      {entries === null ? (
        <p className="settings-help settings-help--muted">Loading marketplace…</p>
      ) : entries.length === 0 ? (
        <p className="settings-help settings-help--muted">
          No plugins to show. First-party plugins ship with the app; if this list is empty,
          the bundled plugins root was not found. Add a community catalog above,
          or install from a local folder, archive, git repository, or npm package.
        </p>
      ) : filtered && filtered.length === 0 ? (
        <p className="settings-help settings-help--muted">
          No plugins match “{query.trim()}”.
        </p>
      ) : (
        <ul className="ext-market-list">
          {(filtered ?? []).map((entry) => (
            <MarketRow
              key={entry.id}
              entry={entry}
              busy={busy[entry.id]}
              error={rowError[entry.id]}
              onInstall={() => setPendingConfirm(entry)}
            />
          ))}
        </ul>
      )}

      {pendingConfirm && (
        <PluginInstallConfirm
          entry={pendingConfirm}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => {
            const entry = pendingConfirm;
            setPendingConfirm(null);
            install(entry);
          }}
        />
      )}
    </section>
  );
}

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

function MarketRow({
  entry,
  busy,
  error,
  onInstall
}: {
  entry: MarketplaceEntry;
  busy?: string;
  error?: string;
  onInstall: () => void;
}) {
  const Icon = resolveIcon(entry.icon ?? 'Package');
  const action = rowAction(entry, busy);
  const provenance =
    entry.source === 'bundled' || entry.tags?.includes('official') ? 'official' : 'community';

  return (
    <li className="ext-market-item">
      <span className="ext-market-item-icon-wrap">
        <Icon size={16} className="ext-market-item-icon" />
      </span>
      <div className="ext-market-item-body">
        <div className="ext-market-item-head">
          <span className="ext-market-item-title">{entry.title}</span>
          <span className="ext-market-item-version">v{entry.version}</span>
          <span
            className={`ext-market-item-source ext-market-item-source--${provenance}`}
            title={
              entry.source === 'bundled'
                ? 'First-party plugin shipped with the app'
                : 'From a configured plugin catalog'
            }
          >
            {provenance === 'official' ? 'Official' : 'Community'}
          </span>
          {entry.hasUpdate && (
            <span className="ext-market-item-source ext-market-item-source--update">Update</span>
          )}
          {entry.author && <span className="ext-market-item-author">by {entry.author}</span>}
        </div>
        {entry.description && (
          <p className="ext-market-item-desc">{entry.description}</p>
        )}
        {entry.permissions && entry.permissions.length > 0 && (
          <div className="ext-market-item-perms">
            {entry.permissions.map((p) => (
              <span key={p} className="ext-market-perm-chip" title={PERMISSION_LABELS[p] ?? p}>
                {PERMISSION_LABELS[p] ?? p}
              </span>
            ))}
          </div>
        )}
        {entry.installed && entry.installedVersion && (
          <p className="ext-market-item-installed">Installed: v{entry.installedVersion}</p>
        )}
        {error && <p className="modal-error">{error}</p>}
      </div>
      <div className="ext-market-item-action">
        <button
          type="button"
          className={`settings-btn ${action.primary ? 'primary' : ''}`}
          disabled={action.disabled}
          onClick={onInstall}
        >
          {action.icon}
          {action.label}
        </button>
      </div>
    </li>
  );
}

/** Map an entry's installed/hasUpdate/compatible flags to its button. */
function rowAction(
  entry: MarketplaceEntry,
  busy?: string
): { label: string; disabled: boolean; primary: boolean; icon: React.ReactElement | null } {
  if (busy) return { label: busy, disabled: true, primary: false, icon: null };
  if (!entry.compatible) {
    return {
      label: 'Incompatible',
      disabled: true,
      primary: false,
      icon: <AlertTriangle size={14} />
    };
  }
  if (entry.hasUpdate) {
    return { label: 'Update', disabled: false, primary: true, icon: <ArrowUpCircle size={14} /> };
  }
  if (entry.installed) {
    return {
      label: 'Installed',
      disabled: true,
      primary: false,
      icon: <CheckCircle2 size={14} />
    };
  }
  return { label: 'Install', disabled: false, primary: true, icon: <Download size={14} /> };
}

export { MarketplaceView as Marketplace };
