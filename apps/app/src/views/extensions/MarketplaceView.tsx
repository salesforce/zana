/**
 * Settings → Extensions → Marketplace. Browses the (opt-in) internal registry
 * and lets the user install / update an extension WITHOUT rebuilding the app.
 *
 * The catalog comes from `window.cc.extensions.marketplaceList()`, which returns
 * `[]` unless `~/.zcc/extension-registry.json` is enabled + HTTPS — so this view
 * shows an "off" hint by default and never implies a network reach that didn't
 * happen. Each row is a {@link MarketplaceEntry} already joined with this host's
 * install state (installed / hasUpdate / compatible), so the button label is a
 * pure projection of those flags — no extension id is hard-coded here (Rule #6:
 * we iterate `entry.id` variables; the renderer guard enforces no bare literal).
 *
 * Install/Update routes through `extensions.install({kind:'marketplace', id})`,
 * which downloads + sha256/-signature verifies in main and then reconciles the
 * disk so the new code spawns live; a permission-widening release comes back as
 * a typed `NEEDS_CONSENT` failure we surface inline.
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
  ChevronDown
} from 'lucide-react';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import { resolveIcon } from '@/lib/resolveIcon';
import { PERMISSION_LABELS } from '@/components/ExtensionConsent';
import { InstallFromGitDialog } from '@/components/InstallFromGitDialog';

export function MarketplaceView() {
  const [entries, setEntries] = useState<MarketplaceEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-row in-flight state, keyed by id, so one install doesn't disable the rest.
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [gitOpen, setGitOpen] = useState(false);
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
    window.cc.extensions
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
    const off = window.cc.extensions.onChanged(() => refresh());
    return () => off();
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
    window.cc.extensions
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
    window.cc.extensions
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
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      [e.title, e.id, e.description, e.author]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(q))
    );
  }, [entries, query]);

  return (
    <section className="settings-section ext-market">
      <div className="ext-market-toolbar">
        <p className="settings-help">
          Browse and install shared extensions. Updates are verified before they’re applied. Install Extensions only from publishers you trust: an Extension can see data visible in ZCC and request ZCC actions, though sensitive terminal launches still need your native confirmation.
        </p>
        <div className="settings-btn-row">
          <div className="settings-btn-group" role="group" aria-label="Sync catalog">
            <button
              type="button"
              className="settings-btn"
              disabled={loading || busy.__all !== undefined}
              onClick={checkUpdates}
              title="Check the registry for newer versions of installed extensions"
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
                    window.cc.extensions.install({ kind: 'localDir' }).catch(() => {});
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
                    window.cc.extensions.install({ kind: 'localArchive' }).catch(() => {});
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
              </div>
            )}
          </div>
        </div>
      </div>

      {gitOpen && <InstallFromGitDialog onClose={() => setGitOpen(false)} />}

      {error && <p className="modal-error">{error}</p>}

      {entries && entries.length > 0 && (
        <div className="ext-market-search">
          <Search size={14} className="ext-market-search-icon" />
          <input
            type="text"
            className="ext-market-search-input"
            placeholder="Search extensions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="ext-market-search-count">
            {filtered?.length ?? 0} of {entries.length}
          </span>
        </div>
      )}

      {entries === null ? (
        <p className="settings-help settings-help--muted">Loading marketplace…</p>
      ) : entries.length === 0 ? (
        <p className="settings-help settings-help--muted">
          No extensions to show. Point <code>~/.zcc/extension-registry.json</code> at an HTTPS
          registry (with <code>enabled: true</code>) to browse shared extensions, or install from a
          local folder or archive above.
        </p>
      ) : filtered && filtered.length === 0 ? (
        <p className="settings-help settings-help--muted">
          No extensions match “{query.trim()}”.
        </p>
      ) : (
        <ul className="ext-market-list">
          {(filtered ?? []).map((entry) => (
            <MarketRow
              key={entry.id}
              entry={entry}
              busy={busy[entry.id]}
              error={rowError[entry.id]}
              onInstall={() => install(entry)}
            />
          ))}
        </ul>
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

  return (
    <li className="ext-market-item">
      <Icon size={18} className="ext-market-item-icon" />
      <div className="ext-market-item-body">
        <div className="ext-market-item-head">
          <span className="ext-market-item-title">{entry.title}</span>
          <span className="ext-market-item-version">v{entry.version}</span>
          <span
            className={`ext-market-item-source ext-market-item-source--${entry.source}`}
            title={
              entry.source === 'bundled'
                ? 'First-party extension shipped with the app'
                : 'From the configured extension registry'
            }
          >
            {entry.source === 'bundled' ? 'Bundled' : 'Marketplace'}
          </span>
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
