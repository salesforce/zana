/**
 * Pr Monitor — renderer panel root. A workbench over monitored GitHub PRs:
 * a kanban board (default) or a dense tile list, with Settings behind a
 * header toggle.
 *
 * The panel reads the latest poll result from `host.cache` for instant paint
 * (the background headless component primes the cache, see
 * ./PrMonitorBackground), subscribes to `'project:changed'` so per-project
 * scope updates without remount, and dispatches add/remove/poll via
 * `host.call`. This is an APP-SCOPED cross-project monitor (AC-NAV-2.2/2.3) —
 * the view always shows ALL PRs, never filtered to a single project.
 *
 * Layout uses the shared `@zana-ai/zcc-ui/kanban` canvas. Card chrome stays
 * under `.prm-*` and consumes host design tokens (`var(--bg-*)`, etc.).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitPullRequest, RefreshCw, Loader2, Settings as SettingsIcon, ChevronDown, Download, Trash2, ArrowLeft, AlertTriangle, WifiOff, CloudOff } from 'lucide-react';
import type { ModuleHost, ProjectInfo } from './host.js';
import {
  type MonitoredPr,
  type PrStatusDelta,
  type PrMonitorSettings,
  type SyncHealth,
  DEFAULT_PR_MONITOR_SETTINGS,
  EMPTY_SYNC_HEALTH,
  MONITORED_COUNT_CACHE_KEY,
  MONITORED_PRS_CACHE_KEY,
  SETTINGS_STORAGE_KEY,
} from '../../lib/types.js';
import { SetupGate } from './SetupGate.js';
import { PrTileList, TERMINAL_STATUSES, type SortField, type SortDir, type ListViewMode } from './PrTileList.js';
import { PullPrModal } from './PullPrModal.js';
import { SyncFilterMenu } from './SyncFilterMenu.js';
import { SettingsView } from './SettingsView.js';
import { deriveSyncClue } from './syncClue.js';
import { deliverNotifications } from './PrMonitorBackground.js';
import { isListViewMode } from './pr-board.js';

type SubTab = 'prs' | 'settings';

const STORAGE_TAB_KEY = 'activeSubTab';
const STORAGE_SORT_KEY = 'listSort';
const STORAGE_HOST_SCOPE_KEY = 'hostScope';
const STORAGE_VIEW_KEY = 'listView';

interface StoredSort {
  field: SortField;
  dir: SortDir;
}

export default function PrMonitorPanel({ host }: { host: ModuleHost }) {
  const [settings, setSettings] = useState<PrMonitorSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [prs, setPrs] = useState<MonitoredPr[]>(
    () => host.cache.get<MonitoredPr[]>(MONITORED_PRS_CACHE_KEY) ?? []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('prs');
  const [hydrated, setHydrated] = useState(false);
  const [pullOpen, setPullOpen] = useState(false);
  const [syncFilterOpen, setSyncFilterOpen] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  // Repo filter/sync scope (R-LIST-002). Empty = "All repositories".
  const [repoScope, setRepoScope] = useState<string[]>([]);
  // Sort (R-LIST-009), persisted across visits.
  const [sortField, setSortField] = useState<SortField>('status');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  // Host filter (R-LIST-027), persisted across visits. Empty = "All hosts".
  const [hostScope, setHostScope] = useState<string[]>([]);
  // List vs kanban. Default board — the modern workbench. Persisted across visits.
  const [viewMode, setViewMode] = useState<ListViewMode>('board');
  // True until the first sync ever completes (drives the pre-first-sync empty
  // state, AC-LIST-24.0). We flip it once any poll/sync returns.
  const [firstSyncDone, setFirstSyncDone] = useState(false);
  // Sync-health (R-REPO-013/015/016). `pollAll` returns fresh health (incl. the
  // transient outageHosts); `getSyncHealth` is a cheap no-probe read used on
  // mount so the clue paints before the first poll completes.
  const [syncHealth, setSyncHealth] = useState<SyncHealth>(() => ({ ...EMPTY_SYNC_HEALTH }));
  const syncBtnRef = useRef<HTMLButtonElement>(null);
  // `host.listProjects()` is a non-reactive store SNAPSHOT — at mount the
  // projects store may still be loading, so a single inline read can capture a
  // partial (or empty) list. We hold the list in state and re-read it on the
  // same short tick that mirrors the PR cache, so the dropdown fills in as the
  // store hydrates and an assigned PR's project resolves once it lands. Read
  // once eagerly so the first paint isn't empty when the store is already warm.
  const [projects, setProjects] = useState<ProjectInfo[]>(() => host.listProjects());

  // Hydrate settings, restore last sub-tab, and load PRs from storage on first mount.
  useEffect(() => {
    let alive = true;
    Promise.all([
      host.storage.get<PrMonitorSettings>(SETTINGS_STORAGE_KEY),
      host.storage.get<SubTab>(STORAGE_TAB_KEY),
      host.call<MonitoredPr[]>('listPrs'), // Load PRs immediately
      host.storage.get<StoredSort>(STORAGE_SORT_KEY),
      host.storage.get<string[]>(STORAGE_HOST_SCOPE_KEY),
      host.storage.get<ListViewMode>(STORAGE_VIEW_KEY),
    ]).then(([s, t, prsList, storedSort, storedHostScope, storedView]) => {
      if (!alive) return;
      if (storedSort?.field) setSortField(storedSort.field);
      if (storedSort?.dir) setSortDir(storedSort.dir);
      if (Array.isArray(storedHostScope)) setHostScope(storedHostScope);
      if (isListViewMode(storedView)) setViewMode(storedView);
      // Merge persisted settings over defaults so pre-redesign stores (which
      // lack watchedPeople / watchedRepos / relevanceModes / autoDiscover /
      // age thresholds) hydrate the new fields instead of leaving them
      // undefined — SettingsView reads settings.relevanceModes.authored etc.
      // unconditionally and would crash on a missing nested object.
      const merged = s
        ? {
            ...DEFAULT_PR_MONITOR_SETTINGS,
            ...s,
            relevanceModes: {
              ...DEFAULT_PR_MONITOR_SETTINGS.relevanceModes,
              ...s.relevanceModes,
            },
          }
        : null;
      setSettings(merged);
      // Seed the nav-badge inputs deterministically on mount. The badge resolves
      // `badgeMode` from host.cache('settings'); the always-on background poller
      // primes it too, but the panel must not depend on the poller being mounted
      // or on auto-sync being on — otherwise the badge falls back to the 'total'
      // cold-start default until the user toggles a setting. Seed settings +
      // refresh here so the badge honors the persisted mode on first paint.
      if (merged) {
        host.cache.set('settings', merged);
        host.cache.refreshBadge?.();
      }
      // Migrate old 'board'|'list' sub-tabs → 'prs', restoring the view mode
      // when no dedicated listView preference has been saved yet.
      if (t === 'prs' || t === 'settings') {
        setSubTab(t);
      } else if (t === 'board' || t === 'list') {
        setSubTab('prs');
        if (!isListViewMode(storedView)) {
          setViewMode(t);
          void host.storage.set(STORAGE_VIEW_KEY, t);
        }
        void host.storage.set(STORAGE_TAB_KEY, 'prs');
      }
      if (Array.isArray(prsList) && prsList.length > 0) {
        setPrs(prsList);
        host.cache.set(MONITORED_PRS_CACHE_KEY, prsList);
        host.cache.set(MONITORED_COUNT_CACHE_KEY, prsList.length);
        host.cache.refreshBadge?.();
      }
      setSettingsLoaded(true);
      setHydrated(true);
      setInitialLoadDone(true);
    }).catch((err) => {
      // Hydration is the ONLY thing that clears the loading spinner. If any
      // read here rejects (a storage/host error, or an older host shell whose
      // cache API lacks a method we call), a bare .then would strand the panel
      // on the spinner forever. Always flip the hydrated flags so the panel
      // paints its (possibly empty) UI instead of spinning; surface the error.
      if (!alive) return;
      console.error('pr-monitor hydrate failed', err);
      setSettingsLoaded(true);
      setHydrated(true);
      setInitialLoadDone(true);
    });
    return () => {
      alive = false;
    };
  }, [host]);

  // Refetch from the cache whenever the background poller writes a new snapshot.
  // The headless background component is the source of truth; the panel just
  // mirrors its cache write. We poll the cache cheaply on a short tick rather
  // than wiring a custom event — the cache write happens on a minutes-long
  // interval, so the difference is invisible to the user and avoids adding a
  // host-API surface. We poll frequently (100ms) so interactive operations like
  // the unseen toggle feel instant.
  useEffect(() => {
    const tick = () => {
      const next = host.cache.get<MonitoredPr[]>(MONITORED_PRS_CACHE_KEY);
      if (next) {
        // Use a functional update to ensure we can compare the old and new arrays.
        // If the cache has a new array reference (which happens after unseen toggle,
        // pollAll, add, remove, or assign), React will re-render. If it's the same
        // reference, React bails out automatically.
        setPrs((prev) => (prev === next ? prev : next));
      }
      // Re-read the (non-reactive) projects snapshot so a list that hydrated
      // after mount fills in. Only replace state when it actually grew/changed
      // length, to avoid a needless re-render every tick.
      const nextProjects = host.listProjects();
      setProjects((prev) => (prev.length === nextProjects.length ? prev : nextProjects));
    };
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [host]);

  const selectTab = (t: SubTab) => {
    setSubTab(t);
    void host.storage.set(STORAGE_TAB_KEY, t);
  };

  /**
   * Run an on-demand sync (R-LIST-002). With no argument, syncs everything via
   * `pollAll` (discovery + refresh). With a repo list, scopes to exactly those
   * repos via `syncRepos` (AC-LIST-2.5). Either path marks the first sync done
   * so the pre-first-sync empty state clears (AC-LIST-24.0).
   */
  const pollNow = useCallback(
    async (repos?: string[]) => {
      setLoading(true);
      setError(null);
      try {
        const scoped = Array.isArray(repos) && repos.length > 0;
        const res = scoped
          ? await host.call<{ ok: boolean; prs?: MonitoredPr[]; deltas?: PrStatusDelta[]; error?: string }>('syncRepos', { repos })
          : await host.call<{ ok: boolean; prs?: MonitoredPr[]; deltas?: PrStatusDelta[]; health?: SyncHealth; error?: string }>('pollAll');
        if (res?.ok && Array.isArray(res.prs)) {
          setPrs(res.prs);
          host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
          // Keep the nav-badge inputs in lockstep with a manual Sync. Without
          // this, a Sync (pollNow) refreshes the PR list but never re-evaluates
          // the badge, so a fresh open + Sync leaves the badge on its cold-start
          // 'total' default even when badgeMode is 'unread' — the "toggle
          // Settings to fix it" bug. refreshBadge re-runs navBadge against the
          // already-seeded settings cache.
          host.cache.set(MONITORED_COUNT_CACHE_KEY, res.prs.length);
          host.cache.refreshBadge?.();
          if (Array.isArray(res.deltas) && res.deltas.length > 0) {
            // A Sync can be clicked as hydration completes. Read durable settings
            // when render state is not ready so that transition never drops inbox
            // delivery for a project-associated PR.
            const notificationSettings = settings ?? {
              ...DEFAULT_PR_MONITOR_SETTINGS,
              ...(await host.storage.get<PrMonitorSettings>(SETTINGS_STORAGE_KEY)),
            };
            await deliverNotifications(host, res.deltas, notificationSettings);
          }
        } else if (res?.error) {
          setError(res.error);
        }
        // Only the full pollAll pass carries fresh health (incl. transient
        // outageHosts). A scoped syncRepos leaves the last-known health intact.
        const health = (res as { health?: SyncHealth })?.health;
        if (!scoped && health) {
          setSyncHealth(health);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setFirstSyncDone(true);
      }
    },
    [host]
  );

  // Refresh once when the panel first mounts (i.e. on app open / nav to PR
  // Monitor), so the user always sees CURRENT state rather than the last-stored
  // snapshot. `listPrs` (the hydrate effect above) only reads what was persisted
  // — without this, opening the app paints a stale "13m ago" board and waits for
  // the next background tick. This runs exactly once per mount, after hydration,
  // and only when there's something to poll. It does not depend on the headless
  // background poller being mounted, so the on-open refresh works regardless.
  const didInitialPoll = useRef(false);
  useEffect(() => {
    if (!initialLoadDone || didInitialPoll.current) return;
    didInitialPoll.current = true;
    // Cheap no-probe health read so the clue paints immediately, before the
    // (slower) full poll below returns fresh health.
    void host
      .call<{ ok: boolean; health?: SyncHealth }>('getSyncHealth')
      .then((res) => {
        if (res?.ok && res.health) setSyncHealth(res.health);
      })
      .catch(() => {
        /* health is best-effort; a failed read just leaves the clue hidden */
      });
    void pollNow();
  }, [initialLoadDone, pollNow, host]);

  /**
   * Resolve a remote-gone repo's Remove/Keep prompt (R-REPO-016). Delegates to
   * main (which re-validates the repo, Rule 1/2), then refreshes health so the
   * prompt clears without waiting for the next poll.
   */
  const resolveRemoteGone = useCallback(
    async (repo: string, action: 'remove' | 'keep') => {
      try {
        const res = await host.call<{ ok: boolean; error?: string }>('resolveRemoteGone', {
          repo,
          action,
        });
        if (!res?.ok) {
          host.toast(`Couldn't ${action} ${repo} — ${res?.error ?? 'unknown error'}`, 'error');
          return;
        }
        // Optimistically drop the repo from the prompt; a remove also drops its
        // PRs, so re-poll to refresh the list + health.
        setSyncHealth((prev) => ({
          ...prev,
          remoteGone: prev.remoteGone.filter((r) => r.toLowerCase() !== repo.toLowerCase()),
          keptGone:
            action === 'keep'
              ? [...prev.keptGone, repo].filter((r, i, a) => a.indexOf(r) === i)
              : prev.keptGone,
        }));
        void pollNow();
      } catch (err) {
        host.toast(
          `Couldn't ${action} ${repo} — ${err instanceof Error ? err.message : String(err)}`,
          'error'
        );
      }
    },
    [host, pollNow]
  );

  /** Drop a tracked PR. Triggers an immediate refresh on success. */
  const removePr = useCallback(
    async (url: string) => {
      try {
        const res = await host.call<{ ok: boolean; prs?: MonitoredPr[] }>('removePr', url);
        if (res?.ok && Array.isArray(res.prs)) {
          setPrs(res.prs);
          host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
          host.cache.set(MONITORED_COUNT_CACHE_KEY, res.prs.length);
          host.cache.refreshBadge?.();
        }
      } catch (err) {
        host.toast(
          `Couldn't remove PR — ${err instanceof Error ? err.message : String(err)}`,
          'error'
        );
      }
    },
    [host]
  );

  /** Dismiss a PR (calls dismissPr for auto PRs, removePr for manual). */
  const dismissPr = useCallback(
    async (url: string) => {
      const pr = prs.find((p) => p.url === url);
      if (!pr) return;

      try {
        let res: { ok: boolean; prs?: MonitoredPr[] } | undefined;
        if (pr.source === 'auto') {
          // dismissPr takes { url } object
          res = await host.call<{ ok: boolean; prs?: MonitoredPr[] }>('dismissPr', { url });
        } else {
          // removePr takes plain url string
          res = await host.call<{ ok: boolean; prs?: MonitoredPr[] }>('removePr', url);
        }
        if (res?.ok && Array.isArray(res.prs)) {
          setPrs(res.prs);
          host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
          host.cache.set(MONITORED_COUNT_CACHE_KEY, res.prs.length);
          host.cache.refreshBadge?.();
        }
      } catch (err) {
        host.toast(
          `Couldn't dismiss PR — ${err instanceof Error ? err.message : String(err)}`,
          'error'
        );
      }
    },
    [host, prs]
  );

  /**
   * Persist a settings change and update local state.
   *
   * CRITICAL — the `settings` KV is co-owned: the renderer owns user PREFERENCES
   * (poll interval, notification toggles, active nav, …) while MAIN owns the
   * discovered COLLECTIONS (`organizations`/`repositories`/`author` and their
   * `*Discovered` seed flags — written out-of-band by addRepository / deleteOrg /
   * discovery, which the renderer never sees reflected in its mount-snapshot).
   * Writing our whole in-memory object back would stamp a STALE snapshot over
   * those collections — the "repositories not saved from last session" bug: add
   * repos, then flip any pref (even switching the Settings nav row), and the repo
   * list is clobbered. So we read-modify-write: re-read the freshest persisted
   * value and preserve the main-owned fields, overlaying only our prefs.
   */
  const saveSettings = useCallback(
    async (next: PrMonitorSettings) => {
      setSettings(next);
      const persisted = await host.storage.get<PrMonitorSettings>(SETTINGS_STORAGE_KEY);
      const merged: PrMonitorSettings = { ...next };
      if (persisted) {
        merged.organizations = persisted.organizations;
        merged.repositories = persisted.repositories;
        merged.author = persisted.author;
        merged.orgDiscovered = persisted.orgDiscovered;
        merged.authorDiscovered = persisted.authorDiscovered;
      }
      await host.storage.set(SETTINGS_STORAGE_KEY, merged);
      // Mirror the persisted settings into the badge cache so a badgeMode change
      // (or SetupGate's first save) is reflected without waiting for a poller
      // tick. SettingsView.update already does this on its own edits; doing it
      // here too covers every saveSettings caller (SetupGate, reload paths).
      host.cache.set('settings', merged);
      host.cache.refreshBadge?.();
    },
    [host]
  );

  /**
   * Re-sync the panel's in-memory `settings.repositories` from the persisted
   * store. Repo state (presets, sfciGated, ignored checks) is owned main-side and
   * edited in the Repositories settings area; the board reads each repo's presets
   * + sfciGated straight from `settings.repositories` to resolve pill thresholds,
   * so after a repo edit we must refresh that slice or the board keeps painting the
   * old thresholds until the next full reload.
   */
  const reloadRepositories = useCallback(async () => {
    const persisted = await host.storage.get<PrMonitorSettings>(SETTINGS_STORAGE_KEY);
    if (persisted?.repositories) {
      setSettings((prev) => (prev ? { ...prev, repositories: persisted.repositories } : prev));
    }
  }, [host]);

  /** Assign a PR to a project. */
  const assignProject = useCallback(
    async (url: string, projectId: string | null) => {
      try {
        const res = await host.call<{ ok: boolean; prs?: MonitoredPr[] }>('assignProject', url, projectId);
        if (res?.ok && Array.isArray(res.prs)) {
          setPrs(res.prs);
          host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
        }
      } catch (err) {
        host.toast(
          `Couldn't assign project — ${err instanceof Error ? err.message : String(err)}`,
          'error'
        );
      }
    },
    [host]
  );

  /** Persist a sort change (R-LIST-009.3). */
  const changeSort = useCallback(
    (field: SortField, dir: SortDir) => {
      setSortField(field);
      setSortDir(dir);
      void host.storage.set(STORAGE_SORT_KEY, { field, dir });
    },
    [host]
  );

  /** Persist a host filter change (R-LIST-027). */
  const changeHostScope = useCallback(
    (hosts: string[]) => {
      setHostScope(hosts);
      void host.storage.set(STORAGE_HOST_SCOPE_KEY, hosts);
    },
    [host]
  );

  /** Persist list vs kanban. */
  const changeViewMode = useCallback(
    (mode: ListViewMode) => {
      setViewMode(mode);
      void host.storage.set(STORAGE_VIEW_KEY, mode);
    },
    [host]
  );

  /** Bulk mark read/unread (R-LIST-010 / AC-LIST-10.3). */
  const bulkSetSeen = useCallback(
    async (urls: string[], seen: boolean) => {
      if (urls.length === 0) return;
      try {
        const res = await host.call<{ ok: boolean; prs?: MonitoredPr[] }>('setPrsSeen', { urls, seen });
        if (res?.ok && Array.isArray(res.prs)) {
          setPrs(res.prs);
          host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
          host.cache.set('monitoredCount', res.prs.length);
          host.cache.refreshBadge?.();
        }
      } catch (err) {
        host.toast(`Couldn't update read state — ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    },
    [host]
  );

  /** Bulk favorite/unfavorite the selection (R-LIST-026). */
  const bulkSetFavorite = useCallback(
    async (urls: string[], favorite: boolean) => {
      if (urls.length === 0) return;
      try {
        const res = await host.call<{ ok: boolean; prs?: MonitoredPr[] }>('setPrsFavorite', { urls, favorite });
        if (res?.ok && Array.isArray(res.prs)) {
          setPrs(res.prs);
          host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
        }
      } catch (err) {
        host.toast(`Couldn't update favorites — ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    },
    [host]
  );

  /** Bulk dismiss (R-LIST-006 bulk bar / R-LIST-004 Sweep). */
  const bulkDismiss = useCallback(
    async (urls: string[]) => {
      if (urls.length === 0) return;
      try {
        const res = await host.call<{ ok: boolean; prs?: MonitoredPr[] }>('dismissPrs', { urls });
        if (res?.ok && Array.isArray(res.prs)) {
          setPrs(res.prs);
          host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
          host.cache.set(MONITORED_COUNT_CACHE_KEY, res.prs.length);
          host.cache.refreshBadge?.();
        }
      } catch (err) {
        host.toast(`Couldn't dismiss PRs — ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    },
    [host]
  );

  // Apply the header repo filter (R-LIST-002 / AC-LIST-2.4).
  // Empty scope = "All repositories" = no filter.
  const visiblePrs = useMemo(() => {
    if (repoScope.length === 0) return prs;
    const set = new Set(repoScope.map((r) => r.toLowerCase()));
    return prs.filter((pr) => set.has(pr.repo.toLowerCase()));
  }, [prs, repoScope]);

  // Sweep targets: exactly the terminal (Merged/Closed) PRs currently in scope
  // (AC-LIST-4.2). Sweep is inert/hidden when none present (AC-LIST-4.3).
  const sweepTargets = useMemo(
    () => visiblePrs.filter((pr) => TERMINAL_STATUSES.includes(pr.status)).map((pr) => pr.url),
    [visiblePrs]
  );

  // The single consolidated sync-health clue (AC-REPO-13.5). Null = nothing to show.
  const syncClue = useMemo(() => deriveSyncClue(syncHealth), [syncHealth]);

  if (!hydrated) {
    return (
      <section className="prm-panel">
        <div className="prm-loading">
          <Loader2 size={16} className="prm-spin" /> Loading PR Monitor…
        </div>
      </section>
    );
  }

  // First-run gate. The user opts in once before the panel does anything.
  // SetupGate persists defaults to storage and calls setSettings on save.
  if (!settings) {
    return (
      <section className="prm-panel">
        <SetupGate
          onSave={async (initial) => {
            await saveSettings(initial);
          }}
        />
      </section>
    );
  }

  return (
    <section className="prm-panel">
      <header className="prm-header">
        <div className="prm-header-title">
          <GitPullRequest size={16} className="prm-header-icon" aria-hidden />
          <div className="prm-header-heading">
            <h2>{subTab === 'settings' ? 'Settings' : 'PR Monitor'}</h2>
            <p className="prm-header-subtitle">
              {subTab === 'settings'
                ? 'Manage GitHub connections and PR monitoring preferences.'
                : 'Authored, review, and tracked pull requests'}
            </p>
          </div>
          {subTab === 'prs' && <span className="prm-count-pill">{visiblePrs.length}</span>}
        </div>
        <div className="prm-header-actions">
          {subTab === 'prs' && (
            <>
              <button
                type="button"
                className="prm-btn"
                onClick={() => setPullOpen(true)}
                title="Add a specific pull request to the monitored list"
              >
                <Download size={13} /> <span>Add PR</span>
              </button>

              {/* Sweep — dismiss all terminal (Merged/Closed) PRs (R-LIST-004).
                  Inert/hidden when none present (AC-LIST-4.3). */}
              {sweepTargets.length > 0 && (
                <button
                  type="button"
                  className="prm-btn"
                  onClick={() => void bulkDismiss(sweepTargets)}
                  title={`Sweep — dismiss the ${sweepTargets.length} Merged/Closed PR(s) from the list`}
                >
                  <Trash2 size={13} /> <span>Sweep</span>
                </button>
              )}

              {/* Sync split control (R-LIST-002): primary syncs all; dropdown opens
                  the Sync & Filter picker. */}
              <div className="prm-split-btn">
                <button
                  type="button"
                  className="prm-btn prm-btn--primary prm-split-primary"
                  onClick={() => void pollNow(repoScope)}
                  disabled={loading}
                  title={
                    repoScope.length > 0
                      ? `Sync the ${repoScope.length} selected repositor${repoScope.length === 1 ? 'y' : 'ies'} now`
                      : 'Sync all monitored PRs now'
                  }
                >
                  {loading ? <Loader2 size={13} className="prm-spin" /> : <RefreshCw size={13} />}
                  <span>Sync</span>
                </button>
                <button
                  ref={syncBtnRef}
                  type="button"
                  className="prm-btn prm-btn--primary prm-split-caret"
                  onClick={() => setSyncFilterOpen((v) => !v)}
                  disabled={loading}
                  title="Sync & Filter — choose which repositories to show and sync"
                  aria-label="Open Sync & Filter picker"
                >
                  <ChevronDown size={13} />
                </button>
                {syncFilterOpen && (
                  <SyncFilterMenu
                    anchorRef={syncBtnRef}
                    host={host}
                    selectedRepos={repoScope}
                    onClose={() => setSyncFilterOpen(false)}
                    onToggleRepo={(fullName) =>
                      setRepoScope((prev) =>
                        prev.includes(fullName) ? prev.filter((r) => r !== fullName) : [...prev, fullName]
                      )
                    }
                    onSelectAll={() => setRepoScope([])}
                    onSync={(repos) => void pollNow(repos)}
                  />
                )}
              </div>
            </>
          )}
          <button
            type="button"
            className="prm-btn prm-header-mode"
            aria-pressed={subTab === 'settings'}
            onClick={() => selectTab(subTab === 'settings' ? 'prs' : 'settings')}
            title={subTab === 'settings' ? 'Back to pull requests' : 'Settings'}
          >
            {subTab === 'settings' ? (
              <>
                <ArrowLeft size={13} aria-hidden /> <span>PRs</span>
              </>
            ) : (
              <>
                <SettingsIcon size={13} aria-hidden /> <span>Settings</span>
              </>
            )}
          </button>
        </div>
      </header>

      <div className={`prm-content${subTab === 'prs' && viewMode === 'board' ? ' prm-content--board' : ''}`}>
        {error && <div className="prm-error">{error}</div>}

        {/* Single consolidated sync-health clue (AC-REPO-13.5) — at most one,
            by precedence disconnect > remote-gone > outage. */}
        {subTab === 'prs' && syncClue && (
          <div className={`prm-sync-clue prm-sync-clue--${syncClue.kind}`} role="status">
            {syncClue.kind === 'disconnect' && <WifiOff size={14} aria-hidden />}
            {syncClue.kind === 'remote-gone' && <AlertTriangle size={14} aria-hidden />}
            {syncClue.kind === 'outage' && <CloudOff size={14} aria-hidden />}
            <span className="prm-sync-clue-msg">{syncClue.message}</span>
            {syncClue.action === 'settings' && (
              <button type="button" className="prm-sync-clue-action" onClick={() => selectTab('settings')}>
                Open Settings
              </button>
            )}
          </div>
        )}

        {/* Remove/Keep prompt for each confirmed remote-gone repo (R-REPO-016). */}
        {subTab === 'prs' &&
          syncHealth.remoteGone.map((repo) => (
            <div key={repo} className="prm-sync-prompt" role="alertdialog" aria-label={`Repository ${repo} is gone`}>
              <span className="prm-sync-prompt-msg">
                <strong>{repo}</strong> can't be found on GitHub. Remove it, or keep the last-known PRs?
              </span>
              <div className="prm-sync-prompt-actions">
                <button
                  type="button"
                  className="prm-btn"
                  onClick={() => void resolveRemoteGone(repo, 'keep')}
                >
                  Keep
                </button>
                <button
                  type="button"
                  className="prm-btn prm-btn--danger"
                  onClick={() => void resolveRemoteGone(repo, 'remove')}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}

        {subTab === 'prs' && (
          <PrTileList
            prs={visiblePrs}
            host={host}
            projects={projects}
            tisWarnHours={settings.tisWarnHours}
            tisDangerHours={settings.tisDangerHours}
            reviewWarnDays={settings.reviewWarnDays}
            reviewDangerDays={settings.reviewDangerDays}
            repositories={settings.repositories}
            workItemLocatorBase={settings.gusLocatorBaseUrl}
            sortField={sortField}
            sortDir={sortDir}
            onSortChange={changeSort}
            hostScope={hostScope}
            onHostScopeChange={changeHostScope}
            awaitingFirstSync={!firstSyncDone}
            syncing={loading}
            autoSyncEnabled={settings.autoSyncEnabled ?? true}
            onDismiss={(url) => void dismissPr(url)}
            onProjectAssign={(url, projectId) => void assignProject(url, projectId)}
            onBulkSetSeen={(urls, seen) => void bulkSetSeen(urls, seen)}
            onBulkDismiss={(urls) => void bulkDismiss(urls)}
            onBulkSetFavorite={(urls, favorite) => void bulkSetFavorite(urls, favorite)}
            viewMode={viewMode}
            onViewModeChange={changeViewMode}
          />
        )}
        {subTab === 'settings' && settingsLoaded && (
          <SettingsView
            settings={settings}
            onSave={(s) => void saveSettings(s)}
            onRepositoriesChanged={() => void reloadRepositories()}
            host={host}
          />
        )}
      </div>

      {pullOpen && (
        <PullPrModal
          host={host}
          onClose={() => setPullOpen(false)}
          onPulled={(pulled) => {
            setPrs(pulled);
            host.cache.set(MONITORED_PRS_CACHE_KEY, pulled);
            host.cache.set(MONITORED_COUNT_CACHE_KEY, pulled.length);
            host.cache.refreshBadge?.();
            setPullOpen(false);
          }}
        />
      )}
    </section>
  );
}
