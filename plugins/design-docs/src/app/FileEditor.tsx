import { useCallback, useDeferredValue, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Save } from 'lucide-react';
import type { DesignDocFile } from '../shared/contract.js';
import { errorMessage, isConflict, toast, useApi, type WriteResult } from './api.js';
import { ActorLabel, Spinner } from './ui.js';

export interface EditorState {
  dirty: boolean;
  saving: boolean;
}

interface Conflict {
  revision: number;
  by: DesignDocFile['updatedBy'];
}

/**
 * Plain-text editing with optimistic concurrency: the draft remembers the
 * revision it started from, and a save that races an agent's write surfaces
 * a choice instead of silently overwriting either side.
 */
export function FileEditor({
  docId,
  file,
  split,
  renderPreview,
  onStateChange,
  onSaved
}: {
  docId: string;
  file: DesignDocFile;
  split: boolean;
  renderPreview(content: string): ReactNode;
  onStateChange?(state: EditorState): void;
  onSaved?(result: WriteResult): void;
}) {
  const api = useApi();
  const [draft, setDraft] = useState(file.content);
  const [saved, setSaved] = useState({ content: file.content, revision: file.revision });
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const dirty = draft !== saved.content;
  const preview = useDeferredValue(draft);
  const latest = useRef({ dirty, draft, saved });
  latest.current = { dirty, draft, saved };

  // Follow remote revisions while clean; flag them while dirty.
  useEffect(() => {
    const { dirty, draft, saved } = latest.current;
    if (file.revision === saved.revision) return;
    if (!dirty || file.content === draft) {
      setDraft(file.content);
      setSaved({ content: file.content, revision: file.revision });
      setConflict(null);
    } else {
      setConflict({ revision: file.revision, by: file.updatedBy });
    }
  }, [file.revision, file.content, file.updatedBy]);

  useEffect(() => {
    onStateChange?.({ dirty, saving });
  }, [dirty, saving, onStateChange]);

  const save = useCallback(
    async (baseRevision = saved.revision) => {
      if (saving) return;
      setSaving(true);
      try {
        const result = await api.writeFile(docId, { path: file.path, content: draft, baseRevision });
        setSaved({ content: draft, revision: result.revision });
        setConflict(null);
        onSaved?.(result);
      } catch (error) {
        if (isConflict(error)) {
          const latest = await api.readFile(docId, file.path).catch(() => null);
          setConflict({ revision: latest?.revision ?? saved.revision + 1, by: latest?.updatedBy ?? file.updatedBy });
        } else {
          toast(`Could not save ${file.path}: ${errorMessage(error)}`, 'error');
        }
      } finally {
        setSaving(false);
      }
    },
    [api, docId, draft, file.path, file.updatedBy, onSaved, saved.revision, saving]
  );

  const loadLatest = async () => {
    try {
      const latest = await api.readFile(docId, file.path);
      setDraft(latest.content);
      setSaved({ content: latest.content, revision: latest.revision });
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
      {conflict ? (
        <div className="dd-banner dd-banner-warn" role="alert">
          <AlertTriangle size={14} aria-hidden />
          <span className="dd-banner-text">
            <ActorLabel actor={conflict.by} /> saved revision {conflict.revision} while you were editing.
          </span>
          <button type="button" className="btn" onClick={() => void loadLatest()}>
            <RotateCcw size={12} aria-hidden /> Discard mine
          </button>
          <button type="button" className="btn" onClick={() => void save(conflict.revision)}>
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
