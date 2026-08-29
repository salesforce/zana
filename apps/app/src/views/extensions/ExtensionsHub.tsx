import { product } from '../../lib/product-client.js';
/**
 * Extensions hub. Installed is a host-wide PluginService collection (icon,
 * Official badge, description, enable switch); clicking a row opens the
 * existing `/extensions/plugins/:id` About + settings detail. Core stays
 * extension-agnostic — it never names a module here; each one supplies its own
 * settings UI through `AppModule.settingsPanel`.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderOpen,
  ExternalLink,
  Power,
  Plus,
  RotateCw,
  Trash2,
  Wand2,
  RefreshCw,
  Share2,
  MoreHorizontal,
  TerminalSquare,
  Search,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ArrowUpAZ,
  ArrowDownAZ,
  ArrowUpCircle,
  GitBranch
} from 'lucide-react';
import { EXTENSION_PERMISSIONS } from '@zana-ai/zcc-extension-sdk';
import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';
import type { ExtensionEntry, PluginAppEntry } from '@zana-ai/zcc-domain/product';
import { useMergedModules } from '@/modules';
import { getHost } from '@/modules/ModulePanelHost';
import { resolveIcon } from '@/lib/resolveIcon';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PERMISSION_LABELS, pluginCapabilityLines } from '@/components/ExtensionConsent';
import { createPluginComposeNavigation } from '@/lib/compose-prompt-seed';
import { CREATE_PLUGIN_PROMPT } from '@/lib/create-resource-prompts';
import { requestComposerCommandsReload } from '@/lib/composer-commands-reload';
import { InstallFromGitDialog } from '@/components/InstallFromGitDialog';
import { Marketplace } from '@/views/extensions/MarketplaceView';
import { PluginDefinedSettings } from '@/plugins/PluginDefinedSettings';
import { PluginSettingsSections } from '@/plugins/PluginSettingsSections';
import { listSettingsSections, subscribePluginSlots } from '@/plugins/plugin-slots';
import { useUi } from '@/store';
import {
  buildHubRows,
  displayIcon,
  filterInstalledRows,
  hostSettingsPanelOf,
  installedPublisher,
  moduleHostCallReady,
  publisherLabel,
  rowDescription,
  rowEnabled,
  shouldMountHostSettings,
  type HubRow,
  type InstalledPublisherFilter
} from './installed-plugins.js';
import { reportPluginEnabledFailure, setHubRowEnabled } from './plugin-row-enabled.js';
import { uninstallHubRow } from './plugin-row-uninstall.js';
import {
  applyHubPluginUpdate,
  pluginAvailableVersion,
  pluginUpdatesCheckedMessage
} from './plugin-row-update.js';

export { buildHubRows, type HubRow } from './installed-plugins.js';

/**
 * Open a local extension's registered project and its project-scoped agent
 * launcher. Main resolves the project id from the local-extension record, so
 * the renderer never treats a source path as an authority (Rule 1).
 */
async function openExtensionLauncher(id: string): Promise<{ ok: false; message: string } | null> {
  const info = await product.extensions.localInfo(id);
  if (!info.ok) return { ok: false, message: info.message ?? 'Could not resolve source' };
  const ui = useUi.getState();
  ui.enterProjectFocus(info.value.projectId);
  ui.setLauncherOpen(true);
  return null;
}

export type HubTab = 'installed' | 'marketplace';

