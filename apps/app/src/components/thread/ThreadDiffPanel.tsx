import './thread-diff.css';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, ChevronsDown, ChevronsUp, Columns2, Copy, Rows2, GitBranch, GitCompare, MoreHorizontal, PanelRightClose, PanelRightOpen, TextWrap } from 'lucide-react';
import { formatDiffCount, formatDiffStatsText } from '@zana-ai/zcc-thread-view';
import { product } from '../../lib/product-client.js';
import { PopoverPicklist } from '../ui/PopoverPicklist.js';
import { Skeleton } from '../ui/Skeleton.js';
import { ThreadDiffFileNavigator, DiffFileIcon } from './ThreadDiffFileNavigator.js';
import { ThreadDiffCommit } from './ThreadDiffCommit.js';
import type { WorkspaceStatus } from '@zana-ai/zcc-domain';
import { ThreadDiffHunkView } from './ThreadDiffHunkView.js';
import {
  areAllDiffCardsCollapsed,
  collapseAllDiffCards,
  DIFF_AUTO_COLLAPSE_FILE_THRESHOLD,
  DIFF_SELECTION_ALL,
  DIFF_SELECTION_OPTIONS,
  diffCardHeaderStats,
  diffPanelPhase,
  diffTargetForSelection,
  filterDiffFiles,
  formatDiffCardLabel,
  formatDiffFilesLabel,
  resolveDiffCardBodyKind,
  resolveDiffCardCollapsed,
  shouldAutoLoadPatch,
  summarizeDiffFiles,
  type DiffPatchStatus,
  type DiffSelection
} from './thread-diff.js';

type DiffFileEntry = Awaited<ReturnType<typeof product.environments.diffFiles>>['files'][number];
type DiffPatchEntry = Awaited<ReturnType<typeof product.environments.diffPatch>>['patches'][number];

type PatchCacheEntry =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; patch: string; truncated: boolean }
  | { status: 'error'; error: string };

const DIFF_STATUS_POLL_MS = 4_000;

function patchStatusOf(entry: PatchCacheEntry | undefined): DiffPatchStatus {
  return entry?.status ?? 'idle';
}

function seedPatchCache(initialPatches: readonly DiffPatchEntry[]): Record<string, PatchCacheEntry> {
  const next: Record<string, PatchCacheEntry> = {};
  for (const entry of initialPatches) {
    next[entry.path] = { status: 'ready', patch: entry.patch, truncated: entry.truncated };
  }
  return next;
}

