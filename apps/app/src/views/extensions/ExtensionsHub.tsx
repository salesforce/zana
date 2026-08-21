/**
 * Settings → Extensions hub. A master–detail view over EVERY module the shell
 * knows: built-ins (Zana, Slack) and runtime disk extensions, listed uniformly
 * via `useMergedModules()`. Core stays extension-agnostic — it never names a
 * module here; each one supplies its own settings UI through
 * `AppModule.settingsPanel`, and core only provides the container plus a generic
 * "About" card (status, version, enable toggle, reveal) for modules that ship
 * none.
 *
 * The detail pane mounts the selected module's `settingsPanel` with the same
 * cached `ModuleHost` its global panel/settings panel would use (`getHost(id)`), so
 * the extension's storage/cache/host calls resolve against one host instance.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
  ShieldCheck,
  MoreHorizontal,
  TerminalSquare
} from 'lucide-react';
import { EXTENSION_PERMISSIONS } from '@zana-ai/zcc-extension-sdk';
import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';
import type { ExtensionEntry } from '@zana-ai/zcc-domain/product';
import { useMergedModules } from '@/modules';
import { getHost } from '@/modules/ModulePanelHost';
import { resolveIcon } from '@/lib/resolveIcon';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PERMISSION_LABELS, pluginCapabilityLines } from '@/components/ExtensionConsent';
import { CreateExtensionDialog } from '@/components/CreateExtensionDialog';
import { InstallFromGitDialog } from '@/components/InstallFromGitDialog';
import { Marketplace } from '@/views/extensions/MarketplaceView';
import { useUi } from '@/store';

/**
 * Open a local extension's registered project and its project-scoped agent
 * launcher. Main resolves the project id from the local-extension record, so
 * the renderer never treats a source path as an authority (Rule 1).
 */
async function openExtensionLauncher(id: string): Promise<{ ok: false; message: string } | null> {
  const info = await window.cc.extensions.localInfo(id);
  if (!info.ok) return { ok: false, message: info.message ?? 'Could not resolve source' };
  const ui = useUi.getState();
  ui.enterProjectFocus(info.value.projectId);
  ui.setLauncherOpen(true);
  return null;
}

export type HubTab = 'installed' | 'marketplace';

/** A module paired with its disk-extension entry (built-ins have no entry). */
interface HubRow {
  module: AppModule & { loadError?: string };
  /** The disk-extension record, when this module is a runtime extension. */
  entry: ExtensionEntry | null;
}

/**
 * A DISPLAY-ONLY placeholder `AppModule` synthesized from a disk-extension's
 * manifest for a row whose extension is NOT in the loaded module set — an
 * extension awaiting consent (`needsConsent`), disabled, or version-incompatible.
 * `reconcileExtensionModules` deliberately keeps such extensions OUT of the
 * merged module set (consent must precede running any extension code, P3-D), so
 * without this the hub would drop their row entirely and the user could neither
 * see nor manage them (grant consent, re-enable, uninstall) — the reported
 * "extension hidden from the list when the consent prompt opens" bug.
 *
 * It carries NO executable contribution (`panel`/`settingsPanel`/`commands`/
 * `navBadge` all undefined) — the row renders the core-owned About + Permissions
 * cards only, so no unconsented extension code is ever mounted. Surface/status
 * are derived from the entry (see `moduleSurface`/`rowStatus`, which read the
 * manifest when a placeholder has no `panel`).
 */
function placeholderModule(entry: ExtensionEntry): AppModule & { loadError?: string } {
  return {
    id: entry.id,
    title: entry.manifest?.title ?? entry.id,
    icon: entry.manifest?.icon ?? 'HelpCircle',
    titleLabel: entry.manifest?.titleLabel,
    projectTab: entry.manifest?.projectTab
  };
}

/**
 * Build the hub's rows from the UNION of the loaded `modules` (built-ins +
 * consented, activated disk extensions) and ALL discovered disk `entries`.
 *
 * Loaded modules keep their real (executable) module. Every disk entry whose id
 * is NOT already covered by a loaded module gets a display-only placeholder row
 * (see `placeholderModule`) so an unconsented / disabled / incompatible
 * extension stays visible and manageable instead of vanishing. Exported for
 * unit tests — this join is the fix for the disappearing-row bug.
 */
