import { useEffect, useState } from 'react';
import { FileText, HardDrive } from 'lucide-react';
import { product } from '../../../lib/product-client.js';
import { applyIfCurrent } from './threadSecondaryPanelLogic.js';
import { StencilList } from '../../ui/Skeleton.js';

export type ThreadStorageFile = { path: string; name: string };

export function storageStatusLabel(
  files: ThreadStorageFile[] | null,
  error: string | null,
  truncated = false
): string {
  if (error) return error;
  if (files === null) return 'Loading…';
  if (files.length === 0) return 'No files yet.';
  if (truncated) return `${files.length}+ files`;
  return files.length === 1 ? '1 file' : `${files.length} files`;
}

export function ThreadStorageView({
  files,
  error = null,
  truncated = false,
  onOpenFile
}: {
  files: ThreadStorageFile[] | null;
  error?: string | null;
  truncated?: boolean;
  onOpenFile?: (path: string, title: string) => void;
}) {
  const rows = files ?? [];
  const loading = files === null && !error;
  const status = storageStatusLabel(files, error, truncated);
  return (
    <div className="thread-info-storage" data-testid="thread-info-storage">
      <div className="thread-info-row">
        <div className="thread-info-label">
          <span className="thread-info-icon" aria-hidden="true"><HardDrive size={14} /></span>
          <span>Storage</span>
        </div>
        <div className="thread-info-value" title={error ?? undefined}>
          {loading ? null : status}
        </div>
      </div>
      {loading ? (
        <StencilList label="Loading storage" widths={['72%', '58%', '80%']} />
      ) : rows.length > 0 ? (
        <ul className="thread-info-storage-files" aria-label="Storage files">
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
          {truncated ? <li key="thread-storage-more" className="thread-info-file-more">More files…</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

export function ThreadStorageBrowser({
  threadId,
  onOpenFile
}: {
  threadId: string;
  onOpenFile?: (path: string, title: string) => void;
}) {
  const [files, setFiles] = useState<ThreadStorageFile[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setFiles(null);
    setTruncated(false);
    void product.threads.storageFiles(threadId).then((next) => {
      applyIfCurrent(cancelled, next, (listing) => {
        setFiles(listing.files);
        setTruncated(listing.truncated);
      });
    }).catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Could not load storage');
        setFiles([]);
      }
    });
    return () => { cancelled = true; };
  }, [threadId]);

  return (
    <ThreadStorageView
      files={files}
      truncated={truncated}
      error={error}
      onOpenFile={onOpenFile}
    />
  );
}