function DiffToolbarButton({
  label,
  pressed,
  onClick,
  children
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`thread-diff-toolbar-btn${pressed ? ' is-pressed' : ''}`}
      aria-label={label}
      title={label}
      {...(typeof pressed === 'boolean' ? { 'aria-pressed': pressed } : {})}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ThreadDiffPanel({
  environmentId,
  path,
  onClose,
  embedded
}: {
  environmentId: string;
  path: string | null;
  onClose: () => void;
  embedded?: boolean;
}) {
  const [files, setFiles] = useState<DiffFileEntry[] | null>(null);
  const [listTruncated, setListTruncated] = useState(false);
  const [patches, setPatches] = useState<Record<string, PatchCacheEntry>>({});
  const [collapsedByPath, setCollapsedByPath] = useState<Record<string, boolean | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<DiffSelection>(DIFF_SELECTION_ALL);
  const [wrap, setWrap] = useState(false);
  const [splitView, setSplitView] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [activePath, setActivePath] = useState<string | null>(path);
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestGeneration = useRef(0);
  const cardsRef = useRef<HTMLDivElement>(null);
  const pendingScrollPath = useRef<string | null>(path);
  const target = useMemo(() => diffTargetForSelection(selection), [selection]);

  useEffect(() => {
    let cancelled = false;
    requestGeneration.current += 1;
    setWorkspaceStatus(null);
    setActivePath(path);
    let inFlight = false;
    pendingScrollPath.current = path;
    const load = (reset: boolean) => {
      if (inFlight) return;
      inFlight = true;
      if (reset) {
        setError(null);
        setFiles(null);
        setPatches({});
        setCollapsedByPath({});
      }
      void product.environments.status(environmentId).then((status) => {
        if (!cancelled) setWorkspaceStatus(status);
      }).catch(() => { /* The diff remains usable when branch status is unavailable. */ });
      void product.environments.diffFiles(environmentId, target).then((next) => {
        if (cancelled) return;
        setError(null);
        setFiles(next.files);
        setListTruncated(next.truncated);
        setPatches((previous) => {
          const seeded = seedPatchCache(next.initialPatches);
          if (reset) return seeded;
          const kept: Record<string, PatchCacheEntry> = { ...seeded };
          for (const file of next.files) {
            const existing = previous[file.path];
            if (!kept[file.path] && existing) kept[file.path] = existing;
          }
          return kept;
        });
        if (reset && path && next.files.some((file) => file.path === path)) {
          setCollapsedByPath({ [path]: false });
        }
      }).catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load diff');
      }).finally(() => {
        inFlight = false;
      });
    };
    load(true);
    const timer = window.setInterval(() => load(false), DIFF_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      requestGeneration.current += 1;
      window.clearInterval(timer);
    };
  }, [environmentId, path, target, refreshKey]);

  const loadPatch = useCallback((filePath: string) => {
    const generation = requestGeneration.current;
    setPatches((previous) => {
      const current = previous[filePath];
      if (current?.status === 'loading' || current?.status === 'ready') return previous;
      return { ...previous, [filePath]: { status: 'loading' } };
    });
    void product.environments.diffPatch(environmentId, { paths: [filePath], target }).then((next) => {
      if (requestGeneration.current !== generation) return;
      const loaded = next.patches[0] ?? { path: filePath, patch: '', truncated: false };
      setPatches((previous) => ({
        ...previous,
        [filePath]: { status: 'ready', patch: loaded.patch, truncated: loaded.truncated }
      }));
    }).catch((err: unknown) => {
      if (requestGeneration.current !== generation) return;
      setPatches((previous) => ({
        ...previous,
        [filePath]: {
          status: 'error',
          error: err instanceof Error ? err.message : 'Could not load file patch'
        }
      }));
    });
  }, [environmentId, target]);

  const stats = useMemo(() => summarizeDiffFiles(files ?? []), [files]);
  const visibleFiles = useMemo(() => filterDiffFiles(files ?? [], query), [files, query]);
  const allCollapsed = files ? areAllDiffCardsCollapsed(files, collapsedByPath) : true;
  const phase = diffPanelPhase(error, Boolean(files));

  useEffect(() => {
    const target = pendingScrollPath.current;
    if (!target || !files) return;
    const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(target)
      : target.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const node = cardsRef.current?.querySelector(`[data-diff-path="${escaped}"]`);
    if (node instanceof HTMLElement) {
      node.scrollIntoView({ block: 'start' });
      pendingScrollPath.current = null;
    }
  }, [files, collapsedByPath, query]);

  return (
    <aside className={`thread-diff-panel${embedded ? ' is-embedded' : ''}`} data-testid="thread-diff-panel">
      {embedded ? null : (
        <header className="thread-detail-header">
          <h2>Workspace changes</h2>
          <button type="button" className="icon-btn" aria-label="Close diff" onClick={onClose}>×</button>
        </header>
      )}
      {phase === 'error' ? (
        <p className="thread-diff-error">{error}</p>
      ) : phase === 'ready' && files ? (
        <>
            <div className="thread-diff-toolbar" data-testid="thread-diff-toolbar">
              <div className="thread-diff-toolbar-selector">
                <GitCompare size={16} aria-hidden="true" />
                <PopoverPicklist
                  ariaLabel="Diff scope"
                  value={selection}
                  options={DIFF_SELECTION_OPTIONS}
                  onChange={setSelection}
                  searchable={false}
                  triggerClassName="thread-diff-scope-trigger"
                  minWidth={220}
                />
              </div>
              <span className="thread-diff-toolbar-summary" data-testid="thread-diff-toolbar-summary"
                title={`${formatDiffFilesLabel(stats.filesCount, listTruncated)} changed${listTruncated ? ' (totals for shown files)' : ''}`}>
                <DiffStatTally insertions={stats.insertions} deletions={stats.deletions} />
                {listTruncated ? <span> shown</span> : null}
              </span>
              {workspaceStatus?.branchName ? (
                <span className="thread-diff-branch" title={`On branch ${workspaceStatus.branchName}`}>
                  <GitBranch size={14} aria-hidden="true" />
                  <span>{workspaceStatus.branchName}</span>
                </span>
              ) : null}
              <div className="thread-diff-toolbar-actions">
                <details className="thread-diff-options" onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false;
                }} onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector('summary')?.focus();
                  }
                }}>
                  <summary className="thread-diff-toolbar-btn" aria-label="Diff display options" title="Diff display options"><MoreHorizontal size={18} /></summary>
                  <div className="thread-diff-options-menu">
                    <button type="button" onClick={() => setCollapsedByPath(collapseAllDiffCards(files, !allCollapsed))}>
                      {allCollapsed ? <ChevronsDown size={16} /> : <ChevronsUp size={16} />}
                      {allCollapsed ? 'Expand all files' : 'Collapse all files'}
                    </button>
                    <button type="button" aria-pressed={wrap} onClick={() => setWrap((current) => !current)}>
                      <TextWrap size={16} />{wrap ? 'Disable diff line wrap' : 'Wrap diff lines'}
                    </button>
                    <button type="button" aria-pressed={!splitView} onClick={() => setSplitView(false)}><Rows2 size={16} />Stacked diff view</button>
                    <button type="button" aria-pressed={splitView} onClick={() => setSplitView(true)}><Columns2 size={16} />Split diff view</button>
                  </div>
                </details>
                {workspaceStatus?.dirty ? <ThreadDiffCommit key={environmentId} environmentId={environmentId} onCommitted={() => setRefreshKey((key) => key + 1)} /> : null}
                <DiffToolbarButton label={showFiles ? 'Hide changed files' : 'Show changed files'} pressed={showFiles}
                  onClick={() => { setShowFiles((current) => !current); setQuery(''); }}>
                  {showFiles ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                </DiffToolbarButton>
              </div>
            </div>
            {files.length === 0 ? (
              <p className="thread-diff-empty">No changes.</p>
            ) : (
              <>
            {listTruncated ? (
              <p className="thread-diff-cap" role="status">
                Showing the first {files.length} changed files. Additional changes are omitted.
              </p>
            ) : null}
            <div className="thread-diff-workbench">
            <div className="thread-diff-cards" ref={cardsRef} data-testid="thread-diff-cards">
              {visibleFiles.length === 0 ? (
                <p className="thread-diff-empty">No matching files.</p>
              ) : visibleFiles.map((file) => {
                const collapsed = resolveDiffCardCollapsed(collapsedByPath[file.path], file, files.length);
                return (
                  <ThreadDiffFileCard
                    key={file.path}
                    file={file}
                    collapsed={collapsed}
                    patch={patches[file.path]}
                    eager={files.length <= DIFF_AUTO_COLLAPSE_FILE_THRESHOLD}
                    wrap={wrap}
                    splitView={splitView}
                    scrollRoot={cardsRef}
                    onToggleCollapsed={() => setCollapsedByPath((previous) => ({
                      ...previous,
                      [file.path]: !collapsed
                    }))}
                    onLoadPatch={() => loadPatch(file.path)}
                  />
                );
              })}
            </div>
            {showFiles ? <ThreadDiffFileNavigator files={visibleFiles} total={files.length} truncated={listTruncated}
              query={query} onQueryChange={setQuery} activePath={activePath} onSelect={(filePath) => {
                setActivePath(filePath);
                pendingScrollPath.current = filePath;
                setCollapsedByPath((previous) => ({ ...previous, [filePath]: false }));
              }} /> : null}
            </div>
              </>
            )}
        </>
      ) : (
        <ThreadDiffSkeleton />
      )}
    </aside>
  );
}

