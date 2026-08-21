import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Trash2, ExternalLink, X, Search, Plus, AtSign, BotMessageSquare } from 'lucide-react';

import type { Project, LibraryDoc, LibraryScope, LibrarySearchHit } from '@zana-ai/zcc-domain/product';
import { useLibrary, useUi } from '@/store';
import { AgentLauncher } from '@/components/AgentLauncher';
import { DocPreview } from './library/DocPreview.js';
import { LibraryTreeRows } from './library/LibraryTreeRows.js';
import { PromptModal } from '@/components/PromptModal';
import {
  buildLibraryTree,
  libraryBucketKey,
  libraryNodeKey,
  type LibraryTreeNode,
  type LibraryPhantomFolder
} from './libraryTree.js';

interface Props {
  project: Project;
}

// Width of the document list column. Persisted as a renderer-only UI pref under
// a cc.* localStorage key (same idiom as the other global UI prefs), not via
// IPC config — it's a per-machine layout preference, not app state.
const LIBRARY_LIST_MIN = 220;
const LIBRARY_LIST_MAX = 560;
const LIBRARY_LIST_DEFAULT = 300;
const LIBRARY_LIST_KEY = 'zcc.libraryListWidth';

// How many (most-used) tag chips to show before collapsing behind "+N more".
const TAG_COLLAPSE_LIMIT = 8;

