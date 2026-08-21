import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { RefreshCw, Search, X, Trash2, ExternalLink, AtSign, BotMessageSquare } from 'lucide-react';

import type { LibraryDoc, LibraryScope } from '@shared/types';
import { useLibrary, useUi, useData } from '../store';
import { AgentLauncher } from '../components/AgentLauncher';
import { PromptModal } from '../components/PromptModal';
import { DocPreview } from './library/DocPreview';
import { LibraryTreeRows } from './library/LibraryTreeRows';
import {
  buildLibraryTree,
  libraryBucketKey,
  libraryNodeKey,
  type LibraryTreeNode,
  type LibraryPhantomFolder
} from './libraryTree';

// Width of the folder-tree column. Persisted like LibraryView's own list
// width, under a distinct key — this is a different panel with its own layout.
const TREE_MIN = 240;
const TREE_MAX = 620;
const TREE_DEFAULT = 320;
const TREE_KEY = 'zcc.libraryPanelTreeWidth';

function loadTreeWidth(): number {
  if (typeof localStorage === 'undefined') return TREE_DEFAULT;
  const raw = Number(localStorage.getItem(TREE_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return TREE_DEFAULT;
  return Math.max(TREE_MIN, Math.min(TREE_MAX, raw));
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

/**
 * Global cross-project Library — one folder tree spanning every scope
 * (Global + every project with docs), with real create-folder / rename-move /
 * delete actions. The per-project `LibraryView` (still scope-bucket-flat)
 * stays as the project-scoped twin; this panel is the "see everything, one
 * place" surface the left-nav Library entry opens.
 */
export function LibraryPanel() {
  const pushToast = useUi((s) => s.pushToast);
  const docs = useLibrary((s) => s.docs);
  const loading = useLibrary((s) => s.loading);
  const projects = useData((s) => s.projects);

  const [selectedDoc, setSelectedDoc] = useState<LibraryDoc | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['global']));
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [phantomFolders, setPhantomFolders] = useState<LibraryPhantomFolder[]>([]);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [startEditing, setStartEditing] = useState(false);
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [treeWidth, setTreeWidth] = useState(loadTreeWidth);

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter(
      (doc) =>
        doc.title.toLowerCase().includes(q) ||
        doc.relPath.toLowerCase().includes(q) ||
        doc.summary?.toLowerCase().includes(q) ||
        doc.tags?.some((tag) => tag.toLowerCase().includes(q))
    );
  }, [docs, searchQuery]);

  const tree = useMemo(
    () => buildLibraryTree(filteredDocs, phantomFolders),
    [filteredDocs, phantomFolders]
  );

  // Drop a phantom the instant a real doc materializes the same dir (or the
  // bucket it lived in disappears from the current filter) — otherwise a
  // stale empty-folder placeholder would linger after e.g. a search clears it
  // out of view and back in.
  useEffect(() => {
    if (phantomFolders.length === 0) return;
    setPhantomFolders((prev) =>
      prev.filter((pf) => {
        const bucketKey = libraryBucketKey(pf.scope, pf.projectId);
        return docs.some(
          (d) =>
            libraryBucketKey(d.scope === 'project' ? 'project' : 'global', d.projectId) ===
              bucketKey && (d.relPath === pf.relPath || d.relPath.startsWith(pf.relPath + '/'))
        ) === false;
      })
    );
    // Only re-run when the underlying doc set changes, not on every phantom edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Keep the selected doc's ancestor chain expanded so a selection (search
  // clear, new-idea, reveal) is never hidden behind a collapsed folder.
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

  // A freshly-created idea/folder arrives via the onChanged push, not synchronously.
  useEffect(() => {
    if (!pendingSelectId) return;
    const match = docs.find((d) => d.id === pendingSelectId);
    if (match) {
      setSelectedDoc(match);
      setPendingSelectId(null);
    }
  }, [docs, pendingSelectId]);

  // Deep-link: another surface asked to reveal a specific doc id.
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
    if (!match) return;
    setSearchQuery('');
    setSelectedDoc(match);
    setPendingRevealId(null);
  }, [pendingRevealId, docs]);

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

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    document.body.classList.add('resizing-col');
    const left = rootRef.current?.getBoundingClientRect().left ?? 0;
    let latest = treeWidth;
    const onMove = (ev: MouseEvent) => {
      latest = Math.max(TREE_MIN, Math.min(TREE_MAX, Math.round(ev.clientX - left)));
      setTreeWidth(latest);
    };
    const onUp = () => {
      document.body.classList.remove('resizing-col');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try {
        localStorage.setItem(TREE_KEY, String(latest));
      } catch {
        /* best-effort */
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onResizeDoubleClick = () => {
    setTreeWidth(TREE_DEFAULT);
    try {
      localStorage.setItem(TREE_KEY, String(TREE_DEFAULT));
    } catch {
      /* best-effort */
    }
  };

  const onContext = (e: React.MouseEvent, node: LibraryTreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, node });
  };

  const handleNewFolder = (node: LibraryTreeNode) => {
    setPrompt({
      kind: 'new-folder',
      scope: node.scope,
      projectId: node.projectId,
      parentRelPath: node.relPath
    });
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
    setPrompt({
      kind: 'new-doc',
      scope: node.scope,
      projectId: node.projectId,
      parentRelPath: node.relPath
    });
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
    setStartEditing(fileName.endsWith('.md'));
    setPendingSelectId(created.id);
    pushToast('Document created');
  };

  const handleRename = (node: LibraryTreeNode) => {
    setPrompt({
      kind: 'rename',
      scope: node.scope,
      projectId: node.projectId,
      relPath: node.relPath,
      isDir: node.kind === 'dir'
    });
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
    if (selectedDoc && selectedDoc.relPath === relPath) {
      // The moved doc's fresh copy arrives via onChanged; select-by-id once it lands.
      const stillHere = docs.find((d) => d.relPath === next && d.projectId === projectId);
      if (stillHere) setSelectedDoc(stillHere);
      else setSelectedDoc(null);
    }
  };

  const handleDelete = async (node: LibraryTreeNode) => {
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
        prev.filter((pf) => libraryNodeKey(libraryBucketKey(pf.scope, pf.projectId), pf.relPath) !== libraryNodeKey(bucketKey, node.relPath))
      );
    }
  };

  const handleReveal = async (node: LibraryTreeNode) => {
    try {
      const result = await window.cc.library.reveal(node.scope, node.projectId);
      if (!result.ok) pushToast(result.message ?? 'Failed to reveal directory', 'error');
    } catch (err) {
      pushToast(`Reveal failed: ${err}`, 'error');
    }
  };

  const handleCopyReference = async (doc: LibraryDoc) => {
    const ref = doc.absPath ? `@${doc.absPath}` : doc.relPath;
    try {
      await navigator.clipboard.writeText(ref);
      pushToast('Reference copied');
    } catch (err) {
      pushToast(`Copy failed: ${err}`, 'error');
    }
  };

  const launcherProject = useMemo(
    () => (selectedDoc?.projectId ? projects.find((p) => p.id === selectedDoc.projectId) : undefined),
    [projects, selectedDoc]
  );

  return (
    <div
      ref={rootRef}
      className="explorer-view library-view library-panel"
      style={{ gridTemplateColumns: `${treeWidth}px minmax(0, 1fr)` }}
    >
      <div className="explorer-tree">
        <div className="explorer-tree-header">
          <span className="explorer-tree-title">Library</span>
          <button
            type="button"
            className="opener-btn"
            title="Refresh"
            onClick={() => window.cc.library.list().then((d) => useLibrary.setState({ docs: d }))}
          >
            <RefreshCw size={13} />
          </button>
        </div>

        <div className="library-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Search title, path, tags…"
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

        <div className="explorer-tree-body library-tree">
          {loading ? (
            <div className="tree-loading">Loading…</div>
          ) : tree.length === 0 ? (
            <div className="tree-pane-empty">
              {docs.length === 0 ? 'No documents yet' : 'No matches'}
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
                onToggle={toggle}
                onSelect={setSelectedDoc}
                onContext={onContext}
              />
            ))
          )}
        </div>
      </div>

      <div
        className="library-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={TREE_MIN}
        aria-valuemax={TREE_MAX}
        aria-valuenow={treeWidth}
        title="Drag to resize · double-click to reset"
        style={{ left: `${treeWidth}px` }}
        onMouseDown={onResizeMouseDown}
        onDoubleClick={onResizeDoubleClick}
      />

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
                  {selectedDoc.scope === 'project' ? selectedDoc.projectName ?? 'Project' : 'Global'}
                </span>
              </div>
              <div className="explorer-viewer-actions">
                <button
                  type="button"
                  onClick={() => setLauncherOpen(true)}
                  title="Spawn a new agent against this document"
                  aria-label="Spawn a new agent seeded with this document"
                  disabled={!launcherProject}
                >
                  <BotMessageSquare size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyReference(selectedDoc)}
                  title="Copy reference (@path)"
                  aria-label="Copy reference"
                >
                  <AtSign size={14} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleReveal({
                      key: '',
                      name: '',
                      kind: 'dir',
                      scope: selectedDoc.scope ?? 'global',
                      projectId: selectedDoc.projectId,
                      relPath: ''
                    })
                  }
                  title="Reveal in Finder"
                >
                  <ExternalLink size={14} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleDelete({
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
              handleReveal(menu.node);
              setMenu(null);
            }}
          >
            Reveal in Finder
          </button>
          {!menu.node.isBucketRoot && (
            <button
              className="danger"
              onClick={() => {
                void handleDelete(menu.node);
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
          hint={prompt.isDir ? 'Path is relative to the scope root — moving a folder moves everything inside it.' : 'Path is relative to the scope root.'}
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

      {launcherOpen && selectedDoc && launcherProject && (
        <AgentLauncher
          project={launcherProject}
          initialPrompt={buildSpawnPrompt(selectedDoc)}
          onClose={() => setLauncherOpen(false)}
        />
      )}
    </div>
  );
}

/** Twin of LibraryView's buildSpawnPrompt — same convention, different caller. */
function buildSpawnPrompt(doc: LibraryDoc): string {
  const ref = doc.absPath ? `@${doc.absPath}` : doc.relPath;
  const parts: string[] = ['Act on the following document from the library.', '', `Document: ${doc.title}`, ref];
  if (doc.summary?.trim()) {
    parts.push('', 'Summary:', doc.summary.trim());
  }
  return parts.join('\n');
}
