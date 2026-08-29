/**
 * The PR list surface (R-LIST-005…027): a toolbar (view toggle, segment tabs,
 * selection + bulk bar, shown count, quick search, host filter, sort, mark-read)
 * over either a vertical list of {@link PrTile}s or a kanban {@link PrBoard}.
 *
 * Sort (R-LIST-009): five modes — PR Updated, PR Created, Status (canonical
 * triage-severity, AC-LIST-12.5), Status Updated — each asc/desc, plus
 * Favorites first (R-LIST-026: fixed grouping, direction toggle disabled).
 * Persisted via `onSortChange`.
 *
 * Host filter (R-LIST-027): narrows the visible list to one or more git hosts
 * (derived from each PR's URL, not a stored field). Presentation-only — unlike
 * the header's Sync & Filter repository scope, it never changes what a sync
 * re-checks. Persisted via `onHostScopeChange`.
 *
 * Segment tabs (R-LIST-005): "All" + one tab per rollup status value.
 * Quick search (R-LIST-008): case-insensitive substring over title, PR number,
 * rollup status label, source/target branch, work-item ID, repo (full + short).
 * Empty states (R-LIST-024): pre-first-sync / nothing-monitored / filtered-empty.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { GitPullRequest, Search, ArrowUp, ArrowDown, Loader2, MailOpen, Mail, Star, Trash2, X, Globe, ChevronDown, LayoutList, Columns3, CheckSquare, EyeOff } from 'lucide-react';
import type { ModuleHost, ProjectInfo } from './host.js';
import {
  type MonitoredPr,
  type MonitoredRepo,
  type PrRollupStatus,
  triageSeverityRank,
  extractWorkItem,
  hostOf,
  resolveBuildThresholds,
  resolveReviewThresholds,
} from '../../lib/types.js';
import {
  statusLabel,
  shortHost,
  DEFAULT_TIS_WARN_HOURS,
  DEFAULT_TIS_DANGER_HOURS,
  DEFAULT_REVIEW_TIS_WARN_DAYS,
  DEFAULT_REVIEW_TIS_DANGER_DAYS,
} from './formatHelpers.js';
import { PrTile } from './PrTile.js';
import { HostFilterMenu } from './HostFilterMenu.js';
import { PrBoard } from './PrBoard.js';
import { PrDetailModal } from './PrDetailModal.js';
import { type ListViewMode, emptyActiveColumnCount, groupPrsByStatus, isPrRollupStatus } from './pr-board.js';

/** The nine rollup statuses in canonical triage-severity order (for tabs + sort). */
const STATUS_ORDER: PrRollupStatus[] = [
  'conflict',
  'failed',
  'yellow',
  'review-required',
  'pending',
  'integrating',
  'green',
  'closed-merged',
  'closed-abandoned',
];

/** Terminal (Closed-lane) statuses — the exact Sweep targets (AC-LIST-4.2). */
export const TERMINAL_STATUSES: PrRollupStatus[] = ['closed-merged', 'closed-abandoned'];

export type SortField = 'updated' | 'created' | 'status' | 'statusUpdated' | 'favorites';
export type SortDir = 'asc' | 'desc';
export type { ListViewMode };

const SORT_FIELDS: Array<{ id: SortField; label: string; title: string }> = [
  { id: 'updated', label: 'PR Updated', title: 'Sort by when the PR last changed on GitHub' },
  { id: 'created', label: 'PR Created', title: 'Sort by when the PR was opened' },
  { id: 'status', label: 'Status', title: 'Sort by rollup status (triage severity)' },
  { id: 'statusUpdated', label: 'Status Updated', title: 'Sort by when the status last changed' },
  { id: 'favorites', label: 'Favorites first', title: 'Group favorites at the top, then by when the status last changed' },
];

/**
 * "Favorites first" is a GROUPING, not a field sort: favorites before
 * non-favorites, and within each group newest status-change first. Its order is
 * FIXED — it must never flow through the `* dir` multiply the field sorts use, or
 * a descending direction would invert it to non-favorites-first, oldest-first. So
 * the direction toggle is disabled while this mode is active. Pure — exported for
 * direct unit test.
 */
export function compareFavoritesFirst(a: MonitoredPr, b: MonitoredPr): number {
  const af = a.favorite ? 1 : 0;
  const bf = b.favorite ? 1 : 0;
  if (af !== bf) return bf - af;
  return b.lastStatusChange - a.lastStatusChange;
}

