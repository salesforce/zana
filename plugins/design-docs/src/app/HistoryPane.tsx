import { useMemo, useState } from 'react';
import { FilePen, FilePlus2, FileX2, History, MoveRight, RotateCcw, X } from 'lucide-react';
import type { DesignDocDetail, DesignDocRevision, RevisionOp } from '../shared/contract.js';
import { formatBytes } from '../shared/display.js';
import { fileKindOf, isBinaryKind } from '../shared/paths.js';
import { errorMessage, toast, useApi, type RevisionContent } from './api.js';
import { diffStats, foldDiff, lineDiff } from './diff.js';
import { FilePreview } from './FilePreview.js';
import { usePersistentState, useResource } from './hooks.js';
import { ActorLabel, ConfirmDialog, EmptyState, IconButton, Spinner, TimeAgo, type ConfirmRequest, type Icon } from './ui.js';

const OP_ICONS: Record<RevisionOp, Icon> = {
  create: FilePlus2,
  write: FilePen,
  delete: FileX2,
  rename: MoveRight
};

const OP_LABELS: Record<RevisionOp, string> = {
  create: 'Created',
  write: 'Edited',
  delete: 'Deleted',
  rename: 'Renamed'
};

export function HistoryPane({
  doc,
  activePath,
  now,
  selectedId,
  onSelect
}: {
  doc: DesignDocDetail;
  activePath: string | null;
  now: number;
  selectedId: number | null;
  onSelect(revision: DesignDocRevision): void;
}) {
  const api = useApi();
  const [scope, setScope] = usePersistentState<'file' | 'all'>('history-scope', 'file');
  const path = scope === 'file' ? activePath : null;
  // `doc.revision` moves on every write, so the list follows live edits.
  const history = useResource(`${doc.id}\u0000${path ?? '*'}\u0000${doc.revision}`, () =>
    api.history(doc.id, { ...(path ? { path } : {}), limit: 100 })
  );

  return (
    <div className="dd-rail-pane dd-history">
      <div className="dd-rail-toolbar">
        <div className="dd-segmented" role="group" aria-label="History scope">
          <button type="button" className={scope === 'file' ? 'on' : ''} onClick={() => setScope('file')} disabled={!activePath}>
            This file
          </button>
          <button type="button" className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
            All files
          </button>
        </div>
      </div>
      <div className="dd-rail-scroll">
        {history.error ? <div className="dd-banner dd-banner-error">{history.error}</div> : null}
        {!history.data && history.loading ? (
          <div className="dd-center">
            <Spinner label="Loading history" />
          </div>
        ) : null}
        {history.data && !history.data.length ? (
          <EmptyState icon={History} title="No history yet">
            Every save by you or an agent is kept here, so you can compare and restore.
          </EmptyState>
        ) : null}
        <ol className="dd-history-list">
          {history.data?.map((revision) => {
            const Glyph = OP_ICONS[revision.op];
            return (
              <li key={revision.id}>
                <button
                  type="button"
                  className={`dd-history-row${selectedId === revision.id ? ' on' : ''}`}
                  onClick={() => onSelect(revision)}
                >
                  <Glyph size={13} className={`dd-op dd-op-${revision.op}`} aria-hidden />
                  <span className="dd-history-main">
                    <span className="dd-history-title">
                      {OP_LABELS[revision.op]}
                      {path ? null : <span className="dd-history-path">{revision.path}</span>}
                      <span className="dd-history-rev">rev {revision.revision}</span>
                    </span>
                    {revision.note ? <span className="dd-history-note">{revision.note}</span> : null}
                    <span className="dd-history-meta">
                      <ActorLabel actor={revision.actor} />
                      <TimeAgo at={revision.createdAt} now={now} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

interface RevisionPair {
  after: RevisionContent;
  /** null when there is nothing earlier to compare with (created, or pruned). */
  before: string | null;
  pruned: boolean;
}

async function loadRevisionPair(
  api: ReturnType<typeof useApi>,
  docId: string,
  revision: DesignDocRevision
): Promise<RevisionPair> {
  const after = await api.revision(docId, revision.id);
  if (revision.op === 'create' || revision.op === 'rename' || after.encoding === 'base64') {
    return { after, before: null, pruned: false };
  }
  if (revision.op === 'delete') return { after, before: after.content, pruned: false };
  const older = (await api.history(docId, { path: revision.path, limit: 100 })).find((entry) => entry.id < revision.id);
  if (!older) return { after, before: null, pruned: true };
  if (older.op === 'delete') return { after, before: '', pruned: false };
  const previous = await api.revision(docId, older.id);
  return { after, before: previous.content, pruned: false };
}

/** One past revision: what changed in it, or the whole snapshot, plus Restore. */
export function RevisionView({
  doc,
  revision,
  onClose,
  onOpenPath
}: {
  doc: DesignDocDetail;
  revision: DesignDocRevision;
  onClose(): void;
  onOpenPath(path: string): void;
}) {
  const api = useApi();
  const [mode, setMode] = useState<'changes' | 'full'>(revision.op === 'write' || revision.op === 'delete' ? 'changes' : 'full');
  const [restoring, setRestoring] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const pair = useResource(`${doc.id}\u0000${revision.id}`, () => loadRevisionPair(api, doc.id, revision));
  const kind = fileKindOf(revision.path);
  const current = doc.files.find((file) => file.path === revision.path) ?? null;
  const isCurrent = current?.revision === revision.revision && revision.op !== 'delete';

  const diff = useMemo(() => {
    const data = pair.data;
    if (!data || data.before === null || isBinaryKind(kind)) return null;
    const lines = lineDiff(data.before, revision.op === 'delete' ? '' : data.after.content);
    return lines ? { hunks: foldDiff(lines), stats: diffStats(lines) } : 'too-large';
  }, [pair.data, revision.op, kind]);

  const restore = async () => {
    setRestoring(true);
    try {
      // Fails instead of overwriting if the file changed after this view opened.
      const result = await api.restore(doc.id, revision.id, current?.revision ?? 0);
      toast(`Restored ${result.path} to revision ${revision.revision} (now rev ${result.revision})`);
      onOpenPath(result.path);
      onClose();
    } catch (error) {
      toast(`Could not restore: ${errorMessage(error)}`, 'error');
    } finally {
      setRestoring(false);
    }
  };

  const askRestore = () => {
    if (current) {
      void restore();
      return;
    }
    setConfirm({
      title: `Recreate ${revision.path}?`,
      body: (
        <>
          <code>{revision.path}</code> is no longer in this doc{revision.op === 'delete' ? '' : '; it may have been renamed'}. Recreate it with the
          content of revision {revision.revision}?
        </>
      ),
      confirmLabel: 'Recreate',
      run: () => void restore()
    });
  };

  const canDiff = diff !== null;
  const showFull = mode === 'full' || !canDiff;

  return (
    <div className="dd-revision">
      <div className="dd-banner dd-banner-info dd-revision-banner">
        <History size={14} aria-hidden />
        <span className="dd-banner-text">
          <strong>{OP_LABELS[revision.op]}</strong> {revision.path} · rev {revision.revision} by <ActorLabel actor={revision.actor} />{' '}
          <TimeAgo at={revision.createdAt} now={Date.now()} />
          {revision.renamedFrom ? <> · from {revision.renamedFrom}</> : null}
          {revision.note ? <span className="dd-revision-note"> — {revision.note}</span> : null}
        </span>
        {canDiff ? (
          <div className="dd-segmented" role="group" aria-label="Revision view">
            <button type="button" className={mode === 'changes' ? 'on' : ''} onClick={() => setMode('changes')}>
              Changes
            </button>
            <button type="button" className={mode === 'full' ? 'on' : ''} onClick={() => setMode('full')}>
              Full file
            </button>
          </div>
        ) : null}
        <button type="button" className="btn" disabled={isCurrent || restoring || !pair.data} onClick={askRestore}>
          <RotateCcw size={12} aria-hidden /> {isCurrent ? 'Current' : current ? 'Restore' : 'Recreate file'}
        </button>
        <IconButton icon={X} label="Close revision" onClick={onClose} />
      </div>
      <div className="dd-revision-body">
        {pair.error ? <div className="dd-banner dd-banner-error">{pair.error}</div> : null}
        {!pair.data ? (
          pair.loading ? (
            <div className="dd-center">
              <Spinner label="Loading revision" />
            </div>
          ) : null
        ) : showFull ? (
          <>
            {pair.data.pruned ? <p className="dd-muted dd-revision-hint">Earlier revisions of this file were pruned, so only the snapshot is shown.</p> : null}
            {diff === 'too-large' ? <p className="dd-muted dd-revision-hint">This change is too large to diff; showing the full snapshot.</p> : null}
            <FilePreview
              docId={doc.id}
              file={{ path: revision.path, kind, content: pair.data.after.content, encoding: pair.data.after.encoding }}
              files={doc.files}
              onOpenPath={onOpenPath}
              draft
            />
          </>
        ) : diff && diff !== 'too-large' ? (
          <div className="dd-diff" role="table" aria-label={`Changes in revision ${revision.revision}`}>
            <div className="dd-diff-stats">
              <span className="dd-diff-added">+{diff.stats.added}</span>
              <span className="dd-diff-removed">−{diff.stats.removed}</span>
              <span className="dd-muted">{formatBytes(revision.size)}</span>
            </div>
            {diff.hunks.map((hunk, index) =>
              hunk.type === 'gap' ? (
                <div key={index} className="dd-diff-gap">
                  ⋯ {hunk.count} unchanged line{hunk.count === 1 ? '' : 's'}
                </div>
              ) : (
                hunk.lines.map((line, offset) => (
                  <div key={`${index}-${offset}`} className={`dd-diff-line dd-diff-${line.type}`} role="row">
                    <span className="dd-diff-sign" aria-hidden>
                      {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
                    </span>
                    <span className="dd-diff-text">{line.text || ' '}</span>
                  </div>
                ))
              )
            )}
            {diff.stats.added + diff.stats.removed === 0 ? <p className="dd-muted dd-revision-hint">No line changes in this revision.</p> : null}
          </div>
        ) : null}
      </div>
      {confirm ? <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} /> : null}
    </div>
  );
}
