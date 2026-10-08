import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, FileWarning, History, MessageSquare, Bot, X } from 'lucide-react';
import type { DesignDocComment, DesignDocDetail, DesignDocRevision } from '../shared/contract.js';
import { AgentsPane, AskAgentButton, type AskRequest } from './Agents.js';
import { isMissingDoc, toast } from './api.js';
import { CommentsPane, type PendingQuote } from './CommentsPane.js';
import { DocHeader } from './DocHeader.js';
import type { EditorState } from './FileEditor.js';
import { FilePane, type ViewMode } from './FilePane.js';
import type { PreviewHandle } from './FilePreview.js';
import { FileTree } from './FileTree.js';
import { HistoryPane } from './HistoryPane.js';
import { useDoc, useNow, usePersistentState, useProjects, useWidthTier } from './hooks.js';
import { ConfirmDialog, EmptyState, FileIcon, IconButton, Popover, Spinner, type ConfirmRequest } from './ui.js';

export type DocLayout = 'workbench' | 'compact';
type RailTab = 'comments' | 'history' | 'agents';

/**
 * Doc widths that fit the file tree (220px) and then also the rail (320px)
 * beside a readable file. Below them the tree becomes a dropdown and the
 * rail floats over the file.
 */
const TREE_INLINE_MIN = 640;
const RAIL_INLINE_MIN = 1100;
const DOC_BREAKPOINTS = [TREE_INLINE_MIN, RAIL_INLINE_MIN] as const;

/** The file to show: the requested one, else the entry file, else the first. */
export function resolveActivePath(doc: Pick<DesignDocDetail, 'files' | 'entryPath'>, requested: string | null): string | null {
  const has = (path: string | null) => !!path && doc.files.some((file) => file.path === path);
  if (has(requested)) return requested;
  if (has(doc.entryPath)) return doc.entryPath;
  return doc.files[0]?.path ?? null;
}

function Rail({
  doc,
  tab,
  onTab,
  activePath,
  now,
  pendingQuote,
  onClearQuote,
  commentDraft,
  onCommentDraft,
  onFocusComment,
  selectedRevision,
  onSelectRevision,
  onClose
}: {
  doc: DesignDocDetail;
  tab: RailTab;
  onTab(tab: RailTab): void;
  activePath: string | null;
  now: number;
  pendingQuote: PendingQuote | null;
  onClearQuote(): void;
  commentDraft: string;
  onCommentDraft(value: string): void;
  onFocusComment(comment: DesignDocComment): void;
  selectedRevision: number | null;
  onSelectRevision(revision: DesignDocRevision): void;
  onClose?(): void;
}) {
  const tabs: Array<{ id: RailTab; label: string; icon: typeof MessageSquare; count?: number }> = [
    { id: 'comments', label: 'Comments', icon: MessageSquare, count: doc.openComments },
    { id: 'history', label: 'History', icon: History },
    { id: 'agents', label: 'Agents', icon: Bot, count: doc.threads.length }
  ];
  return (
    <aside className="dd-rail" aria-label="Comments, history and agents">
      <div className="dd-rail-tabs" role="tablist">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`dd-rail-tab${tab === entry.id ? ' on' : ''}`}
            onClick={() => onTab(entry.id)}
          >
            <entry.icon size={13} aria-hidden />
            {entry.label}
            {entry.count ? <span className="dd-count">{entry.count}</span> : null}
          </button>
        ))}
        {onClose ? (
          <>
            <span className="dd-spacer" />
            <IconButton icon={X} label="Close" onClick={onClose} size={13} />
          </>
        ) : null}
      </div>
      {tab === 'comments' ? (
        <CommentsPane
          doc={doc}
          activePath={activePath}
          now={now}
          pendingQuote={pendingQuote}
          onClearQuote={onClearQuote}
          draft={commentDraft}
          onDraft={onCommentDraft}
          onFocusComment={onFocusComment}
        />
      ) : tab === 'history' ? (
        <HistoryPane doc={doc} activePath={activePath} now={now} selectedId={selectedRevision} onSelect={onSelectRevision} />
      ) : (
        <AgentsPane doc={doc} now={now} />
      )}
    </aside>
  );
}

function FileSwitcher({
  doc,
  activePath,
  onOpen,
  onPathChanged,
  hasDraft
}: {
  doc: DesignDocDetail;
  activePath: string | null;
  onOpen(path: string): void;
  onPathChanged(from: string, to: string | null): void;
  hasDraft(path: string): boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = doc.files.find((file) => file.path === activePath);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="start"
      className="dd-switcher-pop"
      anchor={
        <button type="button" className="dd-switcher" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)} title="Files in this doc">
          {active ? <FileIcon kind={active.kind} /> : null}
          <span>{doc.files.length} files</span>
          <ChevronDown size={12} aria-hidden />
        </button>
      }
    >
      <FileTree
        doc={doc}
        activePath={activePath}
        onOpen={(path) => {
          setOpen(false);
          onOpen(path);
        }}
        onPathChanged={onPathChanged}
        hasDraft={hasDraft}
      />
    </Popover>
  );
}