type SegmentTab = 'all' | PrRollupStatus;

interface Props {
  prs: MonitoredPr[];
  host: ModuleHost;
  projects: ProjectInfo[];
  /** Global BUILD-pill thresholds (hours) — repo build preset overrides them. */
  tisWarnHours?: number;
  tisDangerHours?: number;
  /** Global REVIEW-pill thresholds (days) — repo review preset overrides them. */
  reviewWarnDays?: number;
  reviewDangerDays?: number;
  /**
   * Connected repositories — carries each repo's build/review presets + sfciGated
   * + ignoredFailingChecks so a PR's pill thresholds and stall gating resolve
   * per-repo (R-REPO-014 / AC-LIST-13.3), overriding the globals.
   */
  repositories?: MonitoredRepo[];
  workItemLocatorBase?: string;
  /** Persisted sort field + direction (R-LIST-009.3). */
  sortField: SortField;
  sortDir: SortDir;
  onSortChange: (field: SortField, dir: SortDir) => void;
  /**
   * Persisted host filter (R-LIST-027). Empty = "All hosts" = no filter. Hosts
   * are derived from each PR's URL ({@link hostOf}), not a stored field.
   */
  hostScope: string[];
  onHostScopeChange: (hosts: string[]) => void;
  /** True until the first sync has ever completed (drives AC-LIST-24.0). */
  awaitingFirstSync: boolean;
  /** Whether a sync is currently in flight (AC-LIST-24.0 message). */
  syncing: boolean;
  /** Whether auto-sync is on (AC-LIST-24.0 message branch). */
  autoSyncEnabled: boolean;
  onDismiss: (url: string) => void;
  onProjectAssign: (url: string, projectId: string | null) => void;
  /** Bulk mark read/unread (R-LIST-010) and bulk dismiss (R-LIST-006). */
  onBulkSetSeen: (urls: string[], seen: boolean) => void;
  onBulkDismiss: (urls: string[]) => void;
  /** Bulk favorite/unfavorite the selected PRs (R-LIST-026). */
  onBulkSetFavorite: (urls: string[], favorite: boolean) => void;
  /** List vs kanban. Default list so isolated toolbar tests keep their surface. */
  viewMode?: ListViewMode;
  onViewModeChange?: (mode: ListViewMode) => void;
}

/** Whether a PR has an unseen status change (the "unread" model, AC-LIST-10.1). */
function isUnread(pr: MonitoredPr): boolean {
  return pr.lastSeenAt === 0 || pr.lastStatusChange > (pr.lastSeenAt ?? pr.addedAt);
}

/**
 * Resolve the bulk favorite toggle for a selection (R-LIST-026). Returns the
 * `favorite` value the action should apply: `false` (unfavorite) only when EVERY
 * selected PR is already a favorite, otherwise `true` (favorite the set). A mixed
 * or all-unfavorited selection favorites; a fully-favorited one clears. `label`
 * names the action for the button. Pure — exported for direct unit test.
 */
export function resolveBulkFavorite(
  urls: string[],
  prs: MonitoredPr[]
): { favorite: boolean; label: string } {
  const allFavorite =
    urls.length > 0 &&
    urls.every((u) => {
      const pr = prs.find((p) => p.url === u);
      return pr ? Boolean(pr.favorite) : false;
    });
  return allFavorite ? { favorite: false, label: 'Unfavorite' } : { favorite: true, label: 'Favorite' };
}

/** Short repo name (the trailing segment of owner/repo). */
function shortRepo(repo: string): string {
  const i = repo.lastIndexOf('/');
  return i >= 0 ? repo.slice(i + 1) : repo;
}

/** AC-LIST-8.2 search corpus for one PR — the exact seven fields, no author. */
function searchText(pr: MonitoredPr): string {
  const workItem = pr.workItem ?? extractWorkItem(pr.title, pr.headRefName, pr.body) ?? '';
  return [
    pr.title,
    `#${pr.number}`,
    String(pr.number),
    statusLabel(pr.status),
    pr.headRefName ?? '',
    pr.baseRefName ?? '',
    workItem,
    pr.repo,
    shortRepo(pr.repo),
  ]
    .join('')
    .toLowerCase();
}

const STORAGE_SHOW_EMPTY = 'boardShowEmpty';
const STORAGE_COLLAPSED = 'boardCollapsed';