function loadLibraryListWidth(): number {
  if (typeof localStorage === 'undefined') return LIBRARY_LIST_DEFAULT;
  const raw = Number(localStorage.getItem(LIBRARY_LIST_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return LIBRARY_LIST_DEFAULT;
  return Math.max(LIBRARY_LIST_MIN, Math.min(LIBRARY_LIST_MAX, raw));
}

type PromptState =
  | { kind: 'new-folder'; scope: LibraryScope; projectId?: string; parentRelPath: string }
  | { kind: 'new-doc'; scope: LibraryScope; projectId?: string; parentRelPath: string }
  | { kind: 'rename'; scope: LibraryScope; projectId?: string; relPath: string; isDir: boolean };

interface ContextMenuState {
  x: number;
  y: number;
  node: LibraryTreeNode;
}

export function LibraryView({ project }: Props) {
  const pushToast = useUi((s) => s.pushToast);
  // CRITICAL: select raw docs slice — inline filter/map infinite-loops React
  const allDocs = useLibrary((s) => s.docs);
  const loading = useLibrary((s) => s.loading);

  // The library is a single shared store spanning every scope, but this view is
  // always mounted scoped to ONE project (Workspace passes `project`). Show only
  // what belongs here: Global docs + this project's own docs — never another
  // project's. Everything downstream (tag cloud, search, tree) derives from
  // this scoped slice, so the "Global + current project" invariant holds
  // uniformly. `project.id` matches `doc.projectId` (the owning-project stamp).
  const docs = useMemo(
    () => allDocs.filter((d) => d.scope !== 'project' || d.projectId === project.id),
    [allDocs, project.id]
  );

  const [selectedDoc, setSelectedDoc] = useState<LibraryDoc | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Body-content matches for the current query, keyed by absPath. Populated by
  // the debounced main-process full-text search below; empty when the box is
  // clear. `bodySearching` drives the spinner hint while a scan is in flight.
  const [bodyHits, setBodyHits] = useState<Map<string, LibrarySearchHit>>(new Map());
  const [bodySearching, setBodySearching] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  // Tags collapse to the top few by default — the full set (dozens of chips)
  // is a wall that buries the doc tree. "Show all" opens a height-capped,
  // scrollable cloud; selected tags always stay visible regardless.
  const [tagsExpanded, setTagsExpanded] = useState(false);
  // After creating a new idea we don't yet have the doc in `docs` (it arrives
  // on the next library.onChanged push). Stash its id so the select-effect can
  // jump to it — and `startEditing` to open it straight in edit mode.
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);
  const [startEditing, setStartEditing] = useState(false);
  // Open the "new agent" launcher (project mode) prefilled with a reference to
  // the selected doc, so the user can spawn a fresh agent to act on it. Twin of
  // the inbox's "spawn an agent against this message" button.
  const [launcherOpen, setLauncherOpen] = useState(false);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [phantomFolders, setPhantomFolders] = useState<LibraryPhantomFolder[]>([]);

  // Resizable doc-list column. The width lives on the grid via an inline CSS
  // var; dragging the splitter rewrites it and persists to localStorage on
  // mouse-up. A ref mirrors the live value so the listeners don't restart.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [listWidth, setListWidth] = useState(loadLibraryListWidth);

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    document.body.classList.add('resizing-col');
    const left = rootRef.current?.getBoundingClientRect().left ?? 0;
    let latest = listWidth;
    const onMove = (ev: MouseEvent) => {
      latest = Math.max(
        LIBRARY_LIST_MIN,
        Math.min(LIBRARY_LIST_MAX, Math.round(ev.clientX - left))
      );
      setListWidth(latest);
    };
    const onUp = () => {
      document.body.classList.remove('resizing-col');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try {
        localStorage.setItem(LIBRARY_LIST_KEY, String(latest));
      } catch {
        /* localStorage write is best-effort */
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onResizeDoubleClick = () => {
    setListWidth(LIBRARY_LIST_DEFAULT);
    try {
      localStorage.setItem(LIBRARY_LIST_KEY, String(LIBRARY_LIST_DEFAULT));
    } catch {
      /* best-effort */
    }
  };

  // Collect unique tags with their doc counts (useMemo for stable ref). Sorted
  // most-used first (ties broken alphabetically) so the chips we surface first
  // are the ones worth filtering by.
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    docs.forEach((doc) => {
      doc.tags?.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
    });
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [docs]);

  // Full-text body search: the metadata filter below matches title/summary/tags
  // synchronously; body content lives on disk, so we ask main to scan it
  // (bounded) and merge the results. Debounced so a fast typist doesn't fan out
  // a scan per keystroke. Clearing the box resets the hit map immediately.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setBodyHits(new Map());
      setBodySearching(false);
      return;
    }
    let cancelled = false;
    setBodySearching(true);
    const t = setTimeout(() => {
      window.cc.library
        .search(q)
        .then((res) => {
          if (cancelled) return;
          setBodyHits(new Map(res.hits.map((h) => [h.absPath, h])));
        })
        .catch(() => {
          if (!cancelled) setBodyHits(new Map());
        })
        .finally(() => {
          if (!cancelled) setBodySearching(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [searchQuery]);

  // Filter docs by search query and selected tags (useMemo for stable ref)
  const filteredDocs = useMemo(() => {
    let filtered = docs;

    // Text search on title, summary, tags (sync) OR body content (from the
    // main-process full-text scan, keyed by absPath).
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (doc) =>
          doc.title.toLowerCase().includes(q) ||
          doc.summary?.toLowerCase().includes(q) ||
          doc.tags?.some((tag) => tag.toLowerCase().includes(q)) ||
          (doc.absPath ? bodyHits.has(doc.absPath) : false)
      );
    }

    // Tag filter
    if (selectedTags.size > 0) {
      filtered = filtered.filter((doc) =>
        doc.tags?.some((tag) => selectedTags.has(tag))
      );
    }

    return filtered;
  }, [docs, searchQuery, selectedTags, bodyHits]);

  // Real nested folder tree (Global bucket + this project's own bucket),
  // derived from each doc's relPath — same model + component as the global
  // cross-project LibraryPanel (see util/libraryTree.ts).
  const tree = useMemo(
    () => buildLibraryTree(filteredDocs, phantomFolders),
    [filteredDocs, phantomFolders]
  );

  useEffect(() => {
    if (phantomFolders.length === 0) return;
    setPhantomFolders((prev) =>
      prev.filter((pf) => {
        const bucketKey = libraryBucketKey(pf.scope, pf.projectId);
        return !docs.some(
          (d) =>
            libraryBucketKey(d.scope === 'project' ? 'project' : 'global', d.projectId) ===
              bucketKey && (d.relPath === pf.relPath || d.relPath.startsWith(pf.relPath + '/'))
        );
      })
    );
    // Only re-run when the underlying doc set changes, not on every phantom edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);

  // Expanded tree nodes (bucket roots + folders), by node key. Global bucket
  // starts open; the rest starts collapsed — the user opens what they want.
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['global']));
  const toggleNode = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Keep the selected doc's ancestor chain expanded so it's never hidden
  // behind a collapsed bucket/folder (matters for auto-select and the
  // post-"New idea" jump).
  useEffect(() => {
    if (!selectedDoc) return;
    const bucketKey = libraryBucketKey(
      selectedDoc.scope === 'project' ? 'project' : 'global',
      selectedDoc.projectId
    );
    const parts = selectedDoc.relPath.split('/').filter(Boolean);
    parts.pop();
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(bucketKey);
      for (let i = 1; i <= parts.length; i++) {
        next.add(libraryNodeKey(bucketKey, parts.slice(0, i).join('/')));
      }
      return next;
    });
  }, [selectedDoc]);

  // A freshly-created idea arrives via the onChanged push, not from add()'s
  // return value — once it shows up in docs, select it (and it opens in edit
  // mode via startEditing, consumed by DocPreview's key/prop below).
  useEffect(() => {
    if (!pendingSelectId) return;
    const match = docs.find((d) => d.id === pendingSelectId);
    if (match) {
      setSelectedDoc(match);
      setPendingSelectId(null);
    }
  }, [docs, pendingSelectId]);

  // Deep-link: another surface (the Inbox Overview's Ideas rollup) asked to
  // open a specific doc. Latch the id locally and clear the STORE key at once
  // so a re-render doesn't fight the user's next manual selection; then resolve
  // it against `docs` (which may still be loading on a cold mount) — clearing
  // the filters that could hide it and selecting it, which auto-expands its
  // ancestor chain via the selection effect. Twin of SchedulerPanel's
  // revealSchedule handling + the pendingSelectId "resolve once present" idiom.
  const revealLibraryDocId = useUi((s) => s.revealLibraryDocId);
  const [pendingRevealId, setPendingRevealId] = useState<string | null>(null);
  useEffect(() => {
    if (!revealLibraryDocId) return;
    setPendingRevealId(revealLibraryDocId);
    useUi.getState().clearRevealLibraryDoc();
  }, [revealLibraryDocId]);
  useEffect(() => {
    if (!pendingRevealId) return;
    const match = docs.find((d) => d.id === pendingRevealId);
    if (!match) return; // still loading / not in this project's scope — wait
    setSearchQuery('');
    setSelectedTags(new Set());
    setSelectedDoc(match);
    setPendingRevealId(null);
  }, [pendingRevealId, docs]);

  // Auto-select first doc if none selected. Skipped while a new idea OR a
  // deep-link reveal is pending so we don't briefly land on — and, on the cold
  // path where docs arrive after mount, get STUCK on — the wrong doc: both
  // pending latches resolve to a specific doc, and this effect must not race
  // them to filteredDocs[0] in the same commit.
  useEffect(() => {
    if (pendingSelectId || pendingRevealId) return;
    if (!selectedDoc && filteredDocs.length > 0) {
      setSelectedDoc([...filteredDocs].sort((a, b) => b.updatedAt - a.updatedAt)[0]);
    } else if (selectedDoc && !filteredDocs.find((d) => d.id === selectedDoc.id)) {
      setSelectedDoc(null);
    }
  }, [filteredDocs, selectedDoc, pendingSelectId, pendingRevealId]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  const onContext = (e: React.MouseEvent, node: LibraryTreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, node });
  };

  const handleNewFolder = (node: LibraryTreeNode) => {
    setPrompt({ kind: 'new-folder', scope: node.scope, projectId: node.projectId, parentRelPath: node.relPath });
  };

  const submitNewFolder = async (
    scope: LibraryScope,
    projectId: string | undefined,
    parentRelPath: string,
    rawName: string
  ) => {
    const name = rawName.trim();
    if (!name || name.includes('..') || name.includes('/')) {
      pushToast('Folder name cannot contain "/" or ".."', 'error');
      return;
    }
    const relPath = parentRelPath ? `${parentRelPath}/${name}` : name;
    const r = await window.cc.library.createFolder(scope, relPath, projectId);
    if (!r.ok) {
      pushToast(r.message ?? 'Failed to create folder', 'error');
      return;
    }
    setPhantomFolders((prev) => [...prev, { scope, projectId, relPath }]);
    const bucketKey = libraryBucketKey(scope, projectId);
    setExpanded((prev) => new Set(prev).add(bucketKey).add(libraryNodeKey(bucketKey, relPath)));
    pushToast('Folder created');
  };

  const handleNewDoc = (node: LibraryTreeNode) => {
    setPrompt({ kind: 'new-doc', scope: node.scope, projectId: node.projectId, parentRelPath: node.relPath });
  };

  const submitNewDoc = async (
    scope: LibraryScope,
    projectId: string | undefined,
    parentRelPath: string,
    rawName: string
  ) => {
    const name = rawName.trim();
    if (!name || name.includes('..') || name.includes('/')) {
      pushToast('Document name cannot contain "/" or ".."', 'error');
      return;
    }
    const fileName = /\.\w+$/.test(name) ? name : `${name}.md`;
    const relPath = parentRelPath ? `${parentRelPath}/${fileName}` : fileName;
    const title = fileName.replace(/\.\w+$/, '');
    const created = await window.cc.library.add({
      scope,
      projectId,
      relPath,
      title,
      content: fileName.endsWith('.md') ? `# ${title}\n\n` : '',
      source: { kind: 'user' }
    });
    if (!created) {
      pushToast('Failed to create document', 'error');
      return;
    }
    const bucketKey = libraryBucketKey(scope, projectId);
    setExpanded((prev) => new Set(prev).add(bucketKey).add(libraryNodeKey(bucketKey, parentRelPath)));
    setSearchQuery('');
    setSelectedTags(new Set());
    setStartEditing(fileName.endsWith('.md'));
    setPendingSelectId(created.id);
    pushToast('Document created');
  };

  const handleRename = (node: LibraryTreeNode) => {
    setPrompt({ kind: 'rename', scope: node.scope, projectId: node.projectId, relPath: node.relPath, isDir: node.kind === 'dir' });
  };

  const submitRename = async (
    scope: LibraryScope,
    projectId: string | undefined,
    relPath: string,
    rawNext: string
  ) => {
    const next = rawNext.trim();
    if (!next || next === relPath || next.includes('..')) {
      if (next.includes('..')) pushToast('Path cannot contain ".."', 'error');
      return;
    }
    const r = await window.cc.library.move(
      { scope, relPath, projectId },
      { scope, relPath: next, projectId }
    );
    if (!r.ok) {
      pushToast(r.message ?? 'Move failed', 'error');
      return;
    }
    pushToast('Moved');
    if (selectedDoc && selectedDoc.relPath === relPath && selectedDoc.projectId === projectId) {
      setSelectedDoc(null);
    }
  };

  const handleDeleteNode = async (node: LibraryTreeNode) => {
    const what = node.kind === 'dir' ? 'folder (and everything inside it)' : 'document';
    const label = node.kind === 'dir' ? node.name : node.doc?.title ?? node.name;
    if (!window.confirm(`Delete ${what} "${label}"? This cannot be undone.`)) return;
    const r = await window.cc.library.deleteEntry(node.scope, node.relPath, node.projectId);
    if (!r.ok) {
      pushToast(r.message ?? 'Delete failed', 'error');
      return;
    }
    pushToast('Deleted');
    if (node.kind === 'file' && selectedDoc?.relPath === node.relPath) {
      setSelectedDoc(null);
    } else if (node.kind === 'dir' && selectedDoc?.relPath.startsWith(node.relPath + '/')) {
      setSelectedDoc(null);
    }
    if (node.kind === 'dir') {
      const bucketKey = libraryBucketKey(node.scope, node.projectId);
      setPhantomFolders((prev) =>
        prev.filter(
          (pf) => libraryNodeKey(libraryBucketKey(pf.scope, pf.projectId), pf.relPath) !== libraryNodeKey(bucketKey, node.relPath)
        )
      );
    }
  };

  const handleReveal = async (scope: LibraryScope, projectId?: string) => {
    try {
      const result = await window.cc.library.reveal(scope, projectId);
      if (!result.ok) {
        pushToast(result.message ?? 'Failed to reveal directory', 'error');
      }
    } catch (err) {
      pushToast(`Reveal failed: ${err}`, 'error');
    }
  };

  // Copy a Claude-ready reference to the doc so it can be pasted straight into
  // a terminal / Claude session. We copy the absolute path as an `@`-mention
  // (Claude Code reads the file from it); fall back to the plain path if no
  // absPath is known.
  const handleCopyReference = async (doc: LibraryDoc) => {
    const ref = doc.absPath ? `@${doc.absPath}` : doc.relPath;
    try {
      await navigator.clipboard.writeText(ref);
      pushToast('Reference copied');
    } catch (err) {
      pushToast(`Copy failed: ${err}`, 'error');
    }
  };

  // Quick-capture: create a dated idea note (global scope, tagged `idea`) and
  // open it straight in edit mode. Electron disables window.prompt, so the
  // title isn't asked up front — it's derived from the first heading on save.
  const handleNewIdea = async () => {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(
      now.getMinutes()
    ).padStart(2, '0')}`;
    try {
      const created = await window.cc.library.add({
        scope: 'global',
        relPath: `ideas/${stamp}.md`,
        title: 'Untitled idea',
        content: '# Untitled idea\n\n',
        tags: ['idea'],
        source: { kind: 'user' }
      });
      if (created) {
        setSearchQuery('');
        setSelectedTags(new Set());
        setStartEditing(true);
        setPendingSelectId(created.id);
      } else {
        pushToast('Failed to create idea', 'error');
      }
    } catch (err) {
      pushToast(`Create failed: ${err}`, 'error');
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  return (
    <div
      ref={rootRef}
      className="explorer-view library-view"
      style={{ gridTemplateColumns: `${listWidth}px minmax(0, 1fr)` }}
    >
      {/* Left pane: doc tree */}
      <div className="explorer-tree">
        <div className="explorer-tree-header">
          <h3 className="explorer-tree-title">Documents</h3>
          <button
            type="button"
            className="library-new-idea"
            onClick={handleNewIdea}
            title="New idea — a dated, editable markdown note"
          >
            <Plus size={13} />
            <span>New idea</span>
          </button>
        </div>

        {/* Search box */}
        <div className="library-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Search title, summary, tags, content…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="library-search-clear"
              onClick={() => setSearchQuery('')}
              title="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Tag filter chips — collapsed to the top TAG_COLLAPSE_LIMIT by
            default (plus any active tags) so the cloud never buries the tree.
            "Show all" reveals the rest inside a height-capped scroll area. */}
        {allTags.length > 0 && (
          <div className={`library-tags ${tagsExpanded ? 'expanded' : ''}`}>
            {(tagsExpanded
              ? allTags
              : allTags.filter((t, i) => i < TAG_COLLAPSE_LIMIT || selectedTags.has(t.tag))
            ).map(({ tag, count }) => (
              <button
                key={tag}
                type="button"
                className={`library-tag-chip ${selectedTags.has(tag) ? 'active' : ''}`}
                onClick={() => toggleTag(tag)}
                title={`${count} document${count === 1 ? '' : 's'}`}
              >
                {tag}
                <span className="library-tag-count">{count}</span>
              </button>
            ))}
            {allTags.length > TAG_COLLAPSE_LIMIT && (
              <button
                type="button"
                className="library-tag-more"
                onClick={() => setTagsExpanded((v) => !v)}
              >
                {tagsExpanded ? 'Show less' : `+${allTags.length - TAG_COLLAPSE_LIMIT} more`}
              </button>
            )}
            {selectedTags.size > 0 && (
              <button
                type="button"
                className="library-tag-more"
                onClick={() => setSelectedTags(new Set())}
                title="Clear tag filters"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* Doc tree — real nested folders (Global bucket + this project's own
            bucket), same model + row component as the global LibraryPanel. */}
        <div className="explorer-tree-body library-tree">
          {loading ? (
            <div className="tree-loading">Loading…</div>
          ) : tree.length === 0 ? (
            <div className="tree-pane-empty">
              {docs.length === 0
                ? 'No documents yet'
                : bodySearching
                  ? 'Searching…'
                  : 'No matches'}
            </div>
          ) : (
            tree.map((bucketRoot) => (
              <LibraryTreeRows
                key={bucketRoot.key}
                nodes={[bucketRoot]}
                depth={0}
                expanded={expanded}
                selectedRelPath={selectedDoc?.relPath}
                selectedProjectId={selectedDoc?.projectId}
                onToggle={toggleNode}
                onSelect={setSelectedDoc}
                onContext={onContext}
              />
            ))
          )}
        </div>
      </div>

      {/* Splitter: drag to resize the list column, double-click to reset. */}
      <div
        className="library-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={LIBRARY_LIST_MIN}
        aria-valuemax={LIBRARY_LIST_MAX}
        aria-valuenow={listWidth}
        title="Drag to resize · double-click to reset"
        style={{ left: `${listWidth}px` }}
        onMouseDown={onResizeMouseDown}
        onDoubleClick={onResizeDoubleClick}
      />

      {/* Right pane: preview */}
      <div className="explorer-viewer library-viewer">
        {!selectedDoc ? (
          <div className="explorer-viewer-empty">
            <p>Select a document to preview</p>
          </div>
        ) : (
          <>
            <div className="explorer-viewer-header">
              <div className="explorer-viewer-path">
                {selectedDoc.title}
                <span className={`library-scope-badge ${selectedDoc.scope}`}>
                  {selectedDoc.scope === 'project' ? 'Project' : 'Global'}
                </span>
              </div>
              <div className="explorer-viewer-actions">
                <button
                  type="button"
                  onClick={() => setLauncherOpen(true)}
                  title="Spawn a new agent against this document"
                  aria-label="Spawn a new agent seeded with this document"
                >
                  <BotMessageSquare size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyReference(selectedDoc)}
                  title="Copy reference (@path) for use in a terminal / Claude session"
                  aria-label="Copy reference"
                >
                  <AtSign size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => handleReveal(selectedDoc.scope ?? 'global', selectedDoc.scope === 'project' ? selectedDoc.projectId : undefined)}
                  title="Reveal in Finder"
                >
                  <ExternalLink size={14} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleDeleteNode({
                      key: '',
                      name: selectedDoc.title,
                      kind: 'file',
                      scope: selectedDoc.scope ?? 'global',
                      projectId: selectedDoc.projectId,
                      relPath: selectedDoc.relPath,
                      doc: selectedDoc
                    })
                  }
                  title="Delete"
                  disabled={selectedDoc.id === ''}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {selectedDoc.tags && selectedDoc.tags.length > 0 && (
              <div className="library-viewer-tags">
                {selectedDoc.tags.map((tag) => (
                  <span key={tag} className="library-tag-chip">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {selectedDoc.source && (
              <div className="library-viewer-source">
                Source: {selectedDoc.source.kind}
                {selectedDoc.source.sessionId && ` · ${selectedDoc.source.sessionId.slice(0, 7)}`}
              </div>
            )}

            <DocPreview
              key={selectedDoc.id || selectedDoc.relPath}
              doc={selectedDoc}
              autoEdit={startEditing}
              onAutoEditConsumed={() => setStartEditing(false)}
            />
          </>
        )}
      </div>

      {menu && (
        <div
          className="tree-context-menu"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.node.kind === 'dir' && (
            <button
              onClick={() => {
                handleNewDoc(menu.node);
                setMenu(null);
              }}
            >
              New document…
            </button>
          )}
          {menu.node.kind === 'dir' && (
            <button
              onClick={() => {
                handleNewFolder(menu.node);
                setMenu(null);
              }}
            >
              New folder…
            </button>
          )}
          {!menu.node.isBucketRoot && (
            <button
              onClick={() => {
                handleRename(menu.node);
                setMenu(null);
              }}
            >
              Rename / move…
            </button>
          )}
          <button
            onClick={() => {
              void handleReveal(menu.node.scope, menu.node.projectId);
              setMenu(null);
            }}
          >
            Reveal in Finder
          </button>
          {!menu.node.isBucketRoot && (
            <button
              className="danger"
              onClick={() => {
                void handleDeleteNode(menu.node);
                setMenu(null);
              }}
            >
              {menu.node.kind === 'dir' ? 'Delete folder' : 'Delete file'}
            </button>
          )}
        </div>
      )}

      {prompt && prompt.kind === 'new-folder' && (
        <PromptModal
          title="New folder"
          label="Folder name"
          placeholder="findings"
          confirmLabel="Create"
          onSubmit={(name) => {
            const p = prompt;
            setPrompt(null);
            void submitNewFolder(p.scope, p.projectId, p.parentRelPath, name);
          }}
          onClose={() => setPrompt(null)}
        />
      )}
      {prompt && prompt.kind === 'new-doc' && (
        <PromptModal
          title="New document"
          hint="Add an extension (e.g. .md, .txt) to pick the type — defaults to a markdown note."
          label="Document name"
          placeholder="notes"
          confirmLabel="Create"
          onSubmit={(name) => {
            const p = prompt;
            setPrompt(null);
            void submitNewDoc(p.scope, p.projectId, p.parentRelPath, name);
          }}
          onClose={() => setPrompt(null)}
        />
      )}
      {prompt && prompt.kind === 'rename' && (
        <PromptModal
          title="Rename / move"
          hint={
            prompt.isDir
              ? 'Path is relative to the scope root — moving a folder moves everything inside it.'
              : 'Path is relative to the scope root.'
          }
          label="New path"
          initialValue={prompt.relPath}
          confirmLabel="Move"
          onSubmit={(next) => {
            const p = prompt;
            setPrompt(null);
            void submitRename(p.scope, p.projectId, p.relPath, next);
          }}
          onClose={() => setPrompt(null)}
        />
      )}

      {launcherOpen && selectedDoc && (
        <AgentLauncher
          project={project}
          initialPrompt={buildSpawnPrompt(selectedDoc)}
          onClose={() => setLauncherOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Prompt for a NEW agent spawned against a library document (the viewer's
 * "spawn an agent" button). References the doc by its absolute path as an
 * `@`-mention (Claude Code reads the file from it — same convention as the
 * "Copy reference" action), falling back to the relative path. The user can
 * edit it before launching.
 */
function buildSpawnPrompt(doc: LibraryDoc): string {
  const ref = doc.absPath ? `@${doc.absPath}` : doc.relPath;
  const parts: string[] = [
    'Act on the following document from this project’s library.',
    '',
    `Document: ${doc.title}`,
    ref
  ];
  if (doc.summary?.trim()) {
    parts.push('', 'Summary:', doc.summary.trim());
  }
  return parts.join('\n');
}
