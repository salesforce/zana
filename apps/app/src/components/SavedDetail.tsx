import { useCallback, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { deleteSavedRecord, useSaved, useSavedSelection, useUi } from '../store.js';
import { DocContent, MarkdownContent } from './MarkdownContent.js';
import { DelayedStencilLines } from './ui/Skeleton.js';
import type { SavedDoc, SavedRecord } from '@zana-ai/zcc-domain/product';

interface SavedDetailProps {
  /** Gates the Delete/Backspace shortcut to when the Saved tab is actually visible. */
  visible: boolean;
}

/**
 * Saved-report detail pane — the "Saved" tab twin of {@link InboxDetail}. Unlike
 * the inbox detail (which re-reads docs live from the project), a saved report is
 * a FROZEN snapshot: doc contents were captured at save time and stored in the
 * record, so this pane renders them directly and works even after the project's
 * files change, move, or the project is deleted.
 *
 * Selection is owned by {@link useSavedSelection}; the Saved sidebar drives it.
 * Delete lives here (like the inbox detail) because it advances selection after
 * removal, which needs the full record list.
 */
export function SavedDetail({ visible }: SavedDetailProps) {
  const records = useSaved((s) => s.records);
  const loading = useSaved((s) => s.loading);
  const selectedId = useSavedSelection((s) => s.selectedSavedId);
  const select = useSavedSelection((s) => s.selectSaved);

  const selected = records.find((r) => r.id === selectedId) ?? null;

  const handleDelete = useCallback(
    async (id: string) => {
      const idx = records.findIndex((r) => r.id === id);
      if (idx < 0) return;
      // records are newest-first; advance to the next older, else previous.
      const nextId = records[idx + 1]?.id ?? records[idx - 1]?.id ?? null;
      select(nextId);
      await deleteSavedRecord(id);
    },
    [records, select]
  );

  useEffect(() => {
    if (!visible || !selectedId) return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault();
      void handleDelete(selectedId!);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selectedId, handleDelete]);

  if (loading && records.length === 0) {
    return <DelayedStencilLines label="Loading saved report" className="zcc-stencil-padded" />;
  }
  if (records.length === 0) {
    return (
      <div className="inbox-detail-empty-state">
        <div className="inbox-detail-empty-title">No saved reports yet</div>
        <p className="inbox-detail-empty-body">
          When a report lands in your inbox, open it and click the bookmark to save a durable copy
          here. Saved reports keep a frozen snapshot of their documents, so they stay readable even
          after the project&rsquo;s files change or the project is removed.
        </p>
      </div>
    );
  }
  if (!selected) {
    return <div className="inbox-detail-empty">Select a saved report from the sidebar.</div>;
  }
  return <Detail record={selected} onDelete={() => handleDelete(selected.id)} />;
}

function Detail({ record, onDelete }: { record: SavedRecord; onDelete: () => void }) {
  const pushToast = useUi((s) => s.pushToast);
  const displayLabel = record.projectLabel ?? record.projectId;
  const hasDocs = (record.docs?.length ?? 0) > 0;
  const hasComments = (record.comments ?? '').trim().length > 0;

  const copyComments = () => {
    const text = record.comments ?? '';
    void navigator.clipboard.writeText(text).then(
      () => pushToast('Notes copied', 'info'),
      () => pushToast('Failed to copy', 'error')
    );
  };

  return (
    <div className="inbox-detail">
      <div className="inbox-detail-header">
        <span className="inbox-detail-label">{displayLabel}</span>
        <span className="inbox-detail-ts-sep">·</span>
        <span className="inbox-detail-session" title="Saved report">
          saved
        </span>
        <span className="inbox-detail-ts">
          {formatAbsolute(record.savedAt)}
          <span className="inbox-detail-ts-sep">·</span>
          {formatRelative(record.savedAt)}
        </span>
        {hasComments && (
          <button
            type="button"
            onClick={copyComments}
            className="inbox-detail-download"
            title="Copy notes to clipboard"
            aria-label="Copy notes to clipboard"
          >
            {/* Reuse the download button's styling for a neutral header action. */}
            <span aria-hidden style={{ fontSize: 12, fontWeight: 600 }}>⧉</span>
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="inbox-detail-trash"
          title="Delete this saved report (Delete / Backspace)"
          aria-label="Delete this saved report"
        >
          <Trash2 size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div className="inbox-detail-title saved-detail-title">{record.title}</div>

      {hasDocs && (
        <div className="inbox-detail-docs">
          {record.docs!.map((doc, i) => (
            <SavedDocBlock key={`${doc.path}:${i}`} doc={doc} />
          ))}
        </div>
      )}

      {hasComments && (
        <div className={`inbox-detail-comments ${hasDocs ? 'has-divider' : ''}`}>
          <div className="inbox-detail-section-label">Saved notes</div>
          <MarkdownContent text={record.comments!} exportable />
        </div>
      )}

      <div className="inbox-detail-meta-id">project: {record.projectId}</div>
    </div>
  );
}

/**
 * Render one SNAPSHOTTED doc from the record. No live fetch — the content was
 * frozen at save time. Falls back to the recorded error / binary / truncation
 * note when there's no renderable snapshot.
 */
function SavedDocBlock({ doc }: { doc: SavedDoc }) {
  return (
    <div className="inbox-doc">
      <div className="inbox-doc-header">
        <span className="inbox-doc-icon">📄</span>
        <span className="inbox-doc-path">{doc.path}</span>
        {doc.truncated && (
          <span className="inbox-doc-badge" title="Snapshot was truncated at save time">
            truncated
          </span>
        )}
      </div>
      <div className="inbox-doc-body">
        {typeof doc.content === 'string' ? (
          <DocContent path={doc.path} content={doc.content} exportable />
        ) : (
          <div className="inbox-doc-tombstone">{docSnapshotError(doc)}</div>
        )}
      </div>
    </div>
  );
}

/** Human-readable reason a saved doc has no renderable snapshot. */
function docSnapshotError(doc: SavedDoc): string {
  if (doc.binary) return 'File was binary — not snapshotted.';
  if (doc.error) return doc.error;
  return 'No snapshot was captured for this document.';
}

function formatAbsolute(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
