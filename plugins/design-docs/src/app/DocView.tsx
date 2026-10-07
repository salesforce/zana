import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, FileWarning, History, MessageSquare, Bot, X } from 'lucide-react';
import type { DesignDocComment, DesignDocDetail, DesignDocRevision } from '../shared/contract.js';
import { AgentsPane, AskAgentButton, type AskRequest } from './Agents.js';
import { CommentsPane } from './CommentsPane.js';
import { DocHeader } from './DocHeader.js';
import type { EditorState } from './FileEditor.js';
import { FilePane, type ViewMode } from './FilePane.js';
import type { PreviewHandle } from './FilePreview.js';
import { FileTree } from './FileTree.js';
import { HistoryPane } from './HistoryPane.js';
import { useDoc, useNow, usePersistentState, useProjects } from './hooks.js';
import { ConfirmDialog, EmptyState, FileIcon, IconButton, Popover, Spinner, type ConfirmRequest } from './ui.js';

export type DocLayout = 'workbench' | 'compact';
type RailTab = 'comments' | 'history' | 'agents';

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
  pendingQuote: string | null;
  onClearQuote(): void;
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

function FileSwitcher({ doc, activePath, onOpen, onPathChanged }: { doc: DesignDocDetail; activePath: string | null; onOpen(path: string): void; onPathChanged(from: string, to: string | null): void }) {
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
  const [mode, setMode] = usePersistentState<ViewMode>('view-mode', 'preview');
  const [railOpen, setRailOpen] = usePersistentState(compact ? 'rail-compact' : 'rail', !compact);
  const [tab, setTab] = usePersistentState<RailTab>('rail-tab', 'comments');
  const [pendingQuote, setPendingQuote] = useState<string | null>(null);
  const [askRequest, setAskRequest] = useState<AskRequest | null>(null);
  const [revision, setRevision] = useState<DesignDocRevision | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [focus, setFocus] = useState<{ path: string; quote: string; nonce: number } | null>(null);
  const editor = useRef<EditorState>({ dirty: false, saving: false });
  const previewHandle = useRef<PreviewHandle | null>(null);
  const data = doc.data;
  const activePath = data ? resolveActivePath(data, path) : null;

  const onEditorState = useCallback((state: EditorState) => {
    editor.current = state;
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
        editor.current = { dirty: false, saving: false };
        action();
      }
    });
  }, []);

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

  const focusComment = (comment: DesignDocComment) => {
    if (comment.path && comment.path !== activePath) openPath(comment.path);
    if (mode !== 'preview') setMode('preview');
    if (comment.quote) setFocus({ path: comment.path ?? activePath ?? '', quote: comment.quote, nonce: Date.now() });
  };

  const selectRevision = (entry: DesignDocRevision) =>
    guard(() => {
      setRevision(entry);
      if (entry.path !== activePath && data.files.some((file) => file.path === entry.path)) onOpenPath(entry.path);
    });

  const changeMode = (next: ViewMode) => {
    if (next === 'preview') guard(() => setMode(next));
    else setMode(next);
  };

  const pathChanged = (from: string, to: string | null) => {
    if (from === activePath) onOpenPath(to, true);
  };

  const rail = (
    <Rail
      doc={data}
      tab={tab}
      onTab={setTab}
      activePath={activePath}
      now={now}
      pendingQuote={pendingQuote}
      onClearQuote={() => setPendingQuote(null)}
      onFocusComment={focusComment}
      selectedRevision={revision?.id ?? null}
      onSelectRevision={selectRevision}
      onClose={compact ? () => setRailOpen(false) : undefined}
    />
  );

  return (
    <div className={`dd-doc dd-doc-${layout}${railOpen ? ' dd-rail-open' : ''}`}>
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
        {compact ? null : <FileTree doc={data} activePath={activePath} onOpen={openPath} onPathChanged={pathChanged} />}
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
              setPendingQuote(text);
              setTab('comments');
              setRailOpen(true);
            }}
            onAskAbout={(text) => setAskRequest({ prompt: `About this passage in ${activePath}:\n> ${text.replace(/\n/g, '\n> ')}\n\n`, nonce: Date.now() })}
            onEditorState={onEditorState}
            leading={compact ? <FileSwitcher doc={data} activePath={activePath} onOpen={openPath} onPathChanged={pathChanged} /> : null}
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
