import { product } from '../lib/product-client.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  FileDiff,
  GitBranch,
  Search,
  ArrowUp,
  ArrowDown,
  Folder,
  FolderOpen,
  FileCode2
} from 'lucide-react';
import type { GitFileCode, GitShowResult, FsReadResult } from '@zana-ai/zcc-domain/product';
import { DiffViewer } from './DiffViewer.js';
import { languageFromPath } from '../lib/monacoLanguage.js';
import { ThreadDiffSkeleton } from './thread/ThreadDiffPanel.js';
import { StencilLines } from './ui/Skeleton.js';

/**
 * The "Changes" surface of the agent-inspector modal: a live view of what the
 * agent has done to its working tree, shown beside (well — instead of) the
 * terminal so you can review the diff without leaving the modal or opening the
 * Explorer.
 *
 * It reads the git status of the SESSION's cwd (main confines + shells `git`;
 * see `src/main/git.ts`), lists the changed files, and renders a read-only
 * side-by-side {@link DiffViewer} (HEAD ↔ working tree) for each changed file.
 * Both blobs come through the same trusted IPC the Explorer uses
 * (`git.showHead` + `fs.readFile`), so nothing new crosses the main boundary.
 *
 * SCOPED TO THIS AGENT: git status returns the whole repo's uncommitted files —
 * i.e. everything anyone (other agents, the human, other branches' leftovers)
 * touched in the working tree, which is NOT what this modal is about. So when a
 * write-set is supplied (`scope` — the absolute paths this agent actually
 * Wrote/Edited, from its transcript-derived {@link SessionStats.files}), we
 * intersect the status list with it and show only the files THIS agent changed.
 * `scope === null` (a shell / non-claude session has no transcript signal) falls
 * back to the full working tree — the honest best-effort when we can't attribute.
 *
 * Deliberately git-only + local-only: a remote (SSH) project has no local git
 * status, and a non-repo cwd has nothing to diff — both render an empty state
 * rather than error. It polls status on a gentle interval while the agent is
 * live (it's actively editing) and reads once for an exited agent.
 */

const CODE_LABEL: Record<GitFileCode, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  '?': 'Untracked',
  C: 'Conflict'
};

// Poll cadence for the changed-file list while the agent is live. Matches the
// insights poll (4s) — a live-ish read, not per-frame; each expanded card pulls
// its diff lazily and caches it.
const STATUS_POLL_MS = 4_000;
interface Props {
  /** The agent's working directory — the repo we diff. */
  cwd: string;
  /** Remote (SSH) project → no local git; render the unsupported state. */
  isRemote: boolean;
  /** Exited agents' trees are static: read once, don't poll. */
  exited: boolean;
  /**
   * Absolute paths this agent actually WROTE (its transcript write-set). The
   * changed-file list is intersected with this so the modal shows only what
   * THIS agent changed, not the whole repo's dirty tree. `null` ⇒ no write-set
   * signal (e.g. a shell session) ⇒ show the full working tree unfiltered.
   */
  scope: Set<string> | null;
}

interface ChangedFile {
  path: string;
  code: GitFileCode;
}

type DiffCache = { loading: boolean; head: GitShowResult | null; work: FsReadResult | null };

interface TreeDir {
  name: string;
  path: string;
  dirs: Map<string, TreeDir>;
  files: ChangedFile[];
}

type TreeRow =
  | { kind: 'dir'; key: string; name: string; path: string; depth: number; count: number }
  | { kind: 'file'; key: string; depth: number; file: ChangedFile };

function makeDir(path: string, name: string): TreeDir {
  return { name, path, dirs: new Map(), files: [] };
}

function buildTree(files: ChangedFile[]): TreeDir {
  const root = makeDir('', '');
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i]!;
      const dirPath = cur.path ? `${cur.path}/${name}` : name;
      let next = cur.dirs.get(name);
      if (!next) {
        next = makeDir(dirPath, name);
        cur.dirs.set(name, next);
      }
      cur = next;
    }
    cur.files.push(file);
  }
  return root;
}

function countTreeFiles(dir: TreeDir): number {
  let n = dir.files.length;
  for (const child of dir.dirs.values()) n += countTreeFiles(child);
  return n;
}

