import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, FileCode, FilePlus, FileText } from 'lucide-react';
import type { WorkspaceFileStatus, WorkspaceStatus } from '@zana-ai/zcc-domain';
import { formatDiffStatsText } from '@zana-ai/zcc-thread-view';
import { product } from '../../lib/product-client.js';
import {
  workspaceFileBasename,
  workspaceFileKindLetter
} from '../EnvironmentActions.js';

const STATUS_POLL_MS = 3_000;
const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'css', 'scss', 'sh'
]);

export function workspaceFileCountLabel(count: number, truncated = false): string {
  const noun = count === 1 && !truncated ? 'File' : 'Files';
  return `${count}${truncated ? '+' : ''} ${noun}`;
}

export function workspaceFileStatText(file: WorkspaceFileStatus): string {
  if (file.additions != null || file.deletions != null) {
    return formatDiffStatsText({
      added: file.additions ?? 0,
      removed: file.deletions ?? 0,
      hideZero: true
    }) || workspaceFileKindLetter(file.kind);
  }
  return workspaceFileKindLetter(file.kind);
}

function FileStat({ file }: { file: WorkspaceFileStatus }) {
  const text = workspaceFileStatText(file);
  const added = file.additions ?? 0;
  const removed = file.deletions ?? 0;
  const hasStats = (file.additions != null || file.deletions != null) && (added > 0 || removed > 0);
  if (!hasStats) {
    return <span className="thread-workspace-file-stat">{text}</span>;
  }
  return (
    <span className="thread-workspace-file-stat">
      {added > 0 ? <span className="is-add">+{added}</span> : null}
      {removed > 0 ? <span className="is-del">-{removed}</span> : null}
    </span>
  );
}

function fileGlyph(name: string, kind: WorkspaceFileStatus['kind']): ReactNode {
  if (kind === 'added' || kind === 'untracked') return <FilePlus size={13} />;
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (CODE_EXTS.has(ext)) return <FileCode size={13} />;
  return <FileText size={13} />;
}

export function ThreadWorkspaceBannerView({
  files,
  filesTruncated,
  onOpenDiff
}: {
  files: WorkspaceFileStatus[];
  filesTruncated?: boolean;
  onOpenDiff: (path?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (files.length === 0) return null;
  const truncated = Boolean(filesTruncated);
  return (
    <div
      className={`thread-workspace-banner${open ? ' is-open' : ''}`}
      data-testid="thread-workspace-banner"
    >
      <div className="thread-workspace-banner-summary">
        <button
          type="button"
          className="thread-workspace-banner-toggle"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronRight size={12} className="thread-workspace-banner-chevron" aria-hidden="true" />
          <span className="thread-workspace-banner-count">
            {workspaceFileCountLabel(files.length, truncated)}
          </span>
        </button>
        <button
          type="button"
          className="thread-workspace-review"
          data-testid="thread-workspace-review"
          onClick={() => onOpenDiff()}
        >
          Review
        </button>
      </div>
      <ul className="thread-workspace-files" hidden={!open}>
        {files.map((file) => {
          const name = workspaceFileBasename(file.path);
          return (
            <li key={file.path}>
              <button
                type="button"
                className={`thread-workspace-file is-${file.kind}`}
                title={file.path}
                onClick={() => onOpenDiff(file.path)}
              >
                <span className="thread-workspace-file-glyph" aria-hidden="true">
                  {fileGlyph(name, file.kind)}
                </span>
                <span className="thread-workspace-file-name">{name}</span>
                <FileStat file={file} />
              </button>
            </li>
          );
        })}
        {truncated ? (
          <li className="thread-workspace-file-more">More changes…</li>
        ) : null}
      </ul>
    </div>
  );
}

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
    const refresh = () => {
      void product.environments.status(environmentId).then((next) => {
        if (!cancelled) setStatus(next);
      }).catch(() => {
        if (!cancelled) setStatus(null);
      });
    };
    refresh();
    const timer = window.setInterval(refresh, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [environmentId]);

  if (!status?.dirty || status.files.length === 0) return null;
  return (
    <ThreadWorkspaceBannerView
      files={status.files}
      filesTruncated={status.filesTruncated}
      onOpenDiff={onOpenDiff}
    />
  );
}
