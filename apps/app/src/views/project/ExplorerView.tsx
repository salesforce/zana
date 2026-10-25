import type { ProjectFileScope } from '@zana-ai/zcc-desktop-contract';
import { projectSources } from '@zana-ai/zcc-domain/project';
import { useHosts } from '../../hooks/useHosts.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { product } from '../../lib/product-client.js';
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { FsEntry, GitBranch as GitBranchInfo, GitFileCode, GitShowResult, GitStatus, OpenTarget, FsReadResult, Project, Worktree } from '@zana-ai/zcc-domain/product';
import { useData, useUi } from '@/store';
import { PromptModal } from '@/components/PromptModal';
import { useAiEnhanceSelection } from '@/components/AiEnhanceSelection';
import { useFileDrop } from '@/hooks/useFileDrop';
import { useMonacoTheme } from '@/hooks/useMonacoTheme';
import { useDirectoryLoader } from '@/components/explorer/useDirectoryLoader';
import { DirectoryLoading } from '@/components/explorer/DirectoryLoading';
import { useExplorerFileReveal } from './useExplorerFileReveal.js';
import {
  WorktreeMenu,
  ExplorerGitFooter,
  ExplorerTreeHeader,
  ExplorerContextMenu,
  FileViewer,
  TreeList,
  ChangesList,
  useFileOperations
} from '@/components/explorer';

interface ContextMenu {
  x: number;
  y: number;
  entry: FsEntry;
}

// Pending name-entry prompt. `window.prompt` is disabled in Electron's
// renderer (returns null), so create/rename route through an in-app modal
// instead; this captures which operation is awaiting a name.
type PromptState =
  | { kind: 'create'; dir: string; entryKind: 'file' | 'dir' }
  | { kind: 'rename'; path: string; rel: string };

interface Props {
  project: Project;
  /** Narrower tree defaults when hosted in a thread / CLI-agent side panel. */
  embedded?: boolean;
  scope?: ProjectFileScope;
  checkoutPath?: string;
}

// Width of the Explorer tree column. Persisted as a renderer-only UI preference
// (localStorage), matching the Library splitter behavior. The side-panel host
// uses its own key so a wide workspace tree does not overflow a 352px panel.
const WORKSPACE_TREE = { min: 220, max: 560, default: 260, key: 'zcc.explorerTreeWidth' } as const;
const PANEL_TREE = { min: 140, max: 360, default: 168, key: 'zcc.threadExplorerTreeWidth' } as const;
type TreeWidthPreset = typeof WORKSPACE_TREE | typeof PANEL_TREE;

function loadExplorerTreeWidth(preset: TreeWidthPreset): number {
  if (typeof localStorage === 'undefined') return preset.default;
  const raw = Number(localStorage.getItem(preset.key));
  if (!Number.isFinite(raw) || raw <= 0) return preset.default;
  return Math.max(preset.min, Math.min(preset.max, raw));
}