export function ExtensionsHub({
  initialTab = 'installed',
  tab: controlledTab,
  onTabChange,
  showTabs = true
}: {
  initialTab?: HubTab;
  tab?: HubTab;
  onTabChange?: (tab: HubTab) => void;
  showTabs?: boolean;
} = {}) {
  const navigate = useNavigate();
  const [uncontrolledTab, setUncontrolledTab] = useState<HubTab>(initialTab);
  const tab = controlledTab ?? uncontrolledTab;
  const [reloading, setReloading] = useState(false);
  const [redeploying, setRedeploying] = useState(false);
  const [redeployNote, setRedeployNote] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const selectedProjectId = useUi((s) => s.selectedProjectId);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  // Explicit "Reload" fallback for the auto file-watcher: re-runs the disk
  // reconcile in main (spawn new / tear down removed / respawn changed).
  const reload = () => {
    setReloading(true);
    product.extensions
      .rescan()
      .catch(() => {})
      .finally(() => setReloading(false));
  };

  // Redeploy the runtime capability artifacts the app ships — bundled skills
  // (into ~/.claude/skills) + each project's `.mcp.json`. These deploy at boot;
  // this re-applies a shipped-content bump without an app restart. Best-effort,
  // idempotent; we surface a short outcome so the click has visible feedback.
  const redeploy = () => {
    setRedeploying(true);
    setRedeployNote(null);
    product.extensions
      .redeployCapabilities()
      .then((res) => {
        if (!res.ok) {
          setRedeployNote(res.message ?? 'Redeploy failed');
          return;
        }
        const ok = res.value.skills.filter((s) => s.ok).length;
        setRedeployNote(
          `Deployed ${ok}/${res.value.skills.length} skills · synced MCP for ${res.value.mcpProjects} project${res.value.mcpProjects === 1 ? '' : 's'}`
        );
        requestComposerCommandsReload();
      })
      .catch(() => setRedeployNote('Redeploy failed'))
      .finally(() => setRedeploying(false));
  };

  const startCreatePlugin = (prompt: string = CREATE_PLUGIN_PROMPT) => {
    setMoreOpen(false);
    const target = createPluginComposeNavigation({ prompt, projectId: selectedProjectId });
    void navigate(target.pathname, { state: target.state });
  };

  const checkUpdates = () => {
    setMoreOpen(false);
    setCheckingUpdates(true);
    product.pluginApps
      .checkUpdates()
      .then((updates) => {
        useUi.getState().pushToast(pluginUpdatesCheckedMessage(updates.length));
      })
      .catch(() => {
        useUi.getState().pushToast('Could not check for plugin updates', 'error');
      })
      .finally(() => setCheckingUpdates(false));
  };

  const selectTab = (next: HubTab) => {
    if (controlledTab === undefined) setUncontrolledTab(next);
    onTabChange?.(next);
  };

  const maintenanceActions = (
    <div className="ext-hub-more-wrap" ref={moreRef}>
      <button
        type="button"
        className="settings-btn"
        aria-label="More"
        title="More"
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen((open) => !open)}
      >
        <MoreHorizontal size={14} />
      </button>
      {moreOpen && (
        <div className="ext-hub-more-menu" role="menu" aria-label="Extension maintenance">
          <button type="button" role="menuitem" onClick={checkUpdates} disabled={checkingUpdates}>
            <ArrowUpCircle size={14} className={checkingUpdates ? 'ext-spin' : undefined} />
            {checkingUpdates ? 'Checking for updates…' : 'Check for updates'}
          </button>
          <button type="button" role="menuitem" onClick={redeploy} disabled={redeploying}>
            <RefreshCw size={14} className={redeploying ? 'ext-spin' : undefined} />
            {redeploying ? 'Reloading skills and MCP…' : 'Reload skills and MCP'}
          </button>
          <button type="button" role="menuitem" onClick={reload} disabled={reloading}>
            <RotateCw size={14} className={reloading ? 'ext-spin' : undefined} />
            {reloading ? 'Rescanning plugins…' : 'Rescan installed plugins'}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="ext-hub-shell">
      {showTabs ? (
        <div className="ext-hub-tabs" role="tablist" aria-label="Plugins">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'installed'}
            className={`ext-hub-tab ${tab === 'installed' ? 'active' : ''}`}
            onClick={() => selectTab('installed')}
          >
            Installed
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'marketplace'}
            className={`ext-hub-tab ${tab === 'marketplace' ? 'active' : ''}`}
            onClick={() => selectTab('marketplace')}
          >
            Browse
          </button>
          <span className="ext-hub-tabs-spacer" />
          {maintenanceActions}
        </div>
      ) : null}
      {redeployNote && (
        <div className="ext-hub-note" role="status">
          {redeployNote}
        </div>
      )}
      {tab === 'installed' ? (
        <InstalledView toolbarExtra={showTabs ? undefined : maintenanceActions} />
      ) : (
        <Marketplace
          onCreate={startCreatePlugin}
          toolbarExtra={showTabs ? undefined : maintenanceActions}
        />
      )}
    </div>
  );
}

const PUBLISHER_FILTERS: { id: InstalledPublisherFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'official', label: 'Official' },
  { id: 'local', label: 'Local' },
  { id: 'community', label: 'Community' },
  { id: 'user', label: 'User' }
];

