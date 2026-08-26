import { product } from '../../lib/product-client.js';
/**
 * Plugins → Browse (Marketplace). Lists first-party plugins the
 * app ships (offline) and, when configured, the opt-in remote registry — so the
 * user can install / update without rebuilding the app.
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Package
} from 'lucide-react';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import { resolveIcon } from '@/lib/resolveIcon';
import { PERMISSION_LABELS, pluginCapabilityLines } from '@/components/ExtensionConsent';
import { InstallFromGitDialog } from '@/components/InstallFromGitDialog';
import { filterMarketplaceEntries, type MarketplaceTag } from './marketplace-filter.js';

const MARKET_FILTERS: { id: MarketplaceTag | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'official', label: 'Official' },
  { id: 'community', label: 'Community' },
  { id: 'update', label: 'Update' }
];

export function MarketplaceView({ onCreate }: { onCreate?: () => void } = {}) {
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
  const [npmSpec, setNpmSpec] = useState('');
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

  useEffect(() => {
    refresh();
    // An install/update (or a watcher tick) re-stamps the installed set; refresh
    // the catalog so installed/hasUpdate flags stay accurate.
    const offExt = product.extensions.onChanged(() => refresh());
    const offApps = product.pluginApps?.onChanged?.(() => refresh()) ?? (() => {});
    return () => {
      offExt();
      offApps();
    };
  }, [refresh]);

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

  const checkUpdates = () => {
    setBusy((b) => ({ ...b, __all: 'Checking…' }));
    product.extensions
      .checkUpdates()
      .catch(() => {})
      .finally(() => {
        setBusy((b) => {
          const next = { ...b };
          delete next.__all;
          return next;
        });
        refresh();
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
          </div>
        )}
        <div className="settings-btn-row">
          <div className="settings-btn-group" role="group" aria-label="Sync catalog">
            <button
              type="button"
              className="settings-btn"
              disabled={loading || busy.__all !== undefined}
              onClick={checkUpdates}
              title="Check the registry for newer versions of installed plugins"
            >
              <ArrowUpCircle size={14} />
              {busy.__all ?? 'Check for updates'}
            </button>
            <button
              type="button"
              className="settings-btn"
              disabled={loading}
              onClick={refresh}
              title="Reload the catalog"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
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
            <button type="button" className="settings-btn" onClick={onCreate}>
              <Plus size={14} />
              Create
            </button>
          )}
        </div>
      </div>

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
        <div className="palette-backdrop" onMouseDown={() => setNpmOpen(false)}>
          <div
            className="palette launch-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Install npm plugin"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="launch-panel">
              <h3>Install from npm</h3>
              <p>Package name or name@version. Installs through PluginService as npm:spec.</p>
              <input
                type="text"
                className="settings-input"
                value={npmSpec}
                onChange={(e) => setNpmSpec(e.target.value)}
                placeholder="zcc-plugin-notes"
                autoFocus
              />
              <div className="settings-btn-row">
                <button type="button" className="settings-btn" onClick={() => setNpmOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="settings-btn primary"
                  disabled={!npmSpec.trim()}
                  onClick={() => {
                    const spec = npmSpec.trim();
                    setNpmOpen(false);
                    setNpmSpec('');
                    product.extensions.install({ kind: 'npm', spec }).catch(() => {});
                  }}
                >
                  Install
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <p className="modal-error">{error}</p>}

      {entries === null ? (
        <p className="settings-help settings-help--muted">Loading marketplace…</p>
      ) : entries.length === 0 ? (
        <p className="settings-help settings-help--muted">
          No plugins to show. First-party plugins ship with the app; if this list is empty,
          the bundled plugins root was not found. Add a community catalog with
          <code> zcc marketplace add</code>, or install from a local folder above.
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
        <div className="palette-backdrop" onMouseDown={() => setPendingConfirm(null)}>
          <div
            className="palette launch-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm plugin install"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="launch-panel">
              <h3>Install {pendingConfirm.title}?</h3>
              <p>
                This plugin runs in-process on the server with full trust after
                install. Host-daemon tokens stay on the server. Only continue if
                you trust the publisher.
              </p>
              {pendingConfirm.description && <p>{pendingConfirm.description}</p>}
              {pluginCapabilityLines(pendingConfirm).length > 0 && (
                <ul>
                  {pluginCapabilityLines(pendingConfirm).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              {pendingConfirm.permissions && pendingConfirm.permissions.length > 0 && (
                <ul>
                  {pendingConfirm.permissions.map((p) => (
                    <li key={p}>{PERMISSION_LABELS[p] ?? p}</li>
                  ))}
                </ul>
              )}
              <div className="settings-btn-row">
                <button type="button" className="settings-btn" onClick={() => setPendingConfirm(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="settings-btn primary"
                  onClick={() => {
                    const entry = pendingConfirm;
                    setPendingConfirm(null);
                    install(entry);
                  }}
                >
                  Install with full trust
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
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
  const provenance = entry.source === 'bundled' ? 'official' : 'community';

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
