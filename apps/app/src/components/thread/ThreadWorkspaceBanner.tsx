import { useEffect, useState } from 'react';
import type { WorkspaceStatus } from '@zana-ai/zcc-domain';
import { product } from '../../lib/product-client.js';

export function ThreadWorkspaceBanner({
  environmentId,
  onOpenDiff
}: {
  environmentId: string | null;
  onOpenDiff: (path?: string) => void;
}) {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  useEffect(() => {
    if (!environmentId) return;
    let cancelled = false;
    void product.environments.status(environmentId).then((next) => {
      if (!cancelled) setStatus(next);
    }).catch(() => {
      if (!cancelled) setStatus(null);
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId]);

  if (!status?.dirty || status.files.length === 0) return null;
  const files = status.files.slice(0, 8);
  return (
    <div className="thread-workspace-banner" data-testid="thread-workspace-banner">
      <span>Workspace changed</span>
      {files.map((file) => (
        <button
          key={file.path}
          type="button"
          onClick={() => onOpenDiff(file.path)}
        >
          {file.path}
        </button>
      ))}
      {status.filesTruncated || status.files.length > 8 ? (
        <button type="button" onClick={() => onOpenDiff()}>View all</button>
      ) : null}
    </div>
  );
}