export function InstalledView({ toolbarExtra }: { toolbarExtra?: ReactNode } = {}) {
  const navigate = useNavigate();
  const modules = useMergedModules() as (AppModule & { loadError?: string })[];
  const [entries, setEntries] = useState<ExtensionEntry[]>([]);
  const [plugins, setPlugins] = useState<PluginAppEntry[]>([]);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectedId = useUi((s) => s.settingsExtensionId);
  const selectSettingsExtension = useUi((s) => s.selectSettingsExtension);
  const setExtensionsTab = useUi((s) => s.setExtensionsTab);
  const [openExisting, setOpenExisting] = useState(false);
  const [installGit, setInstallGit] = useState(false);
  const [query, setQuery] = useState('');
  const [publisher, setPublisher] = useState<InstalledPublisherFilter>('all');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);

  const startCreatePlugin = (prompt: string = CREATE_PLUGIN_PROMPT) => {
    setNewMenuOpen(false);
    const target = createPluginComposeNavigation({ prompt, projectId: selectedProjectId });
    void navigate(target.pathname, { state: target.state });
  };

  useEffect(() => {
    if (!newMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setNewMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNewMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [newMenuOpen]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      product.extensions
        .list()
        .then((next) => {
          if (!cancelled) setEntries(next);
        })
        .catch(() => {});
      product.pluginApps
        .list()
        .then((next) => {
          if (!cancelled) setPlugins(next);
        })
        .catch(() => {});
    };
    load();
    const offExt = product.extensions.onChanged((next) => {
      if (!cancelled) setEntries(next);
    });
    const offApps = product.pluginApps.onChanged((next) => {
      if (!cancelled) setPlugins(next);
    });
    return () => {
      cancelled = true;
      offExt();
      offApps();
    };
  }, []);

  const rows = useMemo(
    () => buildHubRows(modules, entries, plugins),
    [modules, entries, plugins]
  );
  const visible = useMemo(
    () => filterInstalledRows(rows, query, publisher, sortDir),
    [rows, query, publisher, sortDir]
  );
  const active = selectedId ? (rows.find((row) => row.module.id === selectedId) ?? null) : null;

  const offeredFilters = useMemo(() => {
    const present = new Set(rows.map(installedPublisher));
    return PUBLISHER_FILTERS.filter((filter) => filter.id === 'all' || present.has(filter.id));
  }, [rows]);

  useEffect(() => {
    if (publisher !== 'all' && !offeredFilters.some((filter) => filter.id === publisher)) {
      setPublisher('all');
    }
  }, [offeredFilters, publisher]);

  if (active) {
    return (
      <section className="ext-installed ext-installed--detail">
        <button
          type="button"
          className="settings-btn ext-installed-back"
          onClick={() => setExtensionsTab('installed')}
        >
          <ChevronLeft size={14} />
          Back to installed
        </button>
        <ExtensionDetail key={active.module.id} row={active} />
      </section>
    );
  }

  return (
    <section className="ext-installed">
      <header className="ext-installed-header">
        <h3>Plugins</h3>
        <p className="settings-help">
          The plugins installed on this host. Turn one on or off, apply updates, or open it for
          settings and details.
        </p>
      </header>
      <div className="ext-installed-toolbar">
        <div className="ext-market-search">
          <Search size={14} className="ext-market-search-icon" />
          <input
            type="text"
            className="ext-market-search-input"
            placeholder="Search installed plugins"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search installed plugins"
          />
          <span className="ext-market-search-count">
            {visible.length} of {rows.length}
          </span>
        </div>
        <div className="settings-btn-row">
          <button
            type="button"
            className="settings-btn"
            onClick={() => setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))}
            aria-label={`Sort by name ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
            title={sortDir === 'asc' ? 'Name A–Z' : 'Name Z–A'}
          >
            {sortDir === 'asc' ? <ArrowUpAZ size={14} /> : <ArrowDownAZ size={14} />}
            Name
          </button>
          <div className="ext-install-menu-wrap ext-install-split" ref={newMenuRef}>
            <button
              type="button"
              className="settings-btn primary"
              onClick={() => startCreatePlugin()}
              title="Create a plugin"
            >
              <Plus size={14} />
              New plugin
            </button>
            <button
              type="button"
              className="settings-btn primary ext-install-split-toggle"
              onClick={() => setNewMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={newMenuOpen}
              aria-label="Install or open a plugin"
              title="Install or open a plugin"
            >
              <ChevronDown size={12} />
            </button>
            {newMenuOpen && (
              <div className="ext-install-menu" role="menu" aria-label="Install or open a plugin">
                <button
                  type="button"
                  role="menuitem"
                  className="ext-install-menu-item"
                  onClick={() => {
                    setNewMenuOpen(false);
                    setOpenExisting(true);
                  }}
                >
                  <FolderOpen size={14} />
                  Open existing plugin
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="ext-install-menu-item"
                  onClick={() => {
                    setNewMenuOpen(false);
                    product.extensions.install({ kind: 'localDir' }).catch(() => {});
                  }}
                >
                  <FolderOpen size={14} />
                  Install from folder
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="ext-install-menu-item"
                  onClick={() => {
                    setNewMenuOpen(false);
                    setInstallGit(true);
                  }}
                >
                  <GitBranch size={14} />
                  Install from repository
                </button>
              </div>
            )}
          </div>
          {toolbarExtra}
        </div>
      </div>
      {offeredFilters.length > 1 && (
        <div className="ext-installed-tags" role="group" aria-label="Filter by publisher">
          {offeredFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`ext-market-tag ${publisher === filter.id ? 'is-active' : ''}`}
              onClick={() => setPublisher(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      )}
      <div className="ext-installed-scroller">
        {rows.length === 0 ? (
          <p className="settings-help settings-help--muted">
            No plugins installed. Browse the Marketplace, or create your own.
          </p>
        ) : visible.length === 0 ? (
          <p className="settings-help settings-help--muted">
            {query.trim()
              ? `No plugins match “${query.trim()}”.`
              : 'No plugins match these filters.'}
          </p>
        ) : (
          <div className="ext-installed-panel" role="list" aria-label="Installed plugins">
            {visible.map((row) => (
              <InstalledPluginRow
                key={row.module.id}
                row={row}
                onOpen={() => selectSettingsExtension(row.module.id)}
              />
            ))}
          </div>
        )}
      </div>
      {openExisting && <InstallFromGitDialog mode="open" onClose={() => setOpenExisting(false)} />}
      {installGit && <InstallFromGitDialog onClose={() => setInstallGit(false)} />}
    </section>
  );
}

function InstalledPluginRow({ row, onOpen }: { row: HubRow; onOpen: () => void }) {
  const [pending, setPending] = useState<boolean | null>(null);
  const [updating, setUpdating] = useState(false);
  const enabled = pending ?? rowEnabled(row);
  const canToggle = row.plugin != null || row.entry != null;
  const availableVersion = pluginAvailableVersion(row);
  const publisher = installedPublisher(row);
  const pill = publisherLabel(publisher);
  const description = rowDescription(row);
  const Icon = resolveIcon(displayIcon(row.module.icon));

  const toggle = (next: boolean) => {
    if (!canToggle) return;
    setPending(next);
    void setHubRowEnabled(row, next, product)
      .then((res) => reportPluginEnabledFailure(res, useUi.getState().pushToast))
      .catch((err) => {
        reportPluginEnabledFailure(
          {
            ok: false,
            message: err instanceof Error ? err.message : 'Failed to update plugin'
          },
          useUi.getState().pushToast
        );
      })
      .finally(() => setPending(null));
  };

  const applyUpdate = () => {
    if (!availableVersion || updating) return;
    setUpdating(true);
    void applyHubPluginUpdate(row, product)
      .then((res) => {
        if (!res.ok) {
          useUi.getState().pushToast(res.message || 'Failed to update plugin', 'error');
          return;
        }
        useUi.getState().pushToast(`Updated ${row.module.title} to ${availableVersion}`);
      })
      .catch((err) => {
        useUi.getState().pushToast(
          err instanceof Error ? err.message : 'Failed to update plugin',
          'error'
        );
      })
      .finally(() => setUpdating(false));
  };

  return (
    <div className="ext-installed-row" data-testid={`plugin-row-${row.module.id}`} role="listitem">
      <button
        type="button"
        className="ext-installed-row-open"
        onClick={onOpen}
        aria-label={`${row.module.title} plugin details`}
      >
        <span className="ext-installed-icon">
          <Icon size={14} />
        </span>
        <span className="ext-installed-row-body">
          <span className="ext-installed-row-head">
            <span className="ext-installed-row-title">{row.module.title}</span>
            {pill && (
              <span className={`ext-installed-pill ext-market-item-source--${publisher}`}>
                {pill}
              </span>
            )}
            {availableVersion && (
              <span className="ext-installed-pill ext-market-item-source--update">Update</span>
            )}
          </span>
          {description ? <span className="ext-installed-row-desc">{description}</span> : null}
        </span>
      </button>
      <span className="ext-installed-row-trailing">
        {availableVersion ? (
          <button
            type="button"
            className="settings-btn ext-installed-update"
            disabled={updating}
            onClick={(event) => {
              event.stopPropagation();
              applyUpdate();
            }}
            title={`Update to ${availableVersion}`}
            aria-label={`Update ${row.module.title} to ${availableVersion}`}
          >
            {updating ? 'Updating…' : 'Update'}
          </button>
        ) : null}
        {canToggle ? (
          <label className="ext-installed-switch" title={enabled ? 'Disable' : 'Enable'}>
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              disabled={pending !== null}
              aria-label={`${enabled ? 'Disable' : 'Enable'} ${row.module.title}`}
              onChange={(e) => toggle(e.target.checked)}
            />
            <span className="ext-installed-switch-ui" aria-hidden="true" />
          </label>
        ) : (
          <span className="ext-installed-switch-spacer" aria-hidden="true" />
        )}
        <button
          type="button"
          className="ext-installed-row-chevron"
          onClick={onOpen}
          tabIndex={-1}
          aria-hidden="true"
        >
          <ChevronRight size={14} />
        </button>
      </span>
    </div>
  );
}

/** Format a build ISO timestamp as a short local date+time, or '' if unparseable. */
function fmtBuilt(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

/**
 * Where the module surfaces in the shell, derived purely from its capabilities
 * (Rule 6 — no module-id literal). A module is:
 *   - GLOBAL when it contributes a panel that can be opened from the Extensions
 *     hub and hasn't opted that global surface out via `projectTab.global === false`.
 *   - PROJECT when it declares a `projectTab` with a `panel` (a per-project tab).
 * The two are NOT exclusive: the default for a `projectTab` module is BOTH (a
 * global hub launch AND a per-project tab). This mirrors `canOpenGlobalPanel`
 * and `selectProjectTabModules` in modules/index.ts.
 */
function moduleSurface(module: AppModule, entry?: ExtensionEntry | null): { label: string; hint: string } {
  // A placeholder row (unconsented / disabled / incompatible extension) carries
  // no executable `panel`, so derive the surface it WILL have once loaded from
  // its manifest — otherwise every awaiting-consent extension reads as
  // "Background", hiding what it actually contributes.
  const hasRenderer = !!module.panel || !!entry?.manifest?.entry.renderer;
  const projectTab = module.projectTab ?? (module.panel ? undefined : entry?.manifest?.projectTab);
  const optedOutOfGlobal = projectTab?.global === false;
  const isGlobal =
    module.placement !== 'settings' &&
    !optedOutOfGlobal &&
    !!(hasRenderer || module.commands || module.navBadge);
  const isProject = !!(projectTab && hasRenderer);

  if (module.placement === 'settings') {
    return { label: 'Settings only', hint: 'Appears under Settings, no global panel' };
  }
  if (isGlobal && isProject) {
    return { label: 'Global + Project', hint: 'Extensions-hub launch and a per-project tab' };
  }
  if (isProject) {
    return { label: 'Project only', hint: 'Per-project tab only (no global panel)' };
  }
  if (isGlobal) {
    return { label: 'Global', hint: 'Opened from the Extensions hub' };
  }
  return { label: 'Background', hint: 'No visible surface (main/background only)' };
}

/** Whether this module can be opened as a cross-project panel from the hub. */
export function canOpenGlobalPanel(module: AppModule): boolean {
  return (
    !!module.panel &&
    module.placement !== 'settings' &&
    module.projectTab?.global !== false
  );
}

/** A short status chip for the list row. */
function rowStatus(
  module: AppModule & { loadError?: string },
  entry: ExtensionEntry | null,
  plugin?: PluginAppEntry | null
): { label: string; tone: 'ok' | 'warn' | 'error' | 'muted' } {
  if (module.loadError) return { label: 'Failed', tone: 'error' };
  if (plugin) {
    if (!plugin.enabled || plugin.status === 'disabled') return { label: 'Disabled', tone: 'muted' };
    if (plugin.status === 'degraded' || plugin.status === 'needs-configuration') {
      return { label: plugin.status === 'degraded' ? 'Degraded' : 'Needs setup', tone: 'warn' };
    }
    return { label: plugin.provenance === 'builtin' ? 'Official' : 'Enabled', tone: 'ok' };
  }
  if (!entry) return { label: 'Built-in', tone: 'muted' };
  if (entry.error === 'version-mismatch') return { label: 'Incompatible', tone: 'error' };
  if (!entry.enabled) return { label: 'Disabled', tone: 'muted' };
  return { label: 'Enabled', tone: 'ok' };
}

/**
 * Detail pane for one module. Renders the extension's own `settingsPanel` when
 * it ships one (mounted with the module's cached host), preceded by a compact
 * "About" header. Plugin `settingsSection` slots mount here too — not on Global.
 */
function ExtensionDetail({ row }: { row: HubRow }) {
  const { module, entry } = row;
  const SettingsPanel = hostSettingsPanelOf(row);
  const hasSlotSettings = useSyncExternalStore(
    subscribePluginSlots,
    listSettingsSections,
    listSettingsSections
  ).some((section) => section.pluginId === module.id);

  return (
    <>
      <AboutCard row={row} />
      {entry && <InstallConfirmationCard entry={entry} />}
      {hasSlotSettings ? null : <PluginDefinedSettings pluginId={module.id} />}
      <PluginSettingsSections pluginId={module.id} />
      {module.loadError ? (
        <section className="settings-section">
          <p className="modal-error">{module.loadError}</p>
        </section>
      ) : SettingsPanel && shouldMountHostSettings(row) && !hasSlotSettings ? (
        <ErrorBoundary key={module.id}>
          <SettingsPanel host={getHost(module.id)} />
        </ErrorBoundary>
      ) : SettingsPanel && !hasSlotSettings ? (
        <section className="settings-section">
          <p className="settings-help settings-help--muted">
            {entry
              ? 'This extension’s main process is not running, so its settings cannot load. If you just turned it on, wait a moment or relaunch Command Center.'
              : 'This leftover extension still uses the old module host, which is not running. Uninstall it and install the official plugin from the Marketplace.'}
          </p>
        </section>
      ) : hasSlotSettings ? null : (
        <section className="settings-section">
          <p className="settings-help settings-help--muted">
            {entry
              ? 'This extension does not expose any settings.'
              : 'This built-in module has no configurable settings.'}
          </p>
        </section>
      )}
    </>
  );
}

/**
 * Install confirmation: exact npm version / git commit / path source.
 * Plugins are full-trust after install; there is no permission grant set.
 */
export function InstallConfirmationCard({ entry }: { entry: ExtensionEntry }) {
  const title = entry.manifest?.title ?? entry.id;
  const version = entry.manifest?.version ?? 'unknown';
  const origin = entry.remoteOrigin ?? entry.source ?? entry.path;
  const originLabel =
    typeof origin === 'string'
      ? origin
      : origin && typeof origin === 'object' && 'url' in origin
        ? `${origin.url}${origin.ref ? `#${origin.ref}` : ''}`
        : 'origin unknown';
  const capabilityLines = pluginCapabilityLines({
    skillNames: entry.manifest?.skills?.map((s) => s.slug ?? s.path),
    mcpServers: entry.manifest?.mcpServers,
    extra: undefined
  });
  return (
    <section className="settings-section">
      <h3>Installed</h3>
      <p className="settings-help">
        {title} {version} — installing a plugin runs it in-process with full
        trust. Host-daemon tokens stay on the server.
      </p>
      <p className="settings-help settings-help--muted">{originLabel}</p>
      {capabilityLines.length > 0 && (
        <ul className="ext-hub-perm-list">
          {capabilityLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * @deprecated Consent grants are not part of the plugin model. Kept so older
 * tests that import the symbol still typecheck during the shim window.
 */
export function ConsentCard({ entry }: { entry: ExtensionEntry }) {
  return <InstallConfirmationCard entry={entry} />;
}

/**
 * Permissions card for a disk extension: lists what its manifest declares, and
 * lets the user DECLARE an additional capability. Adding one only widens the
 * manifest — the host then re-stamps the extension as needing consent, and the
 * inline ConsentCard above (plus the global overlay) asks the user to approve it
 * before it's effective. Declaring a permission here never silently grants it.
 */
function PermissionsCard({ entry }: { entry: ExtensionEntry }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const declared = entry.manifest?.permissions ?? [];
  // Offer only the known tokens this extension hasn't declared yet.
  const addable = EXTENSION_PERMISSIONS.filter((p) => !declared.includes(p));

  const addPermission = (permission: string) => {
    setBusy(permission);
    setError(null);
    product.extensions
      .addPermission(entry.id, permission)
      .then((res) => {
        if (!res.ok) setError(res.message);
        // Success: the onChanged push refreshes entries; the inline ConsentCard
        // (and the overlay) then prompt for the widened set. Nothing more here.
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null));
  };

  // Remove a declared permission: main narrows the manifest AND prunes the
  // consent record (so a later re-add re-prompts). Narrowing is silent — no
  // consent round-trip.
  const removePermission = (permission: string) => {
    setBusy(permission);
    setError(null);
    product.extensions
      .removePermission(entry.id, permission)
      .then((res) => {
        if (!res.ok) setError(res.message);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null));
  };

  return (
    <section className="settings-section ext-hub-perms">
      <h3>Permissions</h3>
      {declared.length === 0 ? (
        <p className="settings-help settings-help--muted">
          This extension declares no special permissions.
        </p>
      ) : (
        <ul className="ext-hub-perm-list">
          {declared.map((p) => (
            <li key={p} className="ext-hub-perm-item">
              <span className="ext-hub-perm-token">{p}</span>
              <span className="ext-hub-perm-label">{PERMISSION_LABELS[p] ?? p}</span>
              <button
                type="button"
                className="ext-hub-perm-remove"
                disabled={busy !== null}
                title={`Remove “${PERMISSION_LABELS[p] ?? p}”`}
                aria-label={`Remove ${PERMISSION_LABELS[p] ?? p}`}
                onClick={() => removePermission(p)}
              >
                {busy === p ? '…' : <Trash2 size={13} />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {addable.length > 0 && (
        <div className="ext-hub-perm-add-block">
          <p className="settings-help">
            Add a capability this extension doesn’t declare yet. You’ll be asked to approve it
            before it takes effect — adding it here never grants it silently.
          </p>
          <div className="ext-hub-perm-add">
            {addable.map((p) => (
              <button
                key={p}
                type="button"
                className="settings-btn"
                disabled={busy !== null}
                title={PERMISSION_LABELS[p] ?? p}
                onClick={() => addPermission(p)}
              >
                <Plus size={14} />
                <span className="ext-hub-perm-add-label">
                  {busy === p ? 'Adding…' : `Request “${PERMISSION_LABELS[p] ?? p}”`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="modal-error">{error}</p>}
    </section>
  );
}

/** Generic, core-owned header: title, provenance, version/status, enable + reveal. */
function AboutCard({ row }: { row: HubRow }) {
  const { module, entry, plugin } = row;
  const Icon = resolveIcon(displayIcon(module.icon));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isLocal = entry?.source === 'local';
  const isGit = entry?.source === 'git';
  const status = rowStatus(module, entry, plugin);
  // Global panels are launched from this hub instead of earning a separate
  // sidebar row. Project-only and Settings-only modules remain in their native
  // project/settings surfaces.
  const canOpenPanel =
    canOpenGlobalPanel(module) &&
    (moduleHostCallReady(row) || module.settingsPanel !== module.panel);
  const openPanel = () => useUi.getState().setNav(module.id);

  const canToggle = plugin != null || entry != null;
  const canUninstall = plugin != null || entry != null;
  const enabled = plugin ? plugin.enabled : (entry?.enabled ?? true);
  const toggleEnabled = () => {
    void setHubRowEnabled({ module, entry: entry ?? null, plugin: plugin ?? null }, !enabled, product)
      .then((res) => reportPluginEnabledFailure(res, useUi.getState().pushToast))
      .catch((err) => {
        reportPluginEnabledFailure(
          {
            ok: false,
            message: err instanceof Error ? err.message : 'Failed to update plugin'
          },
          useUi.getState().pushToast
        );
      });
  };
  const reveal = () => {
    if (!entry) return;
    product.extensions.reveal(entry.id).catch(() => {});
  };
  // Reload a local extension from its source working dir (re-pack + reinstall).
  const reloadFromSource = async () => {
    if (!entry) return;
    setReloading(true);
    setLocalError(null);
    try {
      const res = await product.extensions.reinstallLocal(entry.id);
      if (!res.ok) setLocalError(res.message ?? 'Reload failed');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setReloading(false);
    }
  };
  // Prepare a clean git-ready export of the local extension (manifest + dist/ +
  // README) under <workingDir>/share and reveal it, so the user can commit +
  // push it for others to install via "Install from repo". Main re-derives the
  // working dir from local.json (Rule 1).
  const [sharing, setSharing] = useState(false);
  const prepareForSharing = async () => {
    if (!entry) return;
    setSharing(true);
    setLocalError(null);
    try {
      const res = await product.extensions.prepareShare(entry.id);
      if (!res.ok) setLocalError(res.message ?? 'Could not prepare a share export');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setSharing(false);
    }
  };
  // Re-clone a git-installed extension from its recorded origin (Rule 1 — main
  // re-derives {url, ref} from git.json, never a renderer-supplied path). A
  // widened update re-prompts consent via the existing overlay.
  const updateFromRepo = async () => {
    if (!entry) return;
    setReloading(true);
    setLocalError(null);
    try {
      const res = await product.extensions.reinstallFromGit(entry.id);
      if (!res.ok) setLocalError(res.message ?? 'Update failed');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setReloading(false);
    }
  };
  // Open the registered extension project and its normal New agent launcher.
  const continueBuilding = async () => {
    if (!entry) return;
    setLocalError(null);
    try {
      const res = await openExtensionLauncher(entry.id);
      if (res && !res.ok) setLocalError(res.message);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  };
  const uninstall = async () => {
    if (!canUninstall) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const res = await uninstallHubRow({ module, entry: entry ?? null, plugin: plugin ?? null }, product);
      if (!res.ok) {
        setRemoveError(res.message ?? 'Uninstall failed');
        setRemoving(false);
        setConfirmRemove(false);
      }
      // On success the onChanged push reconciles the list and unmounts this card.
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : String(err));
      setRemoving(false);
      setConfirmRemove(false);
    }
  };

  return (
    <section className="settings-section ext-hub-about">
      <div className="ext-hub-about-head">
        <span className="ext-hub-about-icon-wrap">
          <Icon size={20} className="ext-hub-about-icon" />
        </span>
        <div className="ext-hub-about-titles">
          <h3>
            {module.title}
            {isLocal && <span className="ext-local-chip">Local</span>}
          </h3>
          <p className="settings-help">
            {isLocal
              ? 'Local extension — authored in-app'
              : plugin?.provenance === 'builtin'
                ? 'Official plugin shipped with the app'
                : plugin?.provenance === 'catalog'
                  ? 'Installed from a plugin catalog'
                  : entry
                    ? 'Installed extension'
                    : plugin
                      ? 'Installed plugin'
                      : 'Built-in module'}
          </p>
        </div>
        {canOpenPanel && (
          <button type="button" className="settings-btn primary ext-hub-about-open" onClick={openPanel}>
            <ExternalLink size={14} />
            Open
          </button>
        )}
      </div>
      <div className="ext-hub-about-grid">
        <span className="ext-hub-about-key">Status</span>
        <span className={`ext-hub-item-status ext-hub-item-status--${status.tone}`}>{status.label}</span>
        <span className="ext-hub-about-key">Surface</span>
        <span className="ext-hub-about-val" title={moduleSurface(module, entry).hint}>
          {moduleSurface(module, entry).label}
        </span>
        {entry?.manifest?.version && (
          <>
            <span className="ext-hub-about-key">Version</span>
            <span className="ext-hub-about-val">v{entry.manifest.version}</span>
          </>
        )}
        {entry?.manifest?.build?.at && (
          <>
            <span className="ext-hub-about-key">Built</span>
            <span className="ext-hub-about-val">
              {fmtBuilt(entry.manifest.build.at)}
              {entry.manifest.build.sha ? ` · ${entry.manifest.build.sha}` : ''}
            </span>
          </>
        )}
        {entry?.manifest?.engines?.zccApi && (
          <>
            <span className="ext-hub-about-key">API</span>
            <span className="ext-hub-about-val ext-hub-about-val--mono">
              {entry.manifest.engines.zccApi}
            </span>
          </>
        )}
        {entry?.path && (
          <>
            <span className="ext-hub-about-key">Location</span>
            <span className="ext-hub-about-val ext-hub-about-val--mono">{entry.path}</span>
          </>
        )}
      </div>
      {/* Primary "build" cluster for a local extension — the two things you
          actually DO with source you're authoring. Kept visually distinct (a
          titled block with a filled primary + secondary) from the management
          footer below so the workflow reads at a glance. */}
      {isLocal && (
        <div className="ext-actions-group">
          <div className="ext-actions-group-head">
            <span className="ext-actions-group-title">Develop</span>
            <span className="ext-actions-group-hint">
              This extension is connected to an editable source folder.
            </span>
          </div>
          <div className="ext-local-watch-status">
            <TerminalSquare size={15} />
            <span>
              Auto-reload is active while a Creator or shell session is open in this extension’s source folder.
            </span>
          </div>
          <div className="ext-actions">
            <button type="button" className="settings-btn primary" onClick={continueBuilding}>
              <Wand2 size={14} />
              Continue building
            </button>
            <button
              type="button"
              className="settings-btn"
              onClick={reloadFromSource}
              disabled={reloading}
            >
              <RefreshCw size={14} className={reloading ? 'ext-spin' : undefined} />
              {reloading ? 'Reloading…' : 'Reload now'}
            </button>
            <button
              type="button"
              className="settings-btn"
              onClick={prepareForSharing}
              disabled={sharing}
              title="Assemble a git-ready share/ folder (manifest + dist + README) and reveal it"
            >
              <Share2 size={14} />
              {sharing ? 'Preparing…' : 'Prepare for sharing'}
            </button>
          </div>
          {localError && <p className="modal-error">{localError}</p>}
        </div>
      )}
      {/* Git-installed extension — pull the latest code from its recorded origin.
          A widened update re-prompts consent via the existing overlay. */}
      {isGit && (
        <div className="ext-actions-group">
          <div className="ext-actions-group-head">
            <span className="ext-actions-group-title">Repository</span>
            <span className="ext-actions-group-hint">
              {entry?.remoteOrigin?.url
                ? `Installed from ${entry.remoteOrigin.url}${entry.remoteOrigin.ref ? ` @ ${entry.remoteOrigin.ref}` : ''}`
                : 'Installed from a remote repository.'}
            </span>
          </div>
          <div className="ext-actions">
            <button
              type="button"
              className="settings-btn primary"
              onClick={updateFromRepo}
              disabled={reloading}
            >
              <RefreshCw size={14} className={reloading ? 'ext-spin' : undefined} />
              {reloading ? 'Updating…' : 'Update from repo'}
            </button>
          </div>
          {localError && <p className="modal-error">{localError}</p>}
        </div>
      )}
      {/* Management footer — safe utility actions on the left, the destructive
          action pushed to the far right and separated by a hairline so it can't
          be hit by muscle memory. Confirm/Cancel replace Uninstall in place. */}
      {canToggle && (
        <div className="ext-actions-footer">
          <div className="ext-actions ext-actions--start">
            <button type="button" className="settings-btn" onClick={toggleEnabled}>
              <Power size={14} />
              {enabled ? 'Disable' : 'Enable'}
            </button>
            {entry && (
              <button type="button" className="settings-btn" onClick={reveal}>
                <FolderOpen size={14} />
                Reveal in folder
              </button>
            )}
          </div>
          {canUninstall && (
            <div className="ext-actions ext-actions--end">
              {confirmRemove ? (
                <>
                  <button
                    type="button"
                    className="settings-btn"
                    onClick={() => setConfirmRemove(false)}
                    disabled={removing}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="settings-btn danger"
                    onClick={uninstall}
                    disabled={removing}
                  >
                    <Trash2 size={14} />
                    {removing ? 'Removing…' : 'Confirm remove'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="settings-btn danger-ghost"
                  onClick={() => setConfirmRemove(true)}
                  title="Uninstall this plugin"
                >
                  <Trash2 size={14} />
                  Uninstall
                </button>
              )}
            </div>
          )}
          {removeError && <p className="modal-error ext-actions-error">{removeError}</p>}
        </div>
      )}
    </section>
  );
}