export function buildHubRows(
  modules: (AppModule & { loadError?: string })[],
  entries: ExtensionEntry[]
): HubRow[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const covered = new Set(modules.map((m) => m.id));
  const rows: HubRow[] = modules.map((module) => ({
    module,
    entry: byId.get(module.id) ?? null
  }));
  for (const entry of entries) {
    if (covered.has(entry.id)) continue;
    rows.push({ module: placeholderModule(entry), entry });
  }
  return rows.sort((a, b) => a.module.title.localeCompare(b.module.title));
}

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
  const [uncontrolledTab, setUncontrolledTab] = useState<HubTab>(initialTab);
  const tab = controlledTab ?? uncontrolledTab;
  const [reloading, setReloading] = useState(false);
  const [redeploying, setRedeploying] = useState(false);
  const [redeployNote, setRedeployNote] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [openExisting, setOpenExisting] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Explicit "Reload" fallback for the auto file-watcher: re-runs the disk
  // reconcile in main (spawn new / tear down removed / respawn changed).
  const reload = () => {
    setReloading(true);
    window.cc.extensions
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
    window.cc.extensions
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
      })
      .catch(() => setRedeployNote('Redeploy failed'))
      .finally(() => setRedeploying(false));
  };

  const openCreate = () => {
    setMoreOpen(false);
    setCreating(true);
  };

  const selectTab = (next: HubTab) => {
    if (controlledTab === undefined) setUncontrolledTab(next);
    onTabChange?.(next);
  };

  const maintenanceActions = (
    <div className="ext-hub-more-wrap">
      <button
        type="button"
        className="settings-btn"
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen((open) => !open)}
      >
        <MoreHorizontal size={16} />
        More
      </button>
      {moreOpen && (
        <div className="ext-hub-more-menu" role="menu" aria-label="Extension maintenance">
          <button type="button" role="menuitem" onClick={redeploy} disabled={redeploying}>
            <RefreshCw size={14} className={redeploying ? 'ext-spin' : undefined} />
            {redeploying ? 'Reloading skills and MCP…' : 'Reload skills and MCP'}
          </button>
          <button type="button" role="menuitem" onClick={reload} disabled={reloading}>
            <RotateCw size={14} className={reloading ? 'ext-spin' : undefined} />
            {reloading ? 'Rescanning extensions…' : 'Rescan installed extensions'}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="ext-hub-shell">
      {showTabs ? (
        <div className="ext-hub-tabs" role="tablist" aria-label="Extensions">
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
            Marketplace
          </button>
          <span className="ext-hub-tabs-spacer" />
          {maintenanceActions}
        </div>
      ) : (
        <div className="ext-hub-top-actions">{maintenanceActions}</div>
      )}
      {tab === 'installed' && (
        <section className="ext-dev-guide" aria-labelledby="ext-dev-guide-title">
          <div className="ext-dev-guide-copy">
            <span className="ext-dev-guide-eyebrow">Extension development</span>
            <h3 id="ext-dev-guide-title">Build or continue an extension</h3>
            <p>Use a template for something new, or connect an existing folder or Git clone to keep editing it here.</p>
          </div>
          <div className="ext-dev-guide-actions">
            <button type="button" className="settings-btn primary" onClick={() => setOpenExisting(true)}>
              <FolderOpen size={14} />
              Open existing extension
            </button>
            <button type="button" className="settings-btn" onClick={openCreate}>
              <Wand2 size={14} />
              Create extension
            </button>
          </div>
          <ol className="ext-dev-guide-steps">
            <li>Open or create an extension.</li>
            <li>Edit its source and run its build command.</li>
            <li>With its Creator or shell session open, changes in <code>dist/</code> reload automatically.</li>
          </ol>
        </section>
      )}
      {redeployNote && (
        <div className="ext-hub-note" role="status">
          {redeployNote}
        </div>
      )}
      {tab === 'installed' ? <InstalledView /> : <Marketplace />}
      {creating && <CreateExtensionDialog onClose={() => setCreating(false)} />}
      {openExisting && <InstallFromGitDialog mode="open" onClose={() => setOpenExisting(false)} />}
    </div>
  );
}

/** Persisted width (px) of the hub's list column; clamped to this range. */
const EXT_HUB_LIST_MIN = 160;
const EXT_HUB_LIST_MAX = 420;
const EXT_HUB_LIST_DEFAULT = 220;
const EXT_HUB_LIST_KEY = 'ext-hub:list-width';