function flattenTree(root: TreeDir, collapsed: Record<string, true>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (dir: TreeDir, depth: number): void => {
    const childDirs = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
    const childFiles = [...dir.files].sort((a, b) => a.path.localeCompare(b.path));
    for (const child of childDirs) {
      rows.push({
        kind: 'dir',
        key: `dir:${child.path}`,
        name: child.name,
        path: child.path,
        depth,
        count: countTreeFiles(child)
      });
      if (!collapsed[child.path]) walk(child, depth + 1);
    }
    for (const file of childFiles) {
      rows.push({
        kind: 'file',
        key: `file:${file.path}`,
        depth,
        file
      });
    }
  };
  walk(root, 0);
  return rows;
}

export function AgentDiffPanel({ cwd, isRemote, exited, scope }: Props) {
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, true>>({});
  const [fileDiffs, setFileDiffs] = useState<Record<string, DiffCache>>({});
  const inFlightRef = useRef<Map<string, Promise<void>>>(new Map());
  const fileDiffsRef = useRef(fileDiffs);
  fileDiffsRef.current = fileDiffs;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  // A stable, content-derived key for the write-set. Callers pass a fresh Set
  // each render, so we can't depend on its identity (it'd re-arm the poll every
  // render); the sorted-path join changes only when the actual write-set does.
  const scopeKey = scope ? [...scope].sort().join('\n') : null;

  const loadStatus = useCallback(
    async () => {
      // Pass the write-set to git as a pathspec scope: git's default untracked
      // handling collapses a directory of NEW files into a single `?? dir/`
      // entry that never matches an individual write-set path, so without this
      // every file the agent CREATED silently drops out of the intersection
      // below (the modal then shows "hasn't changed any files" while the
      // sidebar — transcript-only — is full). Scoping also keeps the status
      // walk fast on big monorepos. main confines the paths to the repo.
      const scopeArg = scopeRef.current ? [...scopeRef.current] : undefined;
      const status = await product.git.status(cwd, scopeArg).catch(() => null);
      if (!status || !status.files) {
        setFiles([]);
        setBranch(status?.branch ?? null);
        setCollapsedDirs({});
        setSelectedPath(null);
        setFileDiffs({});
        return [];
      }
      setBranch(status.branch);
      // Scope to this agent's write-set when we have one: git status is
      // repo-wide, so without this the modal shows every dirty file on the
      // branch, not what this agent touched. `scope === null` ⇒ no signal ⇒
      // full tree. `status.files` keys and the scope set are both absolute
      // paths, so they intersect directly.
      const list: ChangedFile[] = Object.entries(status.files)
        .filter(([path]) => !scopeRef.current || scopeRef.current.has(path))
        .map(([path, code]) => ({ path, code }))
        .sort((a, b) => a.path.localeCompare(b.path));
      setFiles(list);
      const live = new Set(list.map((f) => f.path));
      setFileDiffs((prev) => {
        const next: Record<string, DiffCache> = {};
        for (const path of Object.keys(prev)) if (live.has(path)) next[path] = prev[path];
        return next;
      });
      return list;
    },
    // scopeKey stands in for `scope` (whose identity is unstable) — the closure
    // reads `scope` but only its CONTENTS matter, and those are captured by key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cwd, scopeKey]
  );

  const ensureDiffLoaded = useCallback(async (path: string, force = false) => {
    const inflight = inFlightRef.current.get(path);
    if (inflight) return inflight;
    const current = fileDiffsRef.current[path];
    if (!force && current && !current.loading) return;
    setFileDiffs((prev) => ({
      ...prev,
      [path]: { loading: true, head: prev[path]?.head ?? null, work: prev[path]?.work ?? null }
    }));
    const run = Promise.all([
      product.git.showHead(path).catch(() => null),
      product.fs.readFile(path).catch(() => null)
    ])
      .then(([head, work]) => {
        setFileDiffs((prev) => ({ ...prev, [path]: { loading: false, head, work } }));
      })
      .finally(() => {
        inFlightRef.current.delete(path);
      });
    inFlightRef.current.set(path, run);
    return run;
  }, []);

  // Poll the changed-file list while mounted (skip entirely for remote).
  useEffect(() => {
    if (isRemote) return;
    let alive = true;
    const pull = () => {
      if (!alive) return;
      void loadStatus();
    };
    pull();
    if (exited) return () => { alive = false; };
    const timer = setInterval(pull, STATUS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [loadStatus, isRemote, exited]);

  const manualRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const nextFiles = await loadStatus();
      const keepSelected =
        selectedPath && nextFiles.some((f) => f.path === selectedPath) ? selectedPath : nextFiles[0]?.path ?? null;
      setSelectedPath(keepSelected);
      if (keepSelected) await ensureDiffLoaded(keepSelected, true);
    } finally {
      setRefreshing(false);
    }
  };

  const filteredFiles = useMemo(() => {
    const list = files ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, query]);
  const treeRoot = useMemo(() => buildTree(filteredFiles), [filteredFiles]);
  const treeRows = useMemo(() => flattenTree(treeRoot, collapsedDirs), [treeRoot, collapsedDirs]);
  const fileRows = useMemo(
    () => treeRows.filter((row): row is Extract<TreeRow, { kind: 'file' }> => row.kind === 'file'),
    [treeRows]
  );

  useEffect(() => {
    if (!filteredFiles.length) {
      setSelectedPath(null);
      return;
    }
    if (!selectedPath || !filteredFiles.some((f) => f.path === selectedPath)) {
      setSelectedPath(filteredFiles[0]!.path);
    }
  }, [filteredFiles, selectedPath]);

  useEffect(() => {
    if (!selectedPath) return;
    void ensureDiffLoaded(selectedPath);
    const idx = fileRows.findIndex((r) => r.file.path === selectedPath);
    if (idx >= 0) {
      const near = [fileRows[idx - 1]?.file.path, fileRows[idx + 1]?.file.path].filter(Boolean) as string[];
      for (const path of near) void ensureDiffLoaded(path);
    }
  }, [selectedPath, ensureDiffLoaded, fileRows]);

  const selectedFile = selectedPath ? filteredFiles.find((f) => f.path === selectedPath) ?? null : null;
  const selectedDiff = selectedPath ? fileDiffs[selectedPath] : undefined;
  const selectedIndex = selectedPath ? fileRows.findIndex((r) => r.file.path === selectedPath) : -1;
  const canPrev = selectedIndex > 0;
  const canNext = selectedIndex >= 0 && selectedIndex < fileRows.length - 1;
  const setSelectionByOffset = (offset: -1 | 1) => {
    if (selectedIndex < 0) return;
    const row = fileRows[selectedIndex + offset];
    if (row) setSelectedPath(row.file.path);
  };
  const toggleDir = (path: string) =>
    setCollapsedDirs((prev) => {
      if (prev[path]) {
        const { [path]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [path]: true };
    });
  const collapseAllDirs = () => {
    const next: Record<string, true> = {};
    for (const row of treeRows) if (row.kind === 'dir') next[row.path] = true;
    setCollapsedDirs(next);
  };
  const expandAllDirs = () => setCollapsedDirs({});

  if (isRemote) {
    return (
      <div className="agent-diff-empty">
        <FileDiff size={28} strokeWidth={1.5} />
        <p>Changes aren't available for remote projects.</p>
      </div>
    );
  }

  if (files === null) {
    return <ThreadDiffSkeleton />;
  }

  if (files.length === 0) {
    // Distinguish "agent changed nothing" from "repo is clean": when we're
    // scoping to this agent's write-set the empty state is about the agent,
    // not the whole tree (which may well be dirty from other work).
    return (
      <div className="agent-diff-empty">
        <FileDiff size={28} strokeWidth={1.5} />
        <p>
          {scope
            ? "This agent hasn't changed any files yet."
            : 'No uncommitted changes in the working tree.'}
        </p>
      </div>
    );
  }

  return (
    <div className="agent-diff agent-diff-tree-layout">
      <div className="agent-diff-list-head">
        <span className="agent-diff-branch" title="Current branch">
          <GitBranch size={12} />
          {branch ?? 'detached'}
        </span>
        <button
          type="button"
          className="agent-diff-refresh"
          onClick={manualRefresh}
          disabled={refreshing}
          title="Refresh changes"
          aria-label="Refresh changes"
        >
          <RefreshCw size={12} className={refreshing ? 'spinning' : ''} />
        </button>
      </div>
      <div className="agent-diff-tree-pane">
        <div className="agent-diff-tree-toolbar">
          <label className="agent-diff-tree-search">
            <Search size={12} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter files..."
              aria-label="Filter changed files"
            />
          </label>
          <div className="agent-diff-tree-actions">
            <button type="button" className="agent-diff-tree-btn" onClick={expandAllDirs}>
              Expand
            </button>
            <button type="button" className="agent-diff-tree-btn" onClick={collapseAllDirs}>
              Collapse
            </button>
          </div>
        </div>
        <div className="agent-diff-tree-list" role="tree" aria-label="Changed files">
          {treeRows.length === 0 ? (
            <div className="agent-diff-empty-inline">No matching files.</div>
          ) : (
            treeRows.map((row) => {
              if (row.kind === 'dir') {
                const isCollapsed = !!collapsedDirs[row.path];
                return (
                  <button
                    key={row.key}
                    type="button"
                    className="agent-diff-tree-row agent-diff-tree-row--dir"
                    style={{ paddingLeft: `${8 + row.depth * 14}px` }}
                    onClick={() => toggleDir(row.path)}
                    aria-expanded={!isCollapsed}
                    role="treeitem"
                  >
                    <span className="agent-diff-acc-toggle">
                      {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    </span>
                    <span className="agent-diff-tree-dir-icon" aria-hidden="true">
                      {isCollapsed ? <Folder size={12} /> : <FolderOpen size={12} />}
                    </span>
                    <span className="agent-diff-tree-dir">{row.name}</span>
                    <span className="agent-diff-tree-count">{row.count}</span>
                  </button>
                );
              }
              const file = row.file;
              const code = file.code === '?' ? 'U' : file.code;
              const name = file.path.split('/').pop() || file.path;
              const dir =
                file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
              const isSelected = selectedPath === file.path;
              return (
                <button
                  key={row.key}
                  type="button"
                  className={`agent-diff-tree-row agent-diff-tree-row--file ${isSelected ? 'is-selected' : ''}`}
                  style={{ paddingLeft: `${8 + row.depth * 14}px` }}
                  onClick={() => setSelectedPath(file.path)}
                  title={file.path}
                  role="treeitem"
                  aria-selected={isSelected}
                >
                  <span className={`agent-diff-code code-${code}`}>{code}</span>
                  <span className="agent-diff-tree-file-icon" aria-hidden="true">
                    <FileCode2 size={12} />
                  </span>
                  <span className="agent-diff-tree-file">{name}</span>
                  <span className="agent-diff-tree-path">{dir || 'root'}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
      <div className="agent-diff-preview">
        <div className="agent-diff-preview-head">
          <span className="agent-diff-preview-title">
            {selectedFile ? selectedFile.path : 'Select a file'}
          </span>
          <div className="agent-diff-preview-nav">
            <button
              type="button"
              className="agent-diff-tree-btn"
              onClick={() => setSelectionByOffset(-1)}
              disabled={!canPrev}
              aria-label="Previous file"
            >
              <ArrowUp size={12} />
            </button>
            <button
              type="button"
              className="agent-diff-tree-btn"
              onClick={() => setSelectionByOffset(1)}
              disabled={!canNext}
              aria-label="Next file"
            >
              <ArrowDown size={12} />
            </button>
          </div>
        </div>
        <div className="agent-diff-preview-body">
          {!selectedFile ? (
            <div className="agent-diff-empty-inline">Select a changed file to preview its diff.</div>
          ) : !selectedDiff || selectedDiff.loading ? (
            <StencilLines label="Loading diff" widths={['100%', '93%', '87%']} />
          ) : selectedDiff.head?.binary || selectedDiff.work?.binary ? (
            <div className="agent-diff-empty-inline">
              {CODE_LABEL[selectedFile.code]} — binary file, no text diff.
            </div>
          ) : (
            <DiffViewer
              key={selectedFile.path}
              path={selectedFile.path}
              language={languageFromPath(selectedFile.path)}
              original={selectedDiff.head?.notInHead ? '' : selectedDiff.head?.content ?? ''}
              modified={selectedDiff.work?.content ?? ''}
              compact
            />
          )}
        </div>
      </div>
    </div>
  );
}
