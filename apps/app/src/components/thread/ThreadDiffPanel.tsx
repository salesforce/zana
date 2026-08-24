import { useEffect, useState } from 'react';
import type { WorkspaceDiffResponse } from '@zana-ai/zcc-domain';
import { product } from '../../lib/product-client.js';
import { DiffViewer } from '../DiffViewer.js';
import { diffPanelPhase, hunkForPath } from './thread-diff.js';

export function ThreadDiffPanel({
  environmentId,
  path,
  onClose,
  embedded
}: {
  environmentId: string;
  path: string | null;
  onClose: () => void;
  embedded?: boolean;
}) {
  const [diff, setDiff] = useState<WorkspaceDiffResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    void product.environments.diff(environmentId).then((next) => {
      if (!cancelled) setDiff(next);
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load diff');
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId]);

  const hunk = hunkForPath(diff?.diff ?? '', path ?? '');
  const phase = diffPanelPhase(error, Boolean(diff));
  return (
    <aside className={`thread-diff-panel${embedded ? ' is-embedded' : ''}`} data-testid="thread-diff-panel">
      {embedded ? (
        path ? <h2 className="thread-diff-embedded-title">{path}</h2> : null
      ) : (
        <header className="thread-detail-header">
          <h2>{path || 'Workspace changes'}</h2>
          <button type="button" className="icon-btn" aria-label="Close diff" onClick={onClose}>×</button>
        </header>
      )}
      {phase === 'error' ? (
        <p className="thread-diff-error">{error}</p>
      ) : phase === 'ready' && diff ? (
        <>
          {diff.truncated ? (
            <p className="thread-diff-truncated">Diff truncated — showing the first portion.</p>
          ) : null}
          <DiffViewer
            original={hunk.original}
            modified={hunk.modified}
            path={path || 'workspace.diff'}
            compact
          />
        </>
      ) : (
        <p className="thread-detail-empty">Loading diff…</p>
      )}
    </aside>
  );
}
