import { useEffect, useState } from 'react';
import type { WorkspaceDiffResponse } from '@zana-ai/zcc-domain';
import { product } from '../../lib/product-client.js';
import { DiffViewer } from '../DiffViewer.js';
import { hunkForPath } from './thread-diff.js';

export function ThreadDiffPanel({
  environmentId,
  path,
  onClose
}: {
  environmentId: string;
  path: string | null;
  onClose: () => void;
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
  return (
    <aside className="thread-diff-panel" data-testid="thread-diff-panel">
      <header className="thread-detail-header">
        <h2>{path || 'Workspace changes'}</h2>
        <button type="button" className="icon-btn" aria-label="Close diff" onClick={onClose}>×</button>
      </header>
      {error ? <p className="thread-command-error">{error}</p> : null}
      {diff ? (
        <DiffViewer
          original={hunk.original}
          modified={hunk.modified}
          path={path || 'workspace.diff'}
          compact
        />
      ) : (
        <p className="thread-detail-empty">Loading diff…</p>
      )}
    </aside>
  );
}
