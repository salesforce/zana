import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { product } from '../../../lib/product-client.js';
import { applyIfCurrent } from './threadSecondaryPanelLogic.js';

export function ThreadStorageBrowser({
  threadId,
  onOpenFile
}: {
  threadId: string;
  onOpenFile?: (path: string, title: string) => void;
}) {
  const [files, setFiles] = useState<Array<{ path: string; name: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void product.threads.storageFiles(threadId).then((next) => {
      applyIfCurrent(cancelled, next.files, setFiles);
    }).catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Could not load thread storage');
        setFiles([]);
      }
    });
    return () => { cancelled = true; };
  }, [threadId]);

  const rows = files ?? [];
  return (
    <div className="thread-info-storage" data-testid="thread-info-storage">
      <h3>Thread storage</h3>
      {error ? (
        <p className="thread-detail-empty">{error}</p>
      ) : files === null ? (
        <p className="thread-detail-empty">Loading files…</p>
      ) : rows.length === 0 ? (
        <p className="thread-detail-empty">No files yet.</p>
      ) : (
        <ul>
          {rows.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                title={file.path}
                onClick={() => onOpenFile?.(file.path, file.name)}
              >
                <FileText size={14} aria-hidden />
                <span className="thread-info-truncate">{file.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
