import { useCallback, useDeferredValue, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, FileWarning, RotateCcw, Save } from 'lucide-react';
import type { DesignDocFile } from '../shared/contract.js';
import { errorMessage, isConflict, toast, useApi, type WriteResult } from './api.js';
import { ActorLabel, Spinner } from './ui.js';

export interface EditorState {
  dirty: boolean;
  saving: boolean;
}

interface Conflict {
  revision: number;
  fileId: string | null;
  by: DesignDocFile['updatedBy'];
  verified: boolean;
}

/**
 * Plain-text editing with optimistic concurrency: the draft remembers the
 * revision it started from, and a save that races an agent's write surfaces
 * a choice instead of silently overwriting either side.
 */
export function FileEditor({
  docId,
  file,
  removed = false,
  split,
  renderPreview,
  onStateChange,
  onSaved
}: {
  docId: string;
  file: DesignDocFile;
  /** The file was deleted or renamed under the draft; saving puts it back. */
  removed?: boolean;
  split: boolean;
  renderPreview(content: string): ReactNode;
  onStateChange?(state: EditorState): void;
  onSaved?(result: WriteResult): void;
}) {
  const api = useApi();
  const [draft, setDraft] = useState(file.content);
  const [saved, setSaved] = useState({ content: file.content, revision: file.revision, fileId: file.fileId });
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const dirty = draft !== saved.content;
  const preview = useDeferredValue(draft);
  const latest = useRef({ dirty, draft, saved });
  const awaitingRefresh = useRef<DesignDocFile | null>(null);
  latest.current = { dirty, draft, saved };

  // Follow remote revisions while clean; flag them while dirty.
  useEffect(() => {
    const { dirty, saved } = latest.current;
    if (removed) {
      setConflict(null);
      return;
    }
    const previous = awaitingRefresh.current;
    if (previous?.fileId === file.fileId && previous.revision === file.revision) return;
    awaitingRefresh.current = null;
    if (file.fileId === saved.fileId && file.revision < saved.revision) return;
    if (file.revision === saved.revision && file.fileId === saved.fileId) return;
    if (!dirty) {
      setDraft(file.content);
      setSaved({ content: file.content, revision: file.revision, fileId: file.fileId });
      setConflict(null);
    } else {
      setConflict({ revision: file.revision, fileId: file.fileId, by: file.updatedBy, verified: true });
    }
  }, [file.revision, file.fileId, file.content, file.updatedBy, removed]);

  useEffect(() => {
    onStateChange?.({ dirty, saving });
  }, [dirty, saving, onStateChange]);

  const save = useCallback(
    async (base?: { revision: number; fileId: string | null }) => {
      if (saving) return;
      setSaving(true);
      try {
        // Revision 0 recreates a removed file, unless someone already did.
        const observed = base ?? (removed ? { revision: 0, fileId: null } : saved);
        const result = await api.writeFile(docId, { path: file.path, content: draft, baseRevision: observed.revision, baseFileId: observed.fileId });
        // The doc reload may still carry the pre-save sticky file until its content fetch finishes.
        awaitingRefresh.current = file;
        setSaved({ content: draft, revision: result.revision, fileId: result.fileId });
        setConflict(null);
        onSaved?.(result);
      } catch (error) {
        if (isConflict(error)) {
          try {
            const latest = await api.readFile(docId, file.path);
            setConflict({ revision: latest.revision, fileId: latest.fileId, by: latest.updatedBy, verified: true });
          } catch (readError) {
            const missing = /not found/i.test(errorMessage(readError));
            setConflict({ revision: missing ? 0 : saved.revision, fileId: missing ? null : saved.fileId, by: file.updatedBy, verified: missing });
          }
        } else {
          toast(`Could not save ${file.path}: ${errorMessage(error)}`, 'error');
        }
      } finally {
        setSaving(false);
      }
    },
    [api, docId, draft, file.path, file.updatedBy, onSaved, removed, saved, saving]
  );

  const loadLatest = async () => {
    try {
      const latest = await api.readFile(docId, file.path);
      setDraft(latest.content);
      setSaved({ content: latest.content, revision: latest.revision, fileId: latest.fileId });
      setConflict(null);
    } catch (error) {
      toast(`Could not reload ${file.path}: ${errorMessage(error)}`, 'error');
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (dirty && !conflict) void save();
      return;
    }
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      const target = event.currentTarget;
      const { selectionStart, selectionEnd, value } = target;
      const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
      setDraft(next);
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = selectionStart + 2;
      });
    }
  };

  return (
    <div className="dd-editor">
      {removed && dirty && !conflict ? (
        <div className="dd-banner dd-banner-warn" role="alert">
          <FileWarning size={14} aria-hidden />
          <span className="dd-banner-text">
            {file.path} was deleted or renamed while you were editing. Save puts it back with your edits; Revert drops them.
          </span>
        </div>
      ) : null}
      {conflict ? (
        <div className="dd-banner dd-banner-warn" role="alert">
          <AlertTriangle size={14} aria-hidden />
          <span className="dd-banner-text">
            <ActorLabel actor={conflict.by} /> saved revision {conflict.revision} while you were editing.
          </span>
          <button type="button" className="btn" onClick={() => void loadLatest()}>
            <RotateCcw size={12} aria-hidden /> Discard mine
          </button>
          <button type="button" className="btn" disabled={saving || !conflict.verified} onClick={() => void save(conflict)}>
            Overwrite with mine
          </button>
        </div>
      ) : null}
      <div className={`dd-editor-body${split ? ' dd-editor-split' : ''}`}>
        <textarea
          className="dd-editor-input"
          value={draft}
          spellCheck={file.kind === 'markdown' || file.kind === 'text'}
          aria-label={`Edit ${file.path}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
        {split ? <div className="dd-editor-preview">{renderPreview(preview)}</div> : null}
      </div>
      <div className="dd-editor-footer">
        <span className="dd-editor-state">
          {saving ? <Spinner size={12} label="Saving" /> : null}
          {saving ? 'Saving…' : dirty ? 'Unsaved changes' : `Saved · rev ${saved.revision}`}
        </span>
        <span className="dd-editor-hint">⌘S to save</span>
        <button type="button" className="btn" disabled={!dirty || saving} onClick={() => setDraft(saved.content)}>
          Revert
        </button>
        <button type="button" className="btn primary" disabled={!dirty || saving || !!conflict} onClick={() => void save()}>
          <Save size={12} aria-hidden /> Save
        </button>
      </div>
    </div>
  );
}