/**
 * One design doc: header, file tree, the active file (preview / edit / split
 * or a past revision) and the review rail. `compact` fits a thread side panel.
 */
export function DocView({
  docId,
  path,
  onOpenPath,
  layout,
  contextProjectId = null,
  onDeleted,
  headerExtra
}: {
  docId: string;
  path: string | null;
  /** Show another file; `replace` when it is not a new history step. */
  onOpenPath(path: string | null, replace?: boolean): void;
  layout: DocLayout;
  contextProjectId?: string | null;
  onDeleted(): void;
  headerExtra?: ReactNode;
}) {
  const doc = useDoc(docId);
  const projects = useProjects();
  const now = useNow();
  const compact = layout === 'compact';
  const [measureRef, tier] = useWidthTier(DOC_BREAKPOINTS);
  // Unmeasured counts as wide: keep every column until there is clearly no room.
  const treeInline = !compact && (tier ?? DOC_BREAKPOINTS.length) >= 1;
  const railInline = !compact && (tier ?? DOC_BREAKPOINTS.length) >= 2;
  const [mode, setMode] = usePersistentState<ViewMode>('view-mode', 'preview');
  // Separate memories: closing the floating rail must not hide the inline one.
  const [inlineRailOpen, setInlineRailOpen] = usePersistentState<boolean>('rail', true);
  const [floatingRailOpen, setFloatingRailOpen] = usePersistentState<boolean>('rail-compact', false);
  const railOpen = railInline ? inlineRailOpen : floatingRailOpen;
  const setRailOpen = railInline ? setInlineRailOpen : setFloatingRailOpen;
  const [tab, setTab] = usePersistentState<RailTab>('rail-tab', 'comments');
  const [pendingQuote, setPendingQuote] = useState<PendingQuote | null>(null);
  // Here rather than in the rail so it survives switching tabs or closing a floating rail.
  const [commentDraft, setCommentDraft] = useState('');
  const [askRequest, setAskRequest] = useState<AskRequest | null>(null);
  const [revision, setRevision] = useState<DesignDocRevision | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [focus, setFocus] = useState<{ path: string; quote: string; nonce: number } | null>(null);
  const editor = useRef<EditorState>({ dirty: false, saving: false });
  // Mirrors editor.current.dirty for rendering; the ref answers synchronous checks.
  const [dirty, setDirty] = useState(false);
  const previewHandle = useRef<PreviewHandle | null>(null);
  const shownPath = useRef<string | null>(null);
  // The path a save just put back, until the doc reloads with it.
  const recreating = useRef<string | null>(null);
  const data = doc.data;
  const resolvedPath = data ? resolveActivePath(data, path) : null;
  // An agent deleted or renamed the file being edited: stay on it so the draft
  // is not swapped for another file. FilePane offers to save it back.
  const shownMissing = !!data && !!shownPath.current && !data.files.some((file) => file.path === shownPath.current);
  if (!shownMissing) recreating.current = null;
  const keepDraft = shownMissing && (dirty || recreating.current === shownPath.current);
  const activePath = keepDraft ? shownPath.current : resolvedPath;
  shownPath.current = activePath;
  const deletedElsewhere = !!data && !!doc.error && isMissingDoc(doc.error);
  const latest = useRef({ onDeleted, title: data?.title ?? '' });
  latest.current = { onDeleted, title: data?.title ?? latest.current.title };

  const onEditorState = useCallback((state: EditorState) => {
    // A save finished; if it recreated the shown file, the reload has not caught up yet.
    if (editor.current.saving && !state.saving && !state.dirty) recreating.current = shownPath.current;
    editor.current = state;
    setDirty(state.dirty);
  }, []);

  const dropDraft = useCallback(() => {
    editor.current = { dirty: false, saving: false };
    recreating.current = null;
    setDirty(false);
  }, []);

  /** Run `action` now, or after the user agrees to drop unsaved edits. */
  const guard = useCallback((action: () => void) => {
    if (!editor.current.dirty) {
      action();
      return;
    }
    setConfirm({
      title: 'Discard unsaved changes?',
      body: 'Your edits to this file have not been saved.',
      confirmLabel: 'Discard',
      danger: true,
      run: () => {
        dropDraft();
        action();
      }
    });
  }, [dropDraft]);

  const openPath = useCallback(
    (next: string) => {
      if (next === activePath) {
        setRevision(null);
        return;
      }
      guard(() => {
        setRevision(null);
        onOpenPath(next);
      });
    },
    [activePath, guard, onOpenPath]
  );

  // Deleted by an agent or in another window: leave instead of showing a stale copy.
  useEffect(() => {
    if (!deletedElsewhere) return;
    toast(`“${latest.current.title}” was deleted`);
    latest.current.onDeleted();
  }, [deletedElsewhere]);

  // Scroll to a comment's quote once its file has rendered (mermaid and images settle late).
  useEffect(() => {
    if (!focus || focus.path !== activePath || revision) return;
    const timers = [80, 300, 900].map((delay) =>
      setTimeout(() => {
        if (previewHandle.current?.focusQuote(focus.quote)) {
          timers.forEach(clearTimeout);
          setFocus(null);
        }
      }, delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [focus, activePath, revision]);

  if (!data) {
    return (
      <div className="dd-doc dd-center">
        {doc.error ? (
          <EmptyState icon={FileWarning} title="This design doc could not be opened">
            {doc.error}
          </EmptyState>
        ) : (
          <Spinner label="Loading design doc" />
        )}
      </div>
    );
  }

  const focusComment = (comment: DesignDocComment) =>
    guard(() => {
      setRevision(null);
      if (comment.path && comment.path !== activePath) onOpenPath(comment.path);
      if (mode !== 'preview') setMode('preview');
      // A floating rail covers the passage it is about to scroll to.
      if (!railInline) setRailOpen(false);
      if (comment.quote) setFocus({ path: comment.path ?? activePath ?? '', quote: comment.quote, nonce: Date.now() });
    });

  const selectRevision = (entry: DesignDocRevision) =>
    guard(() => {
      setRevision(entry);
      if (entry.path !== activePath && data.files.some((file) => file.path === entry.path)) onOpenPath(entry.path);
    });

  const changeMode = (next: ViewMode) => {
    if (next === 'preview') guard(() => setMode(next));
    else setMode(next);
  };

  /** The tree renamed or deleted a file; it already asked before dropping a draft. */
  const pathChanged = (from: string, to: string | null) => {
    if (from !== activePath) return;
    dropDraft();
    onOpenPath(to, true);
  };

  const hasDraft = (file: string) => file === activePath && editor.current.dirty;

  const rail = (
    <Rail
      doc={data}
      tab={tab}
      onTab={setTab}
      activePath={activePath}
      now={now}
      pendingQuote={pendingQuote}
      onClearQuote={() => setPendingQuote(null)}
      commentDraft={commentDraft}
      onCommentDraft={setCommentDraft}
      onFocusComment={focusComment}
      selectedRevision={revision?.id ?? null}
      onSelectRevision={selectRevision}
      onClose={railInline ? undefined : () => setRailOpen(false)}
    />
  );

  return (
    <div ref={measureRef} className={`dd-doc dd-doc-${layout}${railOpen ? ' dd-rail-open' : ''}${railInline ? '' : ' dd-rail-floating'}`}>
      <DocHeader
        doc={data}
        projects={projects.data ?? []}
        compact={compact}
        onDeleted={onDeleted}
        actions={
          <>
            {headerExtra}
            <AskAgentButton doc={data} activePath={activePath} request={askRequest} contextProjectId={contextProjectId} compact={compact} />
          </>
        }
      />
      <div className="dd-doc-body">
        {treeInline ? <FileTree doc={data} activePath={activePath} onOpen={openPath} onPathChanged={pathChanged} hasDraft={hasDraft} /> : null}
        {activePath ? (
          <FilePane
            doc={data}
            path={activePath}
            mode={mode}
            onModeChange={changeMode}
            railOpen={railOpen}
            onToggleRail={() => setRailOpen(!railOpen)}
            revision={revision}
            onCloseRevision={() => setRevision(null)}
            previewHandle={previewHandle}
            onOpenPath={openPath}
            onQuote={(text) => {
              setPendingQuote({ path: activePath, text });
              setTab('comments');
              setRailOpen(true);
            }}
            onAskAbout={(text) => setAskRequest({ prompt: `About this passage in ${activePath}:\n> ${text.replace(/\n/g, '\n> ')}\n\n`, nonce: Date.now() })}
            onEditorState={onEditorState}
            leading={
              treeInline ? null : (
                <FileSwitcher doc={data} activePath={activePath} onOpen={openPath} onPathChanged={pathChanged} hasDraft={hasDraft} />
              )
            }
          />
        ) : (
          <div className="dd-file-pane dd-center">
            <EmptyState icon={FileWarning} title="This doc has no files">
              Add one from the file list, or ask an agent to draft it.
            </EmptyState>
          </div>
        )}
        {railOpen ? rail : null}
      </div>
      {confirm ? <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} /> : null}
    </div>
  );
}
