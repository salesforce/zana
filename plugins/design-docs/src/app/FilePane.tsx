import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Bot, Columns2, Eye, PanelRight, Pencil } from 'lucide-react';
import type { DesignDocDetail, DesignDocFile, DesignDocRevision } from '../shared/contract.js';
import { formatBytes } from '../shared/display.js';
import { isBinaryKind } from '../shared/paths.js';
import { FileEditor, type EditorState } from './FileEditor.js';
import { FilePreview, type PreviewHandle } from './FilePreview.js';
import { RevisionView } from './HistoryPane.js';
import { useFile } from './hooks.js';
import { ActorLabel, FileIcon, IconButton, Spinner, TimeAgo } from './ui.js';

export type ViewMode = 'preview' | 'edit' | 'split';

const MODES: Array<{ id: ViewMode; label: string; icon: typeof Eye }> = [
  { id: 'preview', label: 'Preview', icon: Eye },
  { id: 'edit', label: 'Edit', icon: Pencil },
  { id: 'split', label: 'Split', icon: Columns2 }
];

/** Keep showing the last loaded content of a path while its next revision loads. */
function useStickyFile(docId: string, path: string, revision: number | null) {
  const resource = useFile(docId, path, revision);
  const last = useRef<DesignDocFile | null>(null);
  if (resource.data) last.current = resource.data;
  const sticky = last.current && last.current.path === path ? last.current : null;
  return { file: resource.data ?? sticky, error: resource.error, loading: resource.loading };
}

/** A short "Updated by Agent X" flash when someone else's edit lands. */
function useAgentFlash(path: string, revision: number | null, actor: DesignDocFile['updatedBy'] | undefined) {
  const [flash, setFlash] = useState<string | null>(null);
  const seen = useRef<{ path: string; revision: number | null }>({ path, revision });
  useEffect(() => {
    const previous = seen.current;
    seen.current = { path, revision };
    if (previous.path !== path || revision === null || previous.revision === null || revision <= previous.revision) return;
    if (actor?.kind !== 'agent') return;
    setFlash(actor.label);
    const timer = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(timer);
  }, [path, revision, actor]);
  return flash;
}

export function FilePane({
  doc,
  path,
  mode,
  onModeChange,
  railOpen,
  onToggleRail,
  revision,
  onCloseRevision,
  previewHandle,
  onOpenPath,
  onQuote,
  onAskAbout,
  onEditorState,
  leading
}: {
  doc: DesignDocDetail;
  path: string;
  mode: ViewMode;
  onModeChange(mode: ViewMode): void;
  railOpen: boolean;
  onToggleRail(): void;
  revision: DesignDocRevision | null;
  onCloseRevision(): void;
  previewHandle: MutableRefObject<PreviewHandle | null>;
  onOpenPath(path: string): void;
  onQuote(text: string): void;
  onAskAbout(text: string): void;
  onEditorState(state: EditorState): void;
  /** Extra toolbar content before the path (the compact file switcher). */
  leading?: ReactNode;
}) {
  const meta = doc.files.find((file) => file.path === path) ?? null;
  const { file, error, loading } = useStickyFile(doc.id, path, meta?.revision ?? null);
  const flash = useAgentFlash(path, meta?.revision ?? null, meta?.updatedBy);
  const editable = !meta || !isBinaryKind(meta.kind);
  const effectiveMode: ViewMode = editable ? mode : 'preview';
  const quotes = useMemo(
    () =>
      doc.comments
        .filter((comment) => comment.status === 'open' && comment.path === path && comment.quote)
        .map((comment) => comment.quote!),
    [doc.comments, path]
  );
  const slash = path.lastIndexOf('/');

  useEffect(() => {
    if (effectiveMode === 'preview') onEditorState({ dirty: false, saving: false });
  }, [effectiveMode, onEditorState]);

  let body: ReactNode;
  if (revision) {
    body = <RevisionView key={revision.id} doc={doc} revision={revision} onClose={onCloseRevision} onOpenPath={onOpenPath} />;
  } else if (!meta && !(file && effectiveMode !== 'preview')) {
    body = <div className="dd-center dd-muted">{path} is not in this doc anymore.</div>;
  } else if (!file) {
    body = <div className="dd-center">{error ? <div className="dd-banner dd-banner-error">{error}</div> : loading ? <Spinner label="Loading file" /> : null}</div>;
  } else if (effectiveMode === 'preview') {
    body = (
      <FilePreview
        docId={doc.id}
        file={file}
        files={doc.files}
        quotes={quotes}
        onOpenPath={onOpenPath}
        onQuote={onQuote}
        onAskAbout={onAskAbout}
        handleRef={previewHandle}
      />
    );
  } else {
    body = (
      <FileEditor
        key={`${doc.id}\u0000${path}`}
        docId={doc.id}
        file={file}
        removed={!meta}
        split={effectiveMode === 'split'}
        onStateChange={onEditorState}
        renderPreview={(content) => (
          <FilePreview docId={doc.id} file={{ ...file, content }} files={doc.files} onOpenPath={onOpenPath} draft={content !== file.content} />
        )}
      />
    );
  }

  return (
    <section className="dd-file-pane" aria-label={path}>
      <div className="dd-file-toolbar">
        {leading}
        {meta ? <FileIcon kind={meta.kind} /> : null}
        <span className="dd-file-path" title={path}>
          {slash > 0 ? <span className="dd-file-dir">{path.slice(0, slash + 1)}</span> : null}
          <span className="dd-file-name">{path.slice(slash + 1)}</span>
        </span>
        {meta ? (
          <span className="dd-file-meta">
            rev {meta.revision} · {formatBytes(meta.size)} · <ActorLabel actor={meta.updatedBy} /> <TimeAgo at={meta.updatedAt} now={Date.now()} />
          </span>
        ) : null}
        {flash ? (
          <span className="dd-flash" role="status">
            <Bot size={12} aria-hidden /> Updated by {flash}
          </span>
        ) : null}
        <span className="dd-spacer" />
        {revision ? null : (
          <div className="dd-segmented dd-mode" role="group" aria-label="View mode">
            {MODES.map((option) => (
              <button
                key={option.id}
                type="button"
                className={effectiveMode === option.id ? 'on' : ''}
                disabled={!editable && option.id !== 'preview'}
                onClick={() => onModeChange(option.id)}
                title={option.label}
                aria-pressed={effectiveMode === option.id}
              >
                <option.icon size={13} aria-hidden />
                <span className="dd-mode-label">{option.label}</span>
              </button>
            ))}
          </div>
        )}
        <IconButton icon={PanelRight} label={railOpen ? 'Hide comments & history' : 'Show comments & history'} active={railOpen} onClick={onToggleRail} />
      </div>
      <div className="dd-file-body">{body}</div>
    </section>
  );
}