function readHubListWidth(): number {
  const raw = Number(localStorage.getItem(EXT_HUB_LIST_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return EXT_HUB_LIST_DEFAULT;
  return Math.min(EXT_HUB_LIST_MAX, Math.max(EXT_HUB_LIST_MIN, raw));
}

export function InstalledView() {
  const modules = useMergedModules() as (AppModule & { loadError?: string })[];
  const [entries, setEntries] = useState<ExtensionEntry[]>([]);
  // Selection lives in the UI store so the settings picker's Extensions
  // sub-list (ListPane) and this detail pane stay in sync — clicking an
  // extension in the picker jumps straight to its settings here.
  const selectedId = useUi((s) => s.settingsExtensionId);
  const setSelectedId = useUi((s) => s.setSettingsExtensionId);
  const [creating, setCreating] = useState(false);

  // Draggable divider between the list and detail panes. Width is a local,
  // component-scoped concern (not the app's global --col-list), so it lives in
  // state + localStorage and drives a CSS variable on the .ext-hub grid.
  const [listWidth, setListWidth] = useState(readHubListWidth);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    document.body.classList.add('resizing-col');
    const grid = gridRef.current;
    const onMove = (ev: MouseEvent) => {
      if (!grid) return;
      const next = ev.clientX - grid.getBoundingClientRect().left;
      setListWidth(Math.min(EXT_HUB_LIST_MAX, Math.max(EXT_HUB_LIST_MIN, next)));
    };
    const onUp = () => {
      document.body.classList.remove('resizing-col');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetResize = () => setListWidth(EXT_HUB_LIST_DEFAULT);
  useEffect(() => {
    localStorage.setItem(EXT_HUB_LIST_KEY, String(Math.round(listWidth)));
  }, [listWidth]);

  // Disk-extension records (built-ins aren't in this list) carry version,
  // enabled/consent status, and the on-disk path for the About card + toggle.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      window.cc.extensions
        .list()
        .then((e) => {
          if (!cancelled) setEntries(e);
        })
        .catch(() => {});
    };
    load();
    const off = window.cc.extensions.onChanged((next) => {
      if (!cancelled) setEntries(next);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const rows: HubRow[] = useMemo(() => buildHubRows(modules, entries), [modules, entries]);

  // Default the selection to the first row; keep it valid as the set changes.
  useEffect(() => {
    if (rows.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !rows.some((r) => r.module.id === selectedId)) {
      setSelectedId(rows[0].module.id);
    }
  }, [rows, selectedId]);

  const active = rows.find((r) => r.module.id === selectedId) ?? null;

  if (rows.length === 0) {
    return (
      <section className="settings-section">
        <h3>Extensions</h3>
        <p className="settings-help">
          No extensions installed. Browse the Marketplace, or build your own.
        </p>
        <div className="settings-btn-row">
          <button type="button" className="settings-btn primary" onClick={() => setCreating(true)}>
            <Wand2 size={14} />
            Create your first extension
          </button>
        </div>
        {creating && <CreateExtensionDialog onClose={() => setCreating(false)} />}
      </section>
    );
  }

  return (
    <div
      className="ext-hub"
      ref={gridRef}
      style={{ ['--ext-hub-list-w' as string]: `${Math.round(listWidth)}px` }}
    >
      <nav className="ext-hub-list" aria-label="Installed extensions">
        {rows.map(({ module, entry }) => {
          const Icon = resolveIcon(module.icon);
          const status = rowStatus(module, entry);
          const version = entry?.manifest?.version;
          const surface = moduleSurface(module, entry).label;
          return (
            <button
              key={module.id}
              type="button"
              className={`ext-hub-item ${selectedId === module.id ? 'active' : ''}`}
              onClick={() => setSelectedId(module.id)}
            >
              <Icon size={15} className="ext-hub-item-icon" />
              <span className="ext-hub-item-meta">
                <span className="ext-hub-item-title">
                  {module.title}
                  {entry?.source === 'local' && <span className="ext-local-chip">Local</span>}
                </span>
                <span className="ext-hub-item-sub">
                  <span className={`ext-hub-item-status ext-hub-item-status--${status.tone}`}>
                    {status.label}
                  </span>
                  {version && (
                    <>
                      <span className="ext-hub-item-dot" aria-hidden="true">
                        ·
                      </span>
                      <span className="ext-hub-item-version">v{version}</span>
                    </>
                  )}
                  <span className="ext-hub-item-dot" aria-hidden="true">
                    ·
                  </span>
                  <span className="ext-hub-item-surface">{surface}</span>
                </span>
              </span>
            </button>
          );
        })}
      </nav>
      <div
        className="ext-hub-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={EXT_HUB_LIST_MIN}
        aria-valuemax={EXT_HUB_LIST_MAX}
        aria-valuenow={Math.round(listWidth)}
        title="Drag to resize · double-click to reset"
        onMouseDown={startResize}
        onDoubleClick={resetResize}
      />
      <div className="ext-hub-detail">
        {active && <ExtensionDetail key={active.module.id} row={active} />}
      </div>
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
  entry: ExtensionEntry | null
): { label: string; tone: 'ok' | 'warn' | 'error' | 'muted' } {
  if (module.loadError) return { label: 'Failed', tone: 'error' };
  if (!entry) return { label: 'Built-in', tone: 'muted' };
  if (entry.error === 'version-mismatch') return { label: 'Incompatible', tone: 'error' };
  if (!entry.enabled) return { label: 'Disabled', tone: 'muted' };
  return { label: 'Enabled', tone: 'ok' };
}

/**
 * Detail pane for one module. Renders the extension's own `settingsPanel` when
 * it ships one (mounted with the module's cached host), preceded by a compact
 * "About" header. A module with no settings panel shows just the About card.
 */
function ExtensionDetail({ row }: { row: HubRow }) {
  const { module, entry } = row;
  // A module's own settings UI is `settingsPanel`. For modules that historically
  // used `placement: 'settings'` (their `panel` IS the settings page, e.g. Slack)
  // fall back to `panel` so they keep working without re-authoring.
  const SettingsPanel =
    module.settingsPanel ?? (module.placement === 'settings' ? module.panel : undefined);

  return (
    <>
      <AboutCard row={row} />
      {entry && <InstallConfirmationCard entry={entry} />}
      {module.loadError ? (
        <section className="settings-section">
          <p className="modal-error">{module.loadError}</p>
        </section>
      ) : SettingsPanel ? (
        <ErrorBoundary key={module.id}>
          <SettingsPanel host={getHost(module.id)} />
        </ErrorBoundary>
      ) : (
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
    window.cc.extensions
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
    window.cc.extensions
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
  const { module, entry } = row;
  const Icon = resolveIcon(module.icon);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isLocal = entry?.source === 'local';
  const isGit = entry?.source === 'git';
  // Global panels are launched from this hub instead of earning a separate
  // sidebar row. Project-only and Settings-only modules remain in their native
  // project/settings surfaces.
  const canOpenPanel = canOpenGlobalPanel(module);
  const openPanel = () => useUi.getState().setNav(module.id);

  const toggleEnabled = () => {
    if (!entry) return;
    window.cc.extensions.setEnabled(entry.id, !entry.enabled).catch(() => {});
  };
  const reveal = () => {
    if (!entry) return;
    window.cc.extensions.reveal(entry.id).catch(() => {});
  };
  // Reload a local extension from its source working dir (re-pack + reinstall).
  const reloadFromSource = async () => {
    if (!entry) return;
    setReloading(true);
    setLocalError(null);
    try {
      const res = await window.cc.extensions.reinstallLocal(entry.id);
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
      const res = await window.cc.extensions.prepareShare(entry.id);
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
      const res = await window.cc.extensions.reinstallFromGit(entry.id);
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
    if (!entry) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const res = await window.cc.extensions.uninstall(entry.id);
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
        <Icon size={20} className="ext-hub-about-icon" />
        <div className="ext-hub-about-titles">
          <h3>
            {module.title}
            {isLocal && <span className="ext-local-chip">Local</span>}
          </h3>
          <p className="settings-help">
            {isLocal
              ? 'Local extension — authored in-app'
              : entry
                ? 'Installed extension'
                : 'Built-in module'}
          </p>
        </div>
      </div>
      <div className="ext-hub-about-grid">
        <span className="ext-hub-about-key">Status</span>
        <span className="ext-hub-about-val">{rowStatus(module, entry).label}</span>
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
      {canOpenPanel && (
        <div className="ext-actions">
          <button type="button" className="settings-btn primary" onClick={openPanel}>
            <ExternalLink size={14} />
            Open
          </button>
        </div>
      )}
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
      {entry && (
        <div className="ext-actions-footer">
          <div className="ext-actions ext-actions--start">
            <button type="button" className="settings-btn" onClick={toggleEnabled}>
              <Power size={14} />
              {entry.enabled ? 'Disable' : 'Enable'}
            </button>
            <button type="button" className="settings-btn" onClick={reveal}>
              <FolderOpen size={14} />
              Reveal in folder
            </button>
          </div>
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
                title="Uninstall this extension"
              >
                <Trash2 size={14} />
                Uninstall
              </button>
            )}
          </div>
          {removeError && <p className="modal-error ext-actions-error">{removeError}</p>}
        </div>
      )}
    </section>
  );
}