export function PrTileList({
  prs,
  host,
  projects,
  tisWarnHours,
  tisDangerHours,
  reviewWarnDays,
  reviewDangerDays,
  repositories,
  workItemLocatorBase,
  sortField,
  sortDir,
  onSortChange,
  hostScope,
  onHostScopeChange,
  awaitingFirstSync,
  syncing,
  autoSyncEnabled,
  onDismiss,
  onProjectAssign,
  onBulkSetSeen,
  onBulkDismiss,
  onBulkSetFavorite,
  viewMode: viewModeProp = 'list',
  onViewModeChange,
}: Props) {
  const [tab, setTab] = useState<SegmentTab>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hostMenuOpen, setHostMenuOpen] = useState(false);
  const [localView, setLocalView] = useState<ListViewMode>(viewModeProp);
  const [selectMode, setSelectMode] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<PrRollupStatus>>(() => new Set());
  const [detailUrl, setDetailUrl] = useState<string | null>(null);
  const hostBtnRef = useRef<HTMLButtonElement>(null);
  const viewMode = onViewModeChange ? viewModeProp : localView;
  const setViewMode = (mode: ListViewMode) => {
    if (mode === 'board') setTab('all');
    if (mode === 'list') setSelectMode(false);
    if (onViewModeChange) onViewModeChange(mode);
    else setLocalView(mode);
  };

  useEffect(() => {
    let alive = true;
    void host.storage.get<boolean>(STORAGE_SHOW_EMPTY).then((value) => {
      if (alive && typeof value === 'boolean') setShowEmpty(value);
    });
    void host.storage.get<string[]>(STORAGE_COLLAPSED).then((value) => {
      if (!alive || !Array.isArray(value)) return;
      setCollapsed(new Set(value.filter(isPrRollupStatus)));
    });
    return () => {
      alive = false;
    };
  }, [host]);

  const persistShowEmpty = (value: boolean) => {
    setShowEmpty(value);
    void host.storage.set(STORAGE_SHOW_EMPTY, value);
  };

  const toggleCollapse = (status: PrRollupStatus) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      void host.storage.set(STORAGE_COLLAPSED, [...next]);
      return next;
    });
  };

  // Every host present among the monitored PRs (not just connected/active
  // repos — a disconnected repo's already-monitored PRs still need a filter
  // entry), in first-seen order (AC-LIST-27.3).
  const hosts = useMemo(() => {
    const seen: string[] = [];
    for (const pr of prs) {
      const h = hostOf(pr.url);
      if (!seen.includes(h)) seen.push(h);
    }
    return seen;
  }, [prs]);

  // Host filter (R-LIST-027 / AC-LIST-27.1/27.2): applied BEFORE the status tab
  // so tab counts reflect the host-narrowed set, mirroring how the header's
  // repo scope narrows the set PrTileList receives.
  const afterHost = useMemo(() => {
    if (hostScope.length === 0) return prs;
    const set = new Set(hostScope);
    return prs.filter((pr) => set.has(hostOf(pr.url)));
  }, [prs, hostScope]);

  // Which status tabs actually have PRs — "All" plus one tab per status VALUE
  // present in the monitored set is the exact set (AC-LIST-5.2). We render every
  // status tab so the tab set is stable, but count is shown per tab.
  const countsByStatus = useMemo(() => {
    const m = new Map<PrRollupStatus, number>();
    for (const pr of afterHost) m.set(pr.status, (m.get(pr.status) ?? 0) + 1);
    return m;
  }, [afterHost]);

  // Tab filter → search filter → sort.
  const afterTab = useMemo(() => {
    if (tab === 'all') return afterHost;
    return afterHost.filter((pr) => pr.status === tab);
  }, [afterHost, tab]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return afterTab;
    return afterTab.filter((pr) => searchText(pr).includes(q));
  }, [afterTab, query]);

  const shown = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const keyed = [...filtered];
    // Favorites-first is a fixed-order grouping — it must NOT flow through the
    // `* dir` multiply below (descending would invert it to non-favorites-first).
    if (sortField === 'favorites') {
      keyed.sort(compareFavoritesFirst);
      return keyed;
    }
    keyed.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'created':
          cmp = (a.createdAt ?? 0) - (b.createdAt ?? 0);
          break;
        case 'status':
          // Canonical triage-severity (rank 1 = most severe). Ascending = most
          // severe first (rank 1 → 9). (AC-LIST-9.1 / AC-LIST-12.5.)
          cmp = triageSeverityRank(a.status) - triageSeverityRank(b.status);
          break;
        case 'statusUpdated':
          cmp = a.lastStatusChange - b.lastStatusChange;
          break;
        case 'updated':
        default:
          // "PR Updated" — GitHub's own updatedAt (last change on GitHub). Legacy
          // records predating updatedAt (undefined) AND records where a transient
          // fetch left updatedAt at 0 both fall back to lastChecked, then status
          // change. `||` (not `??`) so a falsy 0 also falls through — all three are
          // positive epochs, so this is safe.
          cmp =
            (a.updatedAt || a.lastChecked || a.lastStatusChange) -
            (b.updatedAt || b.lastChecked || b.lastStatusChange);
          break;
      }
      if (cmp === 0) {
        // Stable tiebreak: unread first, then newest created.
        const au = isUnread(a) ? 1 : 0;
        const bu = isUnread(b) ? 1 : 0;
        if (au !== bu) return bu - au;
        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      }
      return cmp * dir;
    });
    return keyed;
  }, [filtered, sortField, sortDir]);

  const emptyLanes = useMemo(
    () => emptyActiveColumnCount(groupPrsByStatus(shown)),
    [shown]
  );

  const detailPr = detailUrl ? prs.find((p) => p.url === detailUrl) : undefined;
  useEffect(() => {
    if (detailUrl && !detailPr) setDetailUrl(null);
  }, [detailUrl, detailPr]);

  const detailExtras = useMemo(() => {
    if (!detailPr) return null;
    const build = resolveBuildThresholds(
      detailPr.repo,
      repositories,
      tisWarnHours ?? DEFAULT_TIS_WARN_HOURS,
      tisDangerHours ?? DEFAULT_TIS_DANGER_HOURS
    );
    const rev = resolveReviewThresholds(
      detailPr.repo,
      repositories,
      reviewWarnDays ?? DEFAULT_REVIEW_TIS_WARN_DAYS,
      reviewDangerDays ?? DEFAULT_REVIEW_TIS_DANGER_DAYS
    );
    const repoRec = (repositories ?? []).find(
      (r) => `${r.owner}/${r.repo}`.toLowerCase() === detailPr.repo.toLowerCase()
    );
    return {
      tisWarnHours: build.warnHours,
      tisDangerHours: build.dangerHours,
      reviewWarnDays: rev.warnDays,
      reviewDangerDays: rev.dangerDays,
      sfciGated: repoRec?.sfciGated === true,
      ignoredFailingChecks: repoRec?.ignoredFailingChecks,
    };
  }, [detailPr, repositories, tisWarnHours, tisDangerHours, reviewWarnDays, reviewDangerDays]);

  // Unread count reflects the host-scoped set (like countsByStatus above) but
  // NOT the active status tab/search — mirroring how it already ignored those
  // before the host filter existed.
  const unreadCount = useMemo(() => afterHost.filter(isUnread).length, [afterHost]);

  // Selection is scoped to what's currently shown (AC-LIST-6.1).
  const shownUrls = useMemo(() => shown.map((pr) => pr.url), [shown]);
  const selectedShown = useMemo(
    () => shownUrls.filter((u) => selected.has(u)),
    [shownUrls, selected]
  );
  const allShownSelected = shown.length > 0 && selectedShown.length === shown.length;
  const someShownSelected = selectedShown.length > 0 && !allShownSelected;

  const toggleSelect = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allShownSelected || someShownSelected) {
      // Any partial/full selection → clear (AC-LIST-6.5).
      setSelected(new Set());
    } else {
      setSelected(new Set(shownUrls));
    }
  };

  const clearSelection = () => setSelected(new Set());

  // Bulk targets: the current selection, or (nothing selected) all shown — for
  // the mark-read toolbar control (AC-LIST-10.3).
  const bulkSeenTargets = selectedShown.length > 0 ? selectedShown : shownUrls;
  // When every target is already read, offer the inverse (mark unread).
  const targetsAllRead = bulkSeenTargets.every((u) => {
    const pr = prs.find((p) => p.url === u);
    return pr ? !isUnread(pr) : true;
  });

  // Bulk favorite decision (R-LIST-026): the action favorites the selection
  // UNLESS every selected PR is already a favorite, in which case it unfavorites
  // them — so the one control both stars a mixed/empty set and clears a fully
  // starred one. Bulk favorite always targets the explicit selection (never the
  // whole shown set), so it renders only inside the selection bulk bar.
  const bulkFavorite = resolveBulkFavorite(selectedShown, prs);

  // --- Empty states (R-LIST-024) ---
  if (prs.length === 0) {
    // Pre-first-sync: we don't yet KNOW whether any PRs exist (AC-LIST-24.0).
    if (awaitingFirstSync) {
      const loading = syncing || autoSyncEnabled;
      return (
        <div className="prm-empty">
          {loading ? <Loader2 size={32} className="prm-spin" aria-hidden /> : <GitPullRequest size={32} aria-hidden />}
          <h3>{loading ? 'Checking for your PRs…' : 'No sync yet'}</h3>
          <p>
            {loading
              ? 'PR Monitor is syncing with GitHub to find the pull requests you authored.'
              : 'Auto-sync is off. Run a sync from the header to find your pull requests.'}
          </p>
        </div>
      );
    }
    // A sync has completed and nothing is monitored (AC-LIST-24.1).
    return (
      <div className="prm-empty">
        <GitPullRequest size={32} aria-hidden />
        <h3>No pull requests monitored</h3>
        <p>Pull a specific PR from the header, or connect a repository in Settings so a sync surfaces its PRs.</p>
      </div>
    );
  }

  const viewToggle = (
    <div className="prm-view-toggle" role="group" aria-label="View">
      <button
        type="button"
        className="prm-view-toggle-btn"
        aria-pressed={viewMode === 'list'}
        title="List view"
        onClick={() => setViewMode('list')}
      >
        <LayoutList size={13} aria-hidden />
        <span>List</span>
      </button>
      <button
        type="button"
        className="prm-view-toggle-btn"
        aria-pressed={viewMode === 'board'}
        title="Board view"
        onClick={() => setViewMode('board')}
      >
        <Columns3 size={13} aria-hidden />
        <span>Board</span>
      </button>
    </div>
  );

  const toolbar = (
    <div className="prm-list-toolbar">
      {/* Controls row. Board keeps List|Board + search + Host; list chrome
          (select-all, shown count, mark-read, sort) stays on the list. */}
      <div className="prm-list-controls">
        {viewToggle}
        {viewMode === 'list' && (
        <label className="prm-select-all" title={allShownSelected ? 'Clear selection' : 'Select all shown PRs'}>
          <input
            type="checkbox"
            checked={allShownSelected}
            ref={(el) => {
              if (el) el.indeterminate = someShownSelected;
            }}
            onChange={toggleSelectAll}
            aria-label={allShownSelected ? 'Clear selection' : 'Select all shown PRs'}
          />
        </label>
        )}

        {viewMode === 'list' && (
        <span className="prm-shown-count" aria-live="polite">
          {shown.length} shown
        </span>
        )}

        <div className="prm-search">
          <Search size={12} aria-hidden />
          <input
            type="search"
            className="prm-search-input"
            placeholder="Search PRs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search PRs"
          />
        </div>

        <button
          type="button"
          ref={hostBtnRef}
          className={`prm-btn prm-btn--sm ${hostScope.length > 0 ? 'is-active' : ''}`}
          onClick={() => setHostMenuOpen((v) => !v)}
          title="Filter by host"
          aria-expanded={hostMenuOpen}
        >
          <Globe size={12} />
          <span>Host{hostScope.length > 0 && <span className="prm-unread-count"> ({hostScope.length})</span>}</span>
          <ChevronDown size={12} />
        </button>

        {hostMenuOpen && (
          <HostFilterMenu
            anchorRef={hostBtnRef}
            hosts={hosts}
            selectedHosts={hostScope}
            onClose={() => setHostMenuOpen(false)}
            onToggleHost={(h) =>
              onHostScopeChange(
                hostScope.includes(h) ? hostScope.filter((x) => x !== h) : [...hostScope, h]
              )
            }
            onSelectAll={() => onHostScopeChange([])}
            shortHost={shortHost}
          />
        )}

        {viewMode === 'board' && (
          <>
            <button
              type="button"
              className={`prm-btn prm-btn--sm ${selectMode ? 'is-active' : ''}`}
              aria-pressed={selectMode}
              title="Select cards for bulk actions"
              onClick={() => setSelectMode((v) => !v)}
            >
              <CheckSquare size={12} />
              <span>Select</span>
            </button>
            {emptyLanes > 0 && (
              <button
                type="button"
                className={`prm-btn prm-btn--sm ${showEmpty ? 'is-active' : ''}`}
                aria-pressed={showEmpty}
                title={showEmpty ? 'Hide empty columns' : `Show ${emptyLanes} empty column${emptyLanes === 1 ? '' : 's'}`}
                onClick={() => persistShowEmpty(!showEmpty)}
              >
                <EyeOff size={12} />
                <span>{showEmpty ? 'Hide empty' : `Empty (${emptyLanes})`}</span>
              </button>
            )}
          </>
        )}

        {viewMode === 'list' && (
        <button
          type="button"
          className="prm-btn prm-btn--sm"
          onClick={() => onBulkSetSeen(bulkSeenTargets, !targetsAllRead)}
          title={
            selectedShown.length > 0
              ? `Mark the ${selectedShown.length} selected PR(s) ${targetsAllRead ? 'unread' : 'read'}`
              : `Mark all shown PRs ${targetsAllRead ? 'unread' : 'read'}`
          }
        >
          <MailOpen size={12} />
          <span>
            {targetsAllRead ? 'Mark unread' : 'Mark read'}
            {unreadCount > 0 && <span className="prm-unread-count"> ({unreadCount})</span>}
          </span>
        </button>
        )}

        {viewMode === 'list' && (
        <div className="prm-sort" title="Sort order">
          <select
            className="prm-input prm-input--select prm-sort-select"
            value={sortField}
            onChange={(e) => onSortChange(e.target.value as SortField, sortDir)}
            aria-label="Sort field"
          >
            {SORT_FIELDS.map((f) => (
              <option key={f.id} value={f.id} title={f.title}>
                {f.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="prm-btn prm-btn--sm prm-sort-dir"
            onClick={() => onSortChange(sortField, sortDir === 'asc' ? 'desc' : 'asc')}
            disabled={sortField === 'favorites'}
            title={
              sortField === 'favorites'
                ? 'Favorites first uses a fixed order'
                : sortDir === 'asc'
                  ? 'Ascending — click for descending'
                  : 'Descending — click for ascending'
            }
            aria-label={sortDir === 'asc' ? 'Sorted ascending' : 'Sorted descending'}
          >
            {sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
          </button>
        </div>
        )}
      </div>

      {/* Segment tabs (R-LIST-005): All + one per status. Sit under List|Board
          so the view chrome stays a single row. Hidden on the board —
          columns ARE the status grouping. */}
      {viewMode === 'list' && (
        <div className="prm-segment-tabs" role="tablist" aria-label="Filter by status">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'all'}
            className={`prm-segment-tab ${tab === 'all' ? 'active' : ''}`}
            onClick={() => setTab('all')}
            title="Show all monitored PRs"
          >
            All <span className="prm-segment-count">{afterHost.length}</span>
          </button>
          {STATUS_ORDER.map((s) => {
            const n = countsByStatus.get(s) ?? 0;
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={tab === s}
                className={`prm-segment-tab prm-segment-tab--${s} ${tab === s ? 'active' : ''}`}
                onClick={() => setTab(s)}
                title={`Show PRs in "${statusLabel(s)}"`}
              >
                {statusLabel(s)} <span className="prm-segment-count">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Bulk-action bar (R-LIST-006) — appears only when ≥1 PR is selected. */}
      {selectedShown.length > 0 && (
        <div className="prm-bulk-bar">
          <button
            type="button"
            className="prm-bulk-clear"
            onClick={clearSelection}
            title="Clear selection"
            aria-label="Clear selection"
          >
            <X size={12} />
          </button>
          <span className="prm-bulk-count">{selectedShown.length} selected</span>
          <div className="prm-bulk-actions">
            <button
              type="button"
              className="prm-btn prm-btn--sm"
              onClick={() => onBulkSetSeen(selectedShown, !targetsAllRead)}
              title={`Mark the selected PR(s) ${targetsAllRead ? 'unread' : 'read'}`}
            >
              {targetsAllRead ? <Mail size={12} /> : <MailOpen size={12} />}
              <span>{targetsAllRead ? 'Mark unread' : 'Mark read'}</span>
            </button>
            <button
              type="button"
              className="prm-btn prm-btn--sm"
              onClick={() => onBulkSetFavorite(selectedShown, bulkFavorite.favorite)}
              title={`${bulkFavorite.label} the selected PR(s)`}
            >
              <Star size={12} {...(bulkFavorite.favorite ? {} : { fill: 'currentColor' })} />
              <span>{bulkFavorite.label}</span>
            </button>
            <button
              type="button"
              className="prm-btn prm-btn--sm prm-btn--danger"
              onClick={() => {
                onBulkDismiss(selectedShown);
                clearSelection();
              }}
              title="Dismiss the selected PR(s) — removes them from the monitored list"
            >
              <Trash2 size={12} />
              <span>Dismiss</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={`prm-list${viewMode === 'board' ? ' prm-list--board' : ''}`}>
      {toolbar}

      {/* Filtered-empty state (AC-LIST-24.2): monitored, but tab/search hid all. */}
      {shown.length === 0 ? (
        <div className="prm-empty prm-empty--filtered">
          <Search size={28} aria-hidden />
          <h3>No PRs match the current filter</h3>
          <p>
            {query.trim()
              ? 'Clear the search to see the rest.'
              : 'No PRs in this status. Switch to the "All" tab to see the rest.'}
          </p>
          <div className="prm-empty-actions">
            {query.trim() && (
              <button type="button" className="prm-btn prm-btn--sm" onClick={() => setQuery('')} title="Clear search">
                Clear search
              </button>
            )}
            {tab !== 'all' && (
              <button type="button" className="prm-btn prm-btn--sm" onClick={() => setTab('all')} title="Show all PRs">
                Show all
              </button>
            )}
          </div>
        </div>
      ) : viewMode === 'board' ? (
        <PrBoard
          prs={shown}
          host={host}
          tisWarnHours={tisWarnHours}
          tisDangerHours={tisDangerHours}
          repositories={repositories}
          selected={selected}
          selectMode={selectMode}
          showEmpty={showEmpty}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onToggleSelect={toggleSelect}
          onDismiss={onDismiss}
          onOpen={setDetailUrl}
        />
      ) : (
        <div className="prm-tile-list">
          {shown.map((pr) => {
            // Per-repo presets override the global thresholds (R-REPO-014 /
            // AC-LIST-13.3 / AC-SYS-9.2). Build (hours) + review (days) resolve
            // independently so each pill escalates on its own repo bar.
            const build = resolveBuildThresholds(
              pr.repo,
              repositories,
              tisWarnHours ?? DEFAULT_TIS_WARN_HOURS,
              tisDangerHours ?? DEFAULT_TIS_DANGER_HOURS
            );
            const rev = resolveReviewThresholds(
              pr.repo,
              repositories,
              reviewWarnDays ?? DEFAULT_REVIEW_TIS_WARN_DAYS,
              reviewDangerDays ?? DEFAULT_REVIEW_TIS_DANGER_DAYS
            );
            const repoRec = (repositories ?? []).find(
              (r) => `${r.owner}/${r.repo}`.toLowerCase() === pr.repo.toLowerCase()
            );
            return (
            <PrTile
              key={pr.url}
              pr={pr}
              host={host}
              projects={projects}
              tisWarnHours={build.warnHours}
              tisDangerHours={build.dangerHours}
              reviewWarnDays={rev.warnDays}
              reviewDangerDays={rev.dangerDays}
              sfciGated={repoRec?.sfciGated === true}
              ignoredFailingChecks={repoRec?.ignoredFailingChecks}
              workItemLocatorBase={workItemLocatorBase}
              selected={selected.has(pr.url)}
              onToggleSelect={toggleSelect}
              onDismiss={onDismiss}
              onProjectAssign={onProjectAssign}
            />
            );
          })}
        </div>
      )}

      {detailPr && detailExtras && (
        <PrDetailModal
          pr={detailPr}
          host={host}
          projects={projects}
          tisWarnHours={detailExtras.tisWarnHours}
          tisDangerHours={detailExtras.tisDangerHours}
          reviewWarnDays={detailExtras.reviewWarnDays}
          reviewDangerDays={detailExtras.reviewDangerDays}
          sfciGated={detailExtras.sfciGated}
          ignoredFailingChecks={detailExtras.ignoredFailingChecks}
          workItemLocatorBase={workItemLocatorBase}
          onClose={() => setDetailUrl(null)}
          onDismiss={(url) => {
            setDetailUrl(null);
            onDismiss(url);
          }}
          onProjectAssign={onProjectAssign}
        />
      )}
    </div>
  );
}