const DIFF_SKELETON_CARD_COUNT = 3;

export function ThreadDiffSkeleton({ count = DIFF_SKELETON_CARD_COUNT }: { count?: number }) {
  return (
    <div
      className="thread-diff-skeleton"
      data-testid="thread-diff-skeleton"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading diff</span>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="thread-diff-card is-skeleton" aria-hidden="true">
          <div className="thread-diff-card-header">
            <Skeleton className="thread-diff-skel thread-diff-skel-icon" />
            <Skeleton className="thread-diff-skel thread-diff-skel-path" />
            <Skeleton className="thread-diff-skel thread-diff-skel-stat" />
          </div>
          <div className="thread-diff-card-body thread-diff-skel-body">
            <Skeleton className="thread-diff-skel" />
            <Skeleton className="thread-diff-skel is-wide" />
            <Skeleton className="thread-diff-skel is-mid" />
            <Skeleton className="thread-diff-skel is-short" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ThreadDiffCardBodySkeleton() {
  return (
    <div className="thread-diff-skel-body" aria-hidden="true">
      <Skeleton className="thread-diff-skel" />
      <Skeleton className="thread-diff-skel is-wide" />
      <Skeleton className="thread-diff-skel is-mid" />
      <Skeleton className="thread-diff-skel is-short" />
    </div>
  );
}

function DiffStatTally({
  insertions,
  deletions,
  hideZero = false
}: {
  insertions: number;
  deletions: number;
  hideZero?: boolean;
}) {
  const showInsertions = !hideZero || insertions > 0;
  const showDeletions = !hideZero || deletions > 0;
  return (
    <span className="thread-diff-stat">
      {showInsertions ? <span className="is-add">+{formatDiffCount(insertions)}</span> : null}
      {showInsertions && showDeletions ? ' ' : null}
      {showDeletions ? <span className="is-del">-{formatDiffCount(deletions)}</span> : null}
    </span>
  );
}

export function ThreadDiffCardBody({
  bodyKind,
  file,
  patch,
  wrap = false,
  splitView = false,
  onLoadPatch
}: {
  bodyKind: ReturnType<typeof resolveDiffCardBodyKind>;
  file: Pick<DiffFileEntry, 'path' | 'additions' | 'deletions'>;
  patch: PatchCacheEntry | undefined;
  wrap?: boolean;
  splitView?: boolean;
  onLoadPatch: () => void;
}) {
  if (bodyKind === 'hidden') return null;
  return (
    <div className="thread-diff-card-body">
      {bodyKind === 'binary' ? (
        <p className="thread-diff-card-notice">Binary file — patch not shown.</p>
      ) : bodyKind === 'too_large' ? (
        <p className="thread-diff-card-notice">Too large to display.</p>
      ) : bodyKind === 'load_cta' ? (
        <p className="thread-diff-card-notice">
          {formatDiffStatsText({ added: file.additions, removed: file.deletions, hideZero: true }) || 'Changed file.'}
          {' '}
          <button type="button" className="thread-diff-card-load" onClick={onLoadPatch}>
            Load diff
          </button>
        </p>
      ) : bodyKind === 'error' && patch?.status === 'error' ? (
        <p className="thread-diff-card-notice is-error">
          {patch.error}
          {' '}
          <button type="button" className="thread-diff-card-load" onClick={onLoadPatch}>
            Retry
          </button>
        </p>
      ) : bodyKind === 'loading' ? (
        <ThreadDiffCardBodySkeleton />
      ) : bodyKind === 'empty' ? (
        <p className="thread-diff-card-notice">No renderable diff.</p>
      ) : patch?.status === 'ready' ? (
        <>
          {patch.truncated ? (
            <p className="thread-diff-card-notice">Patch truncated — showing the first portion of this file.</p>
          ) : null}
              <ThreadDiffHunkView
                path={file.path}
                patch={patch.patch}
                wrap={wrap}
                splitView={splitView}
              />
        </>
      ) : null}
    </div>
  );
}

function ThreadDiffFileCard({
  file,
  collapsed,
  patch,
  eager,
  wrap,
  splitView,
  scrollRoot,
  onToggleCollapsed,
  onLoadPatch
}: {
  file: DiffFileEntry;
  collapsed: boolean;
  patch: PatchCacheEntry | undefined;
  eager: boolean;
  wrap: boolean;
  splitView: boolean;
  scrollRoot: { current: HTMLDivElement | null };
  onToggleCollapsed: () => void;
  onLoadPatch: () => void;
}) {
  const [visible, setVisible] = useState(() => eager || typeof IntersectionObserver === 'undefined');
  const cardRef = useRef<HTMLElement>(null);
  const status = patchStatusOf(patch);
  const bodyKind = resolveDiffCardBodyKind({
    collapsed,
    binary: file.binary,
    loadMode: file.loadMode,
    patchStatus: status,
    patchEmpty: patch?.status === 'ready' && !patch.patch
  });
  const stats = diffCardHeaderStats(file);
  const label = formatDiffCardLabel(file);

  useEffect(() => {
    if (collapsed) {
      if (!eager) setVisible(false);
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const node = cardRef.current;
    const root = scrollRoot.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { root, rootMargin: '240px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [collapsed, eager, scrollRoot]);

  useEffect(() => {
    if (shouldAutoLoadPatch({
      collapsed,
      visible,
      binary: file.binary,
      loadMode: file.loadMode,
      patchStatus: status
    })) {
      onLoadPatch();
    }
  }, [collapsed, visible, file.binary, file.loadMode, status, onLoadPatch]);

  return (
    <article
      ref={cardRef}
      className={`thread-diff-card${collapsed ? ' is-collapsed' : ''}`}
      data-diff-path={file.path}
      data-testid="thread-diff-card"
    >
      <div className="thread-diff-card-header">
        <button
          type="button"
          className={`thread-diff-card-toggle${collapsed ? '' : ' is-open'}`}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <DiffFileIcon path={file.path} />
        <span className="thread-diff-card-path" title={label}>
          <span className="thread-diff-card-path-text">{label}</span>
        </span>
        <button
          type="button"
          className="thread-diff-card-copy"
          aria-label={`Copy path for ${label}`}
          onClick={() => {
            void navigator.clipboard?.writeText(file.path);
          }}
        >
          <Copy size={12} />
        </button>
        <DiffStatTally
          insertions={stats.insertions}
          deletions={stats.deletions}
          hideZero
        />
      </div>
      {bodyKind === 'hidden' || !visible ? null : (
        <ThreadDiffCardBody
          bodyKind={bodyKind}
          file={file}
          patch={patch}
          wrap={wrap}
          splitView={splitView}
          onLoadPatch={onLoadPatch}
        />
      )}
    </article>
  );
}