export function ExplorerView(props: Props) {
  return props.project.remote ? <CheckoutExplorerView {...props} /> : <ProjectCheckoutExplorerView {...props} />;
}
function ProjectCheckoutExplorerView({ project, embedded = false, scope, checkoutPath }: Props) {
  const hosts = useHosts();
  const primaryHostId = hosts.find(host => host.isPrimary)?.id;
  const sources = projectSources(project, primaryHostId);
  // The project owns its local/remote target. A thread may pin a historical
  // environment, but Explorer never offers a separate machine selection.
  const hostId = scope?.hostId ?? project.hostId ?? primaryHostId;
  const source = sources.find(source => source.hostId === hostId);
  const selected = hosts.find(host => host.id === hostId);
  const fileScope = useMemo(() => hostId ? { projectId: project.id, hostId, ...(scope?.environmentId ? { environmentId: scope.environmentId } : {}) } : undefined, [project.id, hostId, scope?.environmentId]);
  const path = scope?.environmentId ? checkoutPath : source?.path;
  if (!hostId || !path || !fileScope) return <p className="tree-pane-empty" role="alert">Project checkout is unavailable.</p>;
  return <CheckoutExplorerView key={`${project.id}:${hostId}:${scope?.environmentId ?? ''}:${path}`} project={{ ...project, path }} embedded={embedded} scope={fileScope} nativeFiles={selected?.isPrimary === true && hasDesktopBridge()} originalSource={source?.id === `original:${project.id}`} primaryHostId={primaryHostId} />;
}
function CheckoutExplorerView({ project, embedded = false, scope: baseScope, nativeFiles = true, originalSource = true, primaryHostId }: Props & { nativeFiles?: boolean; originalSource?: boolean; primaryHostId?: string }) {
  const pushToast = useUi((s) => s.pushToast);
  const viewKey = baseScope && (!originalSource || baseScope.environmentId) ? `${project.id}:${baseScope.hostId}:${baseScope.environmentId ?? ''}` : project.id;
  const explorerFile = useUi((s) => s.explorerFile[viewKey]);
  const goto = useUi((s) => s.explorerGoto[viewKey]);
  const setExplorerFile = useUi((s) => s.setExplorerFile);
  const setProjectView = useUi((s) => s.setProjectView);
  const selectTab = useUi((s) => s.selectTab);
  const createTerminal = useData((s) => s.createTerminal);
  const storeGitStatus = useData((s) => s.gitStatus[project.id]);
  const monacoTheme = useMonacoTheme();

  // A remote (SSH-backed) project browses files over ssh instead of the local
  // fs. Its `project.path` is just a local placeholder dir; the real tree lives
  // on the remote host. We resolve the remote root once on mount and route
  // list/read through the `*Remote` IPC. Remote browsing is read-only in v1, so
  // the mutation / git / external-open affordances below are all gated off.
  const isRemote = !!project.remote;
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteReady, setRemoteReady] = useState(!project.remote);

  // Worktree switcher: the Explorer's "view root" defaults to the project path
  // (the repo's main checkout) but can be flipped to any linked worktree of the
  // same repo. Every tree/git operation below keys off `viewRoot` rather than
  // `project.path` so switching re-roots the file tree, the changes list, and
  // the diff panel together. `worktrees` is enumerated lazily per project. For a
  // remote project `viewRoot` is the resolved remote root (set async on mount).
  const [viewRoot, setViewRoot] = useState(project.path);
  const activeRoot = useRef(viewRoot);
  activeRoot.current = viewRoot;
  const [environments, setEnvironments] = useState<Awaited<ReturnType<typeof product.environments.list>>>([]);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const resolvedEnvironmentId = useMemo(() => {
    if (!baseScope || viewRoot === project.path) return null;
    const environment = environments.find(row => row.path === viewRoot && row.hostId === baseScope.hostId);
    // Existing native Git worktrees retain main's established authorization.
    // This exception is available only in the primary desktop, never on a remote target.
    if (!environment && nativeFiles && worktrees.some(row => row.path === viewRoot)) return 'native';
    return environment?.id ?? 'unregistered-checkout';
  }, [baseScope?.hostId, viewRoot, project.path, environments, nativeFiles, worktrees]);
  const scope = useMemo(() => {
    if (!baseScope) return undefined;
    if (viewRoot === project.path) return baseScope;
    if (resolvedEnvironmentId === 'native') return undefined;
    return { ...baseScope, environmentId: resolvedEnvironmentId ?? 'unregistered-checkout' };
  }, [baseScope, viewRoot, project.path, resolvedEnvironmentId]);
  // All local branches of the repo (not just the ones bound to a worktree), so
  // the switcher can list every branch and badge which checkout it's on.
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [worktreesLoading, setWorktreesLoading] = useState(false);
  const [worktreesError, setWorktreesError] = useState<string | null>(null);
  const [worktreeMenu, setWorktreeMenu] = useState(false);
  // Git status scoped to the active worktree. When viewing the main checkout we
  // reuse the store's status (kept fresh by terminal-close hooks etc.); for any
  // other worktree we fetch + refresh a local copy keyed to `viewRoot`.
  const [worktreeGitStatus, setWorktreeGitStatus] = useState<GitStatus | null>(null);
  const onMainCheckout = !scope && viewRoot === project.path;
  const gitStatus = onMainCheckout ? storeGitStatus : worktreeGitStatus;
  const gitFiles = gitStatus?.files;

  // Reload git status for whatever root is currently in view. Mutations and
  // discards call this instead of poking the store directly so worktree views
  // stay in sync too.
  const reloadGitStatus = useCallback(() => {
    if (isRemote) return; // remote projects have no local git status
    let cancelled = false;
    if (!scope && viewRoot === project.path) {
      useData.getState().loadGitStatus(project.id);
    } else {
      product.git.status(viewRoot, undefined, scope)
        .then((s) => { if (!cancelled && activeRoot.current === viewRoot) setWorktreeGitStatus(s); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [viewRoot, project.id, project.path, isRemote, scope]);

  // Re-enumerate the repo's worktrees + branches (after a remove, or a manual
  // refresh). Failures stay local to the switcher, never the file tree.
  const reloadWorktrees = useCallback(() => {
    if (isRemote) return;
    let cancelled = false;
    setWorktreesLoading(true);
    setWorktreesError(null);
    const failed = (error: unknown) => {
      if (!cancelled) setWorktreesError(error instanceof Error ? error.message : 'Failed to load checkouts');
    };
    const trees = product.git.listWorktrees(project.path, nativeFiles && !baseScope?.environmentId ? undefined : baseScope)
      .then(async (list) => {
        const environments = await product.environments.list(project.id).catch(() => []);
        if (cancelled) return;
        setEnvironments(environments);
        const extras: Worktree[] = environments
          .filter((row) => (!baseScope || row.hostId === baseScope.hostId) && row.path && row.status === 'ready' && row.workspaceProvisionType === 'managed-worktree')
          .filter((row) => !list.some((wt) => wt.path === row.path))
          .map((row) => ({
            path: row.path!,
            head: null,
            branch: row.branchName,
            detached: false,
            bare: false,
            isMain: false
          }));
        setWorktrees(baseScope?.environmentId ? [] : [...list, ...extras]);
      })
      .catch(error => { if (!cancelled) setWorktrees([]); failed(error); });
    const refs = product.git.listBranches(project.path, baseScope)
      .then((list) => { if (!cancelled) setBranches(baseScope?.environmentId ? [] : list); })
      .catch(error => { if (!cancelled) setBranches([]); failed(error); });
    void Promise.all([trees, refs]).finally(() => { if (!cancelled) setWorktreesLoading(false); });
    return () => { cancelled = true; };
  }, [project.path, project.id, isRemote, baseScope, nativeFiles]);

  useEffect(() => {
    if (worktreeMenu) return reloadWorktrees();
  }, [worktreeMenu, reloadWorktrees]);

  const handleRemoveWorktree = useCallback(
    async (wt: Worktree) => {
      if (!window.confirm(`Remove worktree for “${wt.branch ?? wt.path.split('/').pop()}”?\n\n${wt.path}\n\nThe branch itself is kept; only the checkout directory is removed.`)) {
        return;
      }
      if (viewRoot === wt.path && fileClickStateRef.current.editedContent !== null && !window.confirm('Discard unsaved edits and remove this checkout?')) return;
      const environments = await product.environments.list(project.id).catch(() => []);
      const managed = environments.find((row) => (!baseScope || row.hostId === baseScope.hostId) && row.path === wt.path && row.workspaceProvisionType === 'managed-worktree');
      if (managed) {
        try {
          await product.environments.destroy(managed.id);
          if (viewRoot === wt.path) setViewRoot(project.path);
          pushToast('Worktree removed');
          setWorktreeMenu(false);
          reloadWorktrees();
        } catch (error) {
          pushToast(`Remove failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
        return;
      }
      if (baseScope && !nativeFiles) { pushToast('This checkout is no longer registered. Refresh before removing it.', 'error'); return; }
      let res = await product.git.removeWorktree(project.path, wt.path, false);
      if (!res.ok && /dirty|contains modified|use --force|locked working tree/i.test(res.message ?? '')) {
        if (window.confirm(`“${wt.branch ?? wt.path}” has uncommitted changes.\n\nForce-remove and discard them?`)) {
          res = await product.git.removeWorktree(project.path, wt.path, true);
        } else {
          return;
        }
      }
      if (res.ok) {
        pushToast('Worktree removed');
        setWorktreeMenu(false);
        reloadWorktrees();
      } else {
        pushToast(`Remove failed: ${res.message ?? 'unknown error'}`, 'error');
      }
    },
    [project.path, project.id, viewRoot, pushToast, reloadWorktrees, baseScope]
  );

  const { sendPathToTerminal, copyPath, openInExternal, downloadRemoteFile, uploadLocalFiles } = useFileOperations({
    viewRoot,
    isRemote,
    projectId: project.id,
    hostId: scope?.hostId,
    primaryHostId,
    pushToast
  });

  const openShellHere = async (cwd: string) => {
    const session = await createTerminal(project.id, 'shell', 80, 24, { cwd, hostId: scope?.hostId, workspace: scope?.environmentId ? { kind: 'reuse', environmentId: scope.environmentId } : undefined });
    if (session) {
      selectTab(project.id, session.id);
      setProjectView(project.id, 'terminals');
    }
  };

  const [expanded, setExpanded] = useState<Map<string, boolean>>(new Map());
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const readDirectory = useCallback((path: string) => isRemote
    ? product.fs.listDirRemote(project.id, path)
    : product.fs.listDir(path, scope), [isRemote, project.id, scope]);
  const { entries, loading, slow, errors, loadDir, reset: resetDirectories } = useDirectoryLoader(readDirectory);
  const directoryError = errors.get(viewRoot);
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [fileResult, setFileResult] = useState<FsReadResult | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  // Buffered edits live separately from `fileResult` so a focus-driven re-read
  // can refresh the on-disk view without clobbering unsaved keystrokes. When
  // null, the editor mirrors fileResult.content exactly.
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Markdown files open as a rendered preview by default; the user can flip to
  // the Monaco editor to make edits. Resets per file (see effect below).
  const [previewMode, setPreviewMode] = useState(false);
  // Image files are binary (so `fileResult.binary` is true) but we render them
  // instead of the "binary file" placeholder. The data URL is fetched lazily
  // per file via the confine-checked `readDataUrl` IPC. Local projects only —
  // there's no remote data-url path (a remote image falls back to the binary
  // placeholder). null = not loaded yet.
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const treeMode = useUi((s) => s.explorerTreeMode[viewKey] ?? 'files');
  const setTreeModeStore = useUi((s) => s.setExplorerTreeMode);
  const toggleTreeModeStore = useUi((s) => s.toggleExplorerTreeMode);
  const diffMode = useUi((s) => !!s.explorerDiff[viewKey]);
  const setDiffModeStore = useUi((s) => s.setExplorerDiff);
  const setTreeMode = useCallback(
    (mode: 'files' | 'changes' | ((prev: 'files' | 'changes') => 'files' | 'changes')) => {
      const cur = useUi.getState().explorerTreeMode[viewKey] ?? 'files';
      const next = typeof mode === 'function' ? mode(cur) : mode;
      setTreeModeStore(viewKey, next);
    },
    [project.id, setTreeModeStore]
  );
  const setDiffMode = useCallback(
    (val: boolean | ((prev: boolean) => boolean)) => {
      const cur = !!useUi.getState().explorerDiff[viewKey];
      const next = typeof val === 'function' ? val(cur) : val;
      setDiffModeStore(viewKey, next);
    },
    [project.id, setDiffModeStore]
  );
  void toggleTreeModeStore;
  const [headResult, setHeadResult] = useState<GitShowResult | null>(null);
  const [headLoading, setHeadLoading] = useState(false);
  const treeBodyRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const treePreset = embedded ? PANEL_TREE : WORKSPACE_TREE;
  const [treeWidth, setTreeWidth] = useState(() => loadExplorerTreeWidth(treePreset));
  // Monaco editor instance + last applied goto nonce, so we can replay a
  // pending goto once the editor is mounted *and* the file has loaded.
  const editorRef = useRef<{
    revealLineInCenter: (line: number) => void;
    setPosition: (p: { lineNumber: number; column: number }) => void;
    focus: () => void;
  } | null>(null);
  const appliedGotoNonceRef = useRef<number | null>(null);
  const { registerEditor: registerAiEnhanceEditor, modal: aiEnhanceModal } = useAiEnhanceSelection();

  const applyGoto = useCallback(() => {
    if (!goto || !editorRef.current) return;
    if (appliedGotoNonceRef.current === goto.nonce) return;
    editorRef.current.revealLineInCenter(goto.line);
    editorRef.current.setPosition({ lineNumber: goto.line, column: goto.column });
    editorRef.current.focus();
    appliedGotoNonceRef.current = goto.nonce;
  }, [goto]);

  const { revealFile, cancelReveal } = useExplorerFileReveal({
    loadDir,
    setExpanded,
    treeBodyRef,
    activeRoot,
    treeMode
  });

  useEffect(() => {
    setExpanded(new Map());
    setMenu(null);
    setHeadResult(null);
    setWorktrees([]);
    setWorktreeMenu(false);
    setWorktreeGitStatus(null);
    editorRef.current = null;
    appliedGotoNonceRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    if (isRemote) {
      // Remote: resolve the browse root over ssh first, then seed the tree at
      // it. `project.path` is only a local placeholder, so we can't list it.
      let cancelled = false;
      setRemoteReady(false);
      setRemoteError(null);
      product.fs.remoteRoot(project.id)
        .then((res) => {
          if (cancelled) return;
          if (!res.ok || !res.root) {
            setRemoteError(res.message ?? 'Could not reach the remote host');
            return;
          }
          setViewRoot(res.root);
          setRemoteReady(true);
        })
        .catch((err) => {
          if (!cancelled) setRemoteError(err instanceof Error ? err.message : 'Could not reach the remote host');
        });
      return () => { cancelled = true; };
    } else {
      setViewRoot(project.path);
    }
  }, [project.id, project.path, isRemote]);

  useEffect(() => {
    resetDirectories();
    if (isRemote && !remoteReady) return;
    void loadDir(viewRoot);
    for (const [dir, isOpen] of expandedRef.current.entries()) {
      if (isOpen && dir !== viewRoot) void loadDir(dir);
    }
  }, [viewRoot, isRemote, remoteReady, loadDir, resetDirectories]);

  // When the view root changes (worktree switch), re-seed the tree at the new
  // root and load that checkout's git status. The open file belongs to the old
  // root, so close it — its path won't exist (or means something else) under
  // the new tree.
  const prevViewRootRef = useRef<string | null>(null);
  useEffect(() => {
    const isInitial = prevViewRootRef.current === null;
    if (!isInitial && prevViewRootRef.current === viewRoot) return;
    prevViewRootRef.current = viewRoot;
    if (!isInitial) {
      setExpanded(new Map());
      setMenu(null);
      setExplorerFile(viewKey, undefined);
      setWorktreeGitStatus(null);
    }
    return reloadGitStatus();
  }, [viewRoot, reloadGitStatus, viewKey, setExplorerFile]);

  // When the user changes file, drop any cached HEAD content. Diff mode
  // sticks across navigations so power-users can scan changes file by file.
  // headLoading is also reset so a stale in-flight load from the previous
  // file can't leave the spinner stuck on.
  useEffect(() => {
    setHeadResult(null);
    setHeadLoading(false);
  }, [explorerFile]);

  // Lazily fetch HEAD blob the first time diff mode is on for a given file.
  // headLoading is intentionally NOT a dep: it's set inside this effect, and
  // including it would cause cleanup → cancel → finally clears it → effect
  // re-runs → endless refetch loop where setHeadResult is always cancelled.
  useEffect(() => {
    if (!diffMode || !explorerFile) return;
    if (headResult) return;
    let cancelled = false;
    setHeadLoading(true);
    product.git.showHead(explorerFile, scope)
      .then((r) => {
        if (cancelled) return;
        setHeadResult(r);
      })
      .catch((err) => {
        if (cancelled) return;
        setHeadResult({ ok: false, message: err instanceof Error ? err.message : 'Failed to read HEAD' });
      })
      .finally(() => {
        if (!cancelled) setHeadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [diffMode, explorerFile, headResult, scope]);

  useEffect(() => {
    if (explorerFile && (!isRemote || remoteReady)) {
      void revealFile(explorerFile, viewRoot);
    }
    return () => {
      cancelReveal();
    };
  }, [explorerFile, viewRoot, revealFile, cancelReveal, isRemote, remoteReady]);

  // load file contents when explorerFile changes
  useEffect(() => {
    let cancelled = false;
    setEditedContent(null);
    if (!explorerFile) {
      setFileResult(null);
      setFileLoading(false);
      return;
    }
    setFileLoading(true);
    const read = isRemote
      ? product.fs.readFileRemote(project.id, explorerFile)
      : product.fs.readFile(explorerFile, scope);
    read
      .then((r) => {
        if (cancelled) return;
        setFileResult(r);
      })
      .catch((err) => {
        if (cancelled) return;
        setFileResult({ ok: false, message: err instanceof Error ? err.message : 'Failed to read file' });
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [explorerFile, isRemote, project.id, scope]);

  // Markdown opens rendered by default; everything else opens in the editor.
  // Re-evaluated on each file switch so leaving a .md in editor mode doesn't
  // carry that choice over to the next markdown file.
  useEffect(() => {
    setPreviewMode(!!explorerFile && isMarkdownPath(explorerFile));
  }, [explorerFile]);

  // Fetch a data URL for image files so we can render them inline rather than
  // showing the "binary file" placeholder. Local projects only (readDataUrl
  // has no remote twin); the fetch is confine-checked in main. Cleared on
  // every file switch so a stale image can't flash under the next file.
  useEffect(() => {
    setImageDataUrl(null);
    setImageError(null);
    if (!explorerFile || isRemote || !isImagePath(explorerFile)) return;
    let cancelled = false;
    product.fs.readDataUrl(explorerFile, scope)
      .then((r) => {
        if (cancelled) return;
        if (r.ok && r.dataUrl) setImageDataUrl(r.dataUrl);
        else setImageError(r.message ?? 'Failed to read image');
      })
      .catch((err) => {
        if (!cancelled) setImageError(err instanceof Error ? err.message : 'Failed to read image');
      });
    return () => { cancelled = true; };
  }, [explorerFile, isRemote, scope]);

  // Re-read the open file when the window regains focus. Claude tabs often
  // edit the file behind your back; without this the viewer stays stale until
  // you re-click the row. We don't toggle `fileLoading` so the editor doesn't
  // flash; the value just updates in place. Same for HEAD when diff is on.
  useEffect(() => {
    let cancelled = false;
    const onFocus = () => {
      if (!explorerFile) return;
      // Don't reload from disk while the buffer is dirty — that would silently
      // discard unsaved keystrokes. The diff side is still safe to refresh.
      if (editedContent === null) {
        const reread = isRemote
          ? product.fs.readFileRemote(project.id, explorerFile)
          : product.fs.readFile(explorerFile, scope);
        reread
          .then((r) => {
            if (!cancelled) setFileResult((prev) => (sameFileResult(prev, r) ? prev : r));
          })
          .catch(() => {});
      }
      if (diffMode && !isRemote) {
        product.git.showHead(explorerFile, scope)
          .then((r) => {
            if (!cancelled) setHeadResult((prev) => (sameHeadResult(prev, r) ? prev : r));
          })
          .catch(() => {});
      }
    };
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); };
  }, [explorerFile, diffMode, editedContent, isRemote, project.id, scope]);

  // After the file's loaded and the editor's mounted, apply any pending goto.
  useEffect(() => {
    if (fileLoading) return;
    if (!fileResult?.ok || fileResult.binary) return;
    applyGoto();
  }, [fileLoading, fileResult, applyGoto]);

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

  // Dismiss the worktree dropdown on any outside click / blur (the button's own
  // onClick stops propagation so it toggles rather than instantly re-closing).
  useEffect(() => {
    if (!worktreeMenu) return;
    const close = () => setWorktreeMenu(false);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, [worktreeMenu]);

  // These three handlers are passed to the recursive `TreeList` (React.memo). If
  // their identity changed every render, memo would be defeated and the WHOLE
  // tree would reconcile on every keystroke in the editor / git-decoration push.
  // So they must be stable. `toggleDir` reads `expanded` (only changes on a real
  // toggle — a legitimate tree change); `loadDir` no longer changes when the
  // directory cache updates.
  const toggleDir = useCallback(
    (entry: FsEntry) => {
      const isOpen = expanded.get(entry.path) === true;
      if (!isOpen) loadDir(entry.path);
      setExpanded((s) => {
        const next = new Map(s);
        next.set(entry.path, !isOpen);
        return next;
      });
    },
    [expanded, loadDir]
  );

  // `onFileClick`'s guard reads the unsaved-edit state, which churns on EVERY
  // keystroke — depending on it directly would re-break memo. Route those reads
  // through a latest-value ref so the callback stays referentially stable while
  // still seeing current values at click time.
  const fileClickStateRef = useRef({ explorerFile, editedContent, fileContent: fileResult?.content ?? '' });
  fileClickStateRef.current = { explorerFile, editedContent, fileContent: fileResult?.content ?? '' };
  const onFileClick = useCallback(
    (entry: FsEntry) => {
      const { explorerFile: cur, editedContent: edited, fileContent } = fileClickStateRef.current;
      if (entry.path === cur) return;
      if (edited !== null && edited !== fileContent && !window.confirm('Discard unsaved changes?')) {
        return;
      }
      setExplorerFile(viewKey, entry.path);
    },
    [viewKey, setExplorerFile]
  );

  const onContext = useCallback((e: React.MouseEvent, entry: FsEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  // Drop local files onto the remote tree to upload them into the current root.
  // The resolver does the upload + refresh and returns '' (no path sink here).
  // Local projects don't register this — they have no "upload" notion.
  const { dropOver: treeDropOver, dropHandlers: treeDropHandlers } = useFileDrop(
    () => {},
    async (localPaths) => {
      await uploadLocalFiles(localPaths, viewRoot, refreshDir);
      return '';
    }
  );

  const refresh = useCallback(() => {
    resetDirectories();
    setExpanded(new Map());
    loadDir(viewRoot, true);
    reloadGitStatus();
  }, [viewRoot, loadDir, reloadGitStatus, resetDirectories]);

  const discardFile = async (path: string) => {
    const code = gitFiles?.[path];
    const rel = path.startsWith(viewRoot + '/')
      ? path.slice(viewRoot.length + 1)
      : path;
    const verb = code === '?' || code === 'A' ? 'Delete' : 'Discard changes to';
    if (!window.confirm(`${verb} ${rel}? This cannot be undone.`)) return;
    try {
    const revision = scope ? await product.fs.readFile(path, scope) : undefined;
    const expected = revision?.ok ? revision.sha256 : code === 'D' ? null : undefined;
    const r = await product.git.discard(path, scope, expected);
    if (!r.ok) {
      pushToast(r.message ?? 'Discard failed', 'error');
      return;
    }
    pushToast(code === '?' || code === 'A' ? `Deleted ${rel}` : `Discarded ${rel}`);
    // If we just nuked the open file, drop the editor view; otherwise re-read.
    if (explorerFile === path) {
      if (code === '?' || code === 'A') {
        setExplorerFile(viewKey, undefined);
      } else {
        setEditedContent(null);
        product.fs.readFile(path, scope).then((res) => setFileResult(res)).catch(() => {});
        if (diffMode) {
          product.git.showHead(path, scope).then((h) => setHeadResult(h)).catch(() => {});
        }
      }
    }
    reloadGitStatus();
    } catch (error) { pushToast(error instanceof Error ? error.message : 'Discard failed', 'error'); }
  };

  // Reload a directory's children and make sure it's expanded so the result of
  // a create/rename/delete shows up immediately. `dir` is an absolute path.
  const refreshDir = useCallback(
    async (dir: string) => {
      await loadDir(dir, true);
      setExpanded((s) => {
        if (s.get(dir) === true) return s;
        const next = new Map(s);
        next.set(dir, true);
        return next;
      });
    },
    [loadDir]
  );

  const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || viewRoot;

  // Create a file or folder under `dir`. Opens the name-entry modal; the actual
  // FS write happens in submitCreate once the user confirms a name. (Electron
  // disables window.prompt, so we can't ask inline.)
  const createEntry = (dir: string, kind: 'file' | 'dir') => {
    setPrompt({ kind: 'create', dir, entryKind: kind });
  };

  const submitCreate = async (dir: string, kind: 'file' | 'dir', rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    if (name.includes('..')) {
      pushToast('Name cannot contain ".."', 'error');
      return;
    }
    const target = dir + '/' + name.replace(/^\/+/, '');
    const r = isRemote
      ? kind === 'dir'
        ? await product.fs.createDirRemote(project.id, target)
        : await product.fs.createFileRemote(project.id, target)
      : kind === 'dir'
        ? await product.fs.createDir(viewRoot, target, scope)
        : await product.fs.createFile(viewRoot, target, scope);
    if (!r.ok) {
      pushToast(r.message ?? 'Create failed', 'error');
      return;
    }
    // Reveal the parent (and any intermediate dirs the name introduced).
    await refreshDir(parentOf(r.path ?? target));
    // Open the new file in the editor, but don't silently drop an unsaved buffer.
    if (kind === 'file' && r.path) {
      const dirty = editedContent !== null && editedContent !== (fileResult?.content ?? '');
      if (!dirty || window.confirm('Discard unsaved changes?')) {
        setExplorerFile(viewKey, r.path);
      }
    }
    reloadGitStatus();
  };

  const renameEntry = (path: string) => {
    const rel = path.startsWith(viewRoot + '/') ? path.slice(viewRoot.length + 1) : path;
    setPrompt({ kind: 'rename', path, rel });
  };

  const submitRename = async (path: string, rel: string, rawNext: string) => {
    const next = rawNext.trim();
    if (!next || next === rel) return;
    if (next.includes('..')) {
      pushToast('Path cannot contain ".."', 'error');
      return;
    }
    const target = viewRoot + '/' + next.replace(/^\/+/, '');
    const r = isRemote
      ? await product.fs.renameRemote(project.id, path, target)
      : await product.fs.rename(viewRoot, path, target, scope);
    if (!r.ok) {
      pushToast(r.message ?? 'Rename failed', 'error');
      return;
    }
    await refreshDir(parentOf(path));
    if (r.path && parentOf(r.path) !== parentOf(path)) await refreshDir(parentOf(r.path));
    // Follow the open file if it moved — either it *was* the renamed entry, or
    // it lives inside a renamed folder (rewrite its path prefix).
    if (r.path && explorerFile) {
      if (explorerFile === path) {
        setExplorerFile(viewKey, r.path);
      } else if (explorerFile.startsWith(path + '/')) {
        setExplorerFile(viewKey, r.path + explorerFile.slice(path.length));
      }
    }
    reloadGitStatus();
  };

  // Hard delete (not git-discard) — works on any file or folder, tracked or not.
  const deleteEntry = async (path: string, kind: 'file' | 'dir') => {
    const rel = path.startsWith(viewRoot + '/') ? path.slice(viewRoot.length + 1) : path;
    const what = kind === 'dir' ? 'folder (and everything inside it)' : 'file';
    if (!window.confirm(`Delete ${what} ${rel}? This cannot be undone.`)) return;
    const r = isRemote
      ? await product.fs.deleteRemote(project.id, path)
      : await product.fs.delete(viewRoot, path, scope);
    if (!r.ok) {
      pushToast(r.message ?? 'Delete failed', 'error');
      return;
    }
    pushToast(`Deleted ${rel}`);
    if (explorerFile === path || (kind === 'dir' && explorerFile?.startsWith(path + '/'))) {
      setExplorerFile(viewKey, undefined);
    }
    await refreshDir(parentOf(path));
    reloadGitStatus();
  };

  const isDirty = editedContent !== null && editedContent !== (fileResult?.content ?? '');

  const saveFile = useCallback(async () => {
    if (!explorerFile || editedContent === null || saving) return;
    setSaving(true);
    let r;
    try {
      r = isRemote
        ? await product.fs.writeFileRemote(project.id, explorerFile, editedContent)
        : await product.fs.writeFile(explorerFile, editedContent, scope, fileResult?.sha256);
    } catch (error) { pushToast(error instanceof Error ? error.message : 'Failed to save file', 'error'); return; }
    finally { setSaving(false); }
    if (!r.ok) {
      pushToast(r.message ?? 'Failed to save file', 'error');
      return;
    }
    // Sync the on-disk snapshot to what we just wrote, drop the buffer, and
    // refresh git status so the dirty markers update right away.
    if (fileClickStateRef.current.explorerFile !== explorerFile) return;
    setFileResult((prev) => (prev ? { ...prev, content: editedContent, bytes: r.bytes, sha256: r.sha256 } : prev));
    if (fileClickStateRef.current.editedContent === editedContent) setEditedContent(null);
    if (diffMode && !isRemote) {
      product.git.showHead(explorerFile, scope).then((h) => setHeadResult(h)).catch(() => {});
    }
    reloadGitStatus();
  }, [explorerFile, editedContent, saving, pushToast, diffMode, reloadGitStatus, isRemote, project.id, fileResult?.sha256, scope]);

  // ⌘S / Ctrl+S — save the open file. Capture-phase so Monaco's default
  // "save" keybinding (which is a no-op without a wired command) can't
  // swallow it first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = navigator.platform.toUpperCase().includes('MAC') ? e.metaKey : e.ctrlKey;
      if (!mod || e.shiftKey || e.altKey) return;
      if (e.key !== 's' && e.key !== 'S') return;
      e.preventDefault();
      e.stopPropagation();
      saveFile();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [saveFile]);

  const rootList = entries.get(viewRoot);

  // Show the diff toggle only when the active file is dirty against HEAD.
  // Untracked is included so reviewers can see "all of this is new".
  const fileGitCode = explorerFile && gitFiles ? gitFiles[explorerFile] : undefined;
  const diffAvailable = !!fileGitCode;

  // Diff mode is per-project persisted state, so it survives switching files.
  // Only actually render the diff when the active file has changes against HEAD
  // — otherwise a clean file would show two identical panes with no way out
  // (the toggle below is hidden when !diffAvailable). The persisted flag is
  // kept as-is so returning to a dirty file restores the diff.
  const showDiff = diffMode && diffAvailable;

  // Markdown gets a rendered-preview toggle. Hidden in diff mode (the diff is
  // inherently a text comparison) and meaningless for non-markdown files.
  const isMarkdown = !!explorerFile && isMarkdownPath(explorerFile);
  const showPreview = isMarkdown && previewMode && !showDiff;

  // Flat list of dirty files in the project, sorted by status code then path.
  // Filtered to descendants of project.path so multi-project repos don't bleed
  // changes from sibling projects sharing a toplevel.
  const changedFiles = useMemo(() => {
    if (!gitFiles) return [];
    const prefix = viewRoot + '/';
    const list: Array<{ path: string; rel: string; code: GitFileCode }> = [];
    for (const [abs, code] of Object.entries(gitFiles)) {
      if (!abs.startsWith(prefix)) continue;
      list.push({ path: abs, rel: abs.slice(prefix.length), code });
    }
    list.sort((a, b) => {
      if (a.code !== b.code) return a.code.localeCompare(b.code);
      return a.rel.localeCompare(b.rel);
    });
    return list;
  }, [gitFiles, viewRoot]);

  // Branch name -> the worktree that has it checked out (if any). Lets the
  // branch list badge which checkout each branch is assigned to, and route a
  // click to that worktree's view root.
  const worktreeByBranch = useMemo(() => {
    const map = new Map<string, Worktree>();
    for (const wt of worktrees) {
      if (wt.branch) map.set(wt.branch, wt);
    }
    return map;
  }, [worktrees]);

  const showGitFooter = !isRemote && !!gitStatus && !!(gitStatus.branch || gitStatus.detached);

  const onChangeClick = (path: string) => {
    setExplorerFile(viewKey, path);
    // Auto-flip into diff mode when picking from the changes list — that's
    // the whole point of clicking it. User can toggle back to plain view.
    setDiffMode(true);
  };

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    document.body.classList.add('resizing-col');
    const left = rootRef.current?.getBoundingClientRect().left ?? 0;
    let latest = treeWidth;
    const onMove = (ev: MouseEvent) => {
      latest = Math.max(
        treePreset.min,
        Math.min(treePreset.max, Math.round(ev.clientX - left))
      );
      setTreeWidth(latest);
    };
    const onUp = () => {
      document.body.classList.remove('resizing-col');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try {
        localStorage.setItem(treePreset.key, String(latest));
      } catch {
        /* localStorage write is best-effort */
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onResizeDoubleClick = () => {
    setTreeWidth(treePreset.default);
    try {
      localStorage.setItem(treePreset.key, String(treePreset.default));
    } catch {
      /* best-effort */
    }
  };

  // Roll up dirty descendants into a Set of ancestor directory paths so we
  // can paint a subtle marker on collapsed folders. Recomputes when the file
  // map changes; rooted under project.path so we don't bubble past the
  // project boundary even if the repo toplevel sits higher.
  const dirtyDirs = useMemo(() => {
    const set = new Set<string>();
    if (!gitFiles) return set;
    for (const abs of Object.keys(gitFiles)) {
      if (!abs.startsWith(viewRoot + '/')) continue;
      let dir = abs;
      while (true) {
        const slash = dir.lastIndexOf('/');
        if (slash <= 0) break;
        dir = dir.slice(0, slash);
        if (dir === viewRoot) break;
        if (set.has(dir)) break;
        set.add(dir);
      }
    }
    return set;
  }, [gitFiles, viewRoot]);

  return (
    <div
      ref={rootRef}
      className={`explorer-view${embedded ? ' is-embedded' : ''}`}
      style={{ flex: '1 1 auto', minHeight: 0, gridTemplateColumns: `${treeWidth}px minmax(0, 1fr)` }}
    >
      <aside className="explorer-tree">
        <ExplorerTreeHeader
          project={project}
          isRemote={isRemote}
          treeMode={treeMode}
          changedFilesCount={changedFiles.length}
          onTreeModeToggle={() => setTreeMode((m) => (m === 'changes' ? 'files' : 'changes'))}
          onCreateFile={() => createEntry(viewRoot, 'file')}
          onCreateFolder={() => createEntry(viewRoot, 'dir')}
          onRefresh={refresh}
        />
        <div
          className={`explorer-tree-body ${isRemote && treeDropOver ? 'drop-over' : ''}`}
          ref={treeBodyRef}
          {...(isRemote ? treeDropHandlers : {})}
          title={isRemote ? 'Drop files here to upload to the remote host' : undefined}
        >
          {directoryError ? (
            <div className="tree-pane-empty">
              <p role="alert">{directoryError}</p>
            </div>
          ) : isRemote && remoteError ? (
            <div className="tree-pane-empty">
              <p>Couldn’t browse remote host:</p>
              <p role="alert" style={{ color: 'var(--danger)' }}>{remoteError}</p>
            </div>
          ) : isRemote && !remoteReady ? (
            <DirectoryLoading />
          ) : treeMode === 'changes' ? (
            changedFiles.length === 0 ? (
              <div className="tree-pane-empty">No changes.</div>
            ) : (
              <ChangesList
                files={changedFiles}
                activeFile={explorerFile}
                onClick={onChangeClick}
                onDiscard={discardFile}
              />
            )
          ) : rootList === undefined ? (
            <DirectoryLoading label="Loading files" slow={slow.has(viewRoot)} />
          ) : rootList.length === 0 ? (
            <div className="tree-pane-empty">Empty directory.</div>
          ) : (
            <TreeList
              list={rootList}
              depth={0}
              expanded={expanded}
              entries={entries}
              loading={loading}
              slow={slow}
              errors={errors}
              activeFile={explorerFile}
              gitFiles={gitFiles}
              dirtyDirs={dirtyDirs}
              onToggleDir={toggleDir}
              onFileClick={onFileClick}
              onContext={onContext}
            />
          )}
        </div>
        {showGitFooter && gitStatus && (
          <ExplorerGitFooter
            gitStatus={gitStatus}
            worktreeMenu={worktreeMenu}
            onToggleMenu={() => setWorktreeMenu((v) => !v)}
            menu={
              worktreeMenu ? (
                <WorktreeMenu
                  loading={worktreesLoading}
                  error={worktreesError}
                  project={project}
                  worktrees={worktrees}
                  branches={branches}
                  viewRoot={viewRoot}
                  worktreeByBranch={worktreeByBranch}
                  onSelectWorktree={(path) => {
                    if (baseScope?.environmentId || (path !== viewRoot && editedContent !== null && !window.confirm('Discard unsaved edits and switch checkouts?'))) return;
                    setViewRoot(path); setWorktreeMenu(false);
                  }}
                  onRemoveWorktree={handleRemoveWorktree}
                  placement="above"
                />
              ) : null
            }
          />
        )}
      </aside>
      <div
        className="explorer-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={treePreset.min}
        aria-valuemax={treePreset.max}
        aria-valuenow={treeWidth}
        title="Drag to resize · double-click to reset"
        style={{ left: `${treeWidth}px` }}
        onMouseDown={onResizeMouseDown}
        onDoubleClick={onResizeDoubleClick}
      />
      <FileViewer
        project={project}
        explorerFile={explorerFile}
        fileResult={fileResult}
        fileLoading={fileLoading}
        editedContent={editedContent}
        saving={saving}
        previewMode={previewMode}
        diffMode={diffMode}
        diffAvailable={diffAvailable}
        showDiff={showDiff}
        showPreview={showPreview}
        headResult={headResult}
        headLoading={headLoading}
        imageDataUrl={imageDataUrl}
        imageError={imageError}
        viewRoot={viewRoot}
        monacoTheme={monacoTheme}
        isRemote={isRemote}
        nativeFiles={nativeFiles}
        isMarkdown={isMarkdown}
        onContentChange={setEditedContent}
        onEditorMount={(ed, monaco) => {
          editorRef.current = ed as unknown as typeof editorRef.current;
          applyGoto();
          registerAiEnhanceEditor(ed, monaco);
        }}
        aiEnhanceModal={aiEnhanceModal}
        onSave={saveFile}
        onTogglePreview={() => setPreviewMode((v) => !v)}
        onToggleDiff={() => setDiffMode((v) => !v)}
      />
      {menu && (
        <ExplorerContextMenu
          entry={menu.entry}
          x={menu.x}
          y={menu.y}
          isRemote={isRemote}
          gitFiles={gitFiles}
          onViewInEditor={() => { setExplorerFile(viewKey, menu.entry.path); setMenu(null); }}
          onSendToTerminal={() => {
            sendPathToTerminal(
              menu.entry.path,
              () => useUi.getState().selectedTabId[project.id],
              setProjectView
            );
            setMenu(null);
          }}
          onDownloadRemote={isRemote && menu.entry.kind === 'file' ? () => { downloadRemoteFile(menu.entry.path); setMenu(null); } : undefined}
          onOpenInCursor={!isRemote && nativeFiles ? () => { openInExternal('cursor', viewRoot); setMenu(null); } : undefined}
          onOpenInCode={!isRemote && nativeFiles ? () => { openInExternal('code', viewRoot); setMenu(null); } : undefined}
          onRevealInFinder={!isRemote && nativeFiles ? () => { openInExternal('finder', menu.entry.path); setMenu(null); } : undefined}
          onCreateFile={menu.entry.kind === 'dir' ? () => { createEntry(menu.entry.path, 'file'); setMenu(null); } : undefined}
          onCreateFolder={menu.entry.kind === 'dir' ? () => { createEntry(menu.entry.path, 'dir'); setMenu(null); } : undefined}
          onOpenShellHere={!isRemote && menu.entry.kind === 'dir' ? () => { openShellHere(menu.entry.path); setMenu(null); } : undefined}
          onOpenInTerminal={!isRemote && nativeFiles && menu.entry.kind === 'dir' ? () => { openInExternal('terminal', menu.entry.path); setMenu(null); } : undefined}
          onCopyPath={() => { copyPath(menu.entry.path); setMenu(null); }}
          onRename={() => { renameEntry(menu.entry.path); setMenu(null); }}
          onDiscardChanges={!isRemote && menu.entry.kind === 'file' && gitFiles?.[menu.entry.path] ? () => { discardFile(menu.entry.path); setMenu(null); } : undefined}
          onDelete={() => { deleteEntry(menu.entry.path, menu.entry.kind); setMenu(null); }}
        />
      )}
      {prompt && prompt.kind === 'create' && (
        <PromptModal
          title={prompt.entryKind === 'dir' ? 'New folder' : 'New file'}
          hint={
            prompt.entryKind === 'file'
              ? 'A relative path is OK — intermediate folders are created as needed.'
              : undefined
          }
          label={prompt.entryKind === 'dir' ? 'Folder name' : 'File name'}
          placeholder={prompt.entryKind === 'dir' ? 'components' : 'src/util/helper.ts'}
          confirmLabel="Create"
          onSubmit={(name) => {
            const p = prompt;
            setPrompt(null);
            void submitCreate(p.dir, p.entryKind, name);
          }}
          onClose={() => setPrompt(null)}
        />
      )}
      {prompt && prompt.kind === 'rename' && (
        <PromptModal
          title="Rename / move"
          hint="Path is relative to the project root."
          label="New path"
          initialValue={prompt.rel}
          confirmLabel="Rename"
          onSubmit={(next) => {
            const p = prompt;
            setPrompt(null);
            void submitRename(p.path, p.rel, next);
          }}
          onClose={() => setPrompt(null)}
        />
      )}
    </div>
  );
}

// Avoid handing monaco a fresh value on focus refresh when nothing actually
// changed — would otherwise blow away cursor position and selection.
function sameFileResult(a: FsReadResult | null, b: FsReadResult): boolean {
  if (!a) return false;
  if (a.ok !== b.ok) return false;
  if (a.binary !== b.binary) return false;
  if (a.content !== b.content) return false;
  return true;
}

function sameHeadResult(a: GitShowResult | null, b: GitShowResult): boolean {
  if (!a) return false;
  if (a.ok !== b.ok) return false;
  if (a.binary !== b.binary) return false;
  if (a.notInHead !== b.notInHead) return false;
  if (a.content !== b.content) return false;
  return true;
}

function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.markdown');
}

// Raster/vector image extensions the viewer can render inline via a data URL.
// Kept in sync with main's mimeFromExt (fs.ts) — those are the mimes readDataUrl
// will emit; anything else stays a "binary file" placeholder.
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'];
function isImagePath(path: string): boolean {
  const lower = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
