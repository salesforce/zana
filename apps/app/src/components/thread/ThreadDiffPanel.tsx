import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, ChevronsDown, ChevronsUp, Columns2, Copy, Rows2, Search, TextWrap } from 'lucide-react';
import { formatDiffCount, formatDiffStatsText } from '@zana-ai/zcc-thread-view';
import { product } from '../../lib/product-client.js';
import { SecondaryPanelSelectionActions } from './secondary-panel/SecondaryPanelSelectionActions.js';
import { PopoverPicklist } from '../ui/PopoverPicklist.js';
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
  embedded,
  threadId
}: {
  environmentId: string;
  path: string | null;
  onClose: () => void;
  embedded?: boolean;
  threadId?: string;
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
  const cardsRef = useRef<HTMLDivElement>(null);
  const pendingScrollPath = useRef<string | null>(path);
  const target = useMemo(() => diffTargetForSelection(selection), [selection]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setFiles(null);
    setPatches({});
    setCollapsedByPath({});
    pendingScrollPath.current = path;
    void product.environments.diffFiles(environmentId, target).then((next) => {
      if (cancelled) return;
      setFiles(next.files);
      setListTruncated(next.truncated);
      setPatches(seedPatchCache(next.initialPatches));
      if (path && next.files.some((file) => file.path === path)) {
        setCollapsedByPath({ [path]: false });
      }
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load diff');
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, path, target]);

  const loadPatch = useCallback((filePath: string) => {
    setPatches((previous) => {
      const current = previous[filePath];
      if (current?.status === 'loading' || current?.status === 'ready') return previous;
      return { ...previous, [filePath]: { status: 'loading' } };
    });
    void product.environments.diffPatch(environmentId, { paths: [filePath], target }).then((next) => {
      const loaded = next.patches[0] ?? { path: filePath, patch: '', truncated: false };
      setPatches((previous) => ({
        ...previous,
        [filePath]: { status: 'ready', patch: loaded.patch, truncated: loaded.truncated }
      }));
    }).catch((err: unknown) => {
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
  }, [files, collapsedByPath]);

  return (
    <SecondaryPanelSelectionActions threadId={threadId}>
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
        files.length === 0 ? (
          <p className="thread-diff-empty">No changes.</p>
        ) : (
          <>
            <div className="thread-diff-toolbar" data-testid="thread-diff-toolbar">
              <div className="thread-diff-toolbar-selector">
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
              <label className="thread-diff-toolbar-search">
                <Search size={12} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search files…"
                  aria-label="Search changed files"
                />
              </label>
              <div className="thread-diff-toolbar-details">
                <span className="thread-diff-toolbar-summary" data-testid="thread-diff-toolbar-summary">
                  {listTruncated ? (
                    <>
                      {formatDiffFilesLabel(stats.filesCount, true)}
                      {stats.insertions > 0 || stats.deletions > 0 ? (
                        <>
                          {' · shown '}
                          <DiffStatTally insertions={stats.insertions} deletions={stats.deletions} />
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {formatDiffFilesLabel(stats.filesCount)}
                      {stats.insertions > 0 || stats.deletions > 0 ? (
                        <>
                          {', '}
                          <DiffStatTally insertions={stats.insertions} deletions={stats.deletions} />
                        </>
                      ) : null}
                    </>
                  )}
                </span>
                <div className="thread-diff-toolbar-actions">
                  <DiffToolbarButton
                    label={allCollapsed ? 'Expand all files' : 'Collapse all files'}
                    onClick={() => setCollapsedByPath(collapseAllDiffCards(files, !allCollapsed))}
                  >
                    {allCollapsed ? <ChevronsDown size={16} /> : <ChevronsUp size={16} />}
                  </DiffToolbarButton>
                  <DiffToolbarButton
                    label={wrap ? 'Disable diff line wrap' : 'Wrap diff lines'}
                    pressed={wrap}
                    onClick={() => setWrap((current) => !current)}
                  >
                    <TextWrap size={16} />
                  </DiffToolbarButton>
                  <div className="thread-diff-mode" role="tablist" aria-label="Diff view mode">
                    <DiffToolbarButton
                      label="Stacked diff view"
                      pressed={!splitView}
                      onClick={() => setSplitView(false)}
                    >
                      <Rows2 size={16} />
                    </DiffToolbarButton>
                    <DiffToolbarButton
                      label="Split diff view"
                      pressed={splitView}
                      onClick={() => setSplitView(true)}
                    >
                      <Columns2 size={16} />
                    </DiffToolbarButton>
                  </div>
                </div>
              </div>
            </div>
            {listTruncated ? (
              <p className="thread-diff-cap" role="status">
                Showing the first {files.length} changed files. Additional changes are omitted.
              </p>
            ) : null}
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
          </>
        )
      ) : (
        <ThreadDiffSkeleton />
      )}
    </aside>
    </SecondaryPanelSelectionActions>
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
            <span className="thread-diff-skel thread-diff-skel-icon" />
            <span className="thread-diff-skel thread-diff-skel-path" />
            <span className="thread-diff-skel thread-diff-skel-stat" />
          </div>
          <div className="thread-diff-card-body thread-diff-skel-body">
            <span className="thread-diff-skel" />
            <span className="thread-diff-skel is-wide" />
            <span className="thread-diff-skel is-mid" />
            <span className="thread-diff-skel is-short" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ThreadDiffCardBodySkeleton() {
  return (
    <div className="thread-diff-skel-body" aria-hidden="true">
      <span className="thread-diff-skel" />
      <span className="thread-diff-skel is-wide" />
      <span className="thread-diff-skel is-mid" />
      <span className="thread-diff-skel is-short" />
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
          hideZero={stats.hideZero}
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
