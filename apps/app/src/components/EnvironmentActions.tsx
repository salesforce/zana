import { useEffect, useState } from 'react';
import {
  ExternalLink,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  X
} from 'lucide-react';
import type {
  EnvironmentAction,
  GitHostPullRequest,
  ProvisioningTranscriptEntry,
  WorkspaceFileStatus,
  WorkspaceStatus
} from '@zana-ai/zcc-domain';
import { product } from '../lib/product-client.js';
import { subscribeProductEvent } from '../lib/product-ws.js';

const FILE_KIND_LETTER: Record<WorkspaceFileStatus['kind'], string> = {
  untracked: '?',
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T'
};

const FILE_PREVIEW_LIMIT = 12;

export function workspaceStatusPresentation(
  status: WorkspaceStatus | null,
  provisioning = false
): {
  tone: 'pending' | 'clean' | 'dirty';
  label: string | null;
} {
  if (status?.dirty) return { tone: 'dirty', label: 'Uncommitted' };
  if (status) return { tone: 'clean', label: 'Clean' };
  if (provisioning) return { tone: 'pending', label: 'Creating worktree' };
  return { tone: 'pending', label: null };
}

export function workspaceFileKindLetter(kind: WorkspaceFileStatus['kind']): string {
  return FILE_KIND_LETTER[kind];
}

export function workspaceFileBasename(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash >= 0 ? path.slice(slash + 1) : path;
}

interface Props {
  environmentId: string | null | undefined;
}

export function EnvironmentActions({ environmentId }: Props) {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [pr, setPr] = useState<GitHostPullRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<ProvisioningTranscriptEntry[]>([]);

  useEffect(() => {
    if (!environmentId) return;
    let cancelled = false;
    const refresh = () => {
      void Promise.all([
        product.environments.status(environmentId).catch(() => null),
        product.environments.pullRequest(environmentId).catch(() => ({ pullRequest: null }))
      ]).then(([nextStatus, nextPr]) => {
        if (cancelled) return;
        setStatus(nextStatus);
        setPr(nextPr?.pullRequest ?? null);
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    const unsubscribe = subscribeProductEvent('threads:event', (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const event = payload as { kind?: unknown; payload?: unknown };
      if (event.kind !== 'environment.provision.progress') return;
      const entry = event.payload as ProvisioningTranscriptEntry | undefined;
      if (entry?.text) setTranscript((current) => [...current, entry]);
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [environmentId]);

  if (!environmentId) return null;

  const run = async (action: EnvironmentAction) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await product.environments.action(environmentId, action);
      setMessage(typeof result.message === 'string' ? result.message : 'Done');
      const nextStatus = await product.environments.status(environmentId).catch(() => null);
      const nextPr = await product.environments.pullRequest(environmentId).catch(() => ({ pullRequest: null }));
      setStatus(nextStatus);
      setPr(nextPr?.pullRequest ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EnvironmentActionsView
      status={status}
      pr={pr}
      busy={busy}
      message={message}
      transcript={transcript}
      onCancelProvision={() => {
        setBusy(true);
        void product.environments.cancelProvision(environmentId).then(() => {
          setMessage('Provisioning cancelled');
        }).catch((error) => {
          setMessage(error instanceof Error ? error.message : String(error));
        }).finally(() => setBusy(false));
      }}
      onAction={(action) => void run(action)}
    />
  );
}

export function EnvironmentActionsView({
  status,
  pr,
  busy,
  message,
  transcript,
  onCancelProvision,
  onAction
}: {
  status: WorkspaceStatus | null;
  pr: GitHostPullRequest | null;
  busy: boolean;
  message: string | null;
  transcript: ProvisioningTranscriptEntry[];
  onCancelProvision: () => void;
  onAction: (action: EnvironmentAction) => void;
}) {
  const provisioning = !status && transcript.length > 0;
  const presentation = workspaceStatusPresentation(status, provisioning);
  const branchName = status?.branchName;
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const files = status?.files ?? [];
  const shownFiles = files.slice(0, FILE_PREVIEW_LIMIT);
  const extraCount = files.length - shownFiles.length;
  const offDefault =
    !!status?.defaultBranch && !!status.branchName && status.branchName !== status.defaultBranch;

  return (
    <section className="environment-actions" aria-label="Workspace git" data-testid="environment-actions">
      <header className="environment-actions-head">
        <span className="environment-actions-label">Workspace</span>
        {presentation.label && (
          <span className={`environment-actions-status is-${presentation.tone}`}>
            {presentation.label}
          </span>
        )}
      </header>

      {branchName && (
        <div className="environment-actions-branch" title={`On branch ${branchName}`}>
          <GitBranch size={12} aria-hidden="true" />
          <span className="environment-actions-branch-name">{branchName}</span>
          {(ahead > 0 || behind > 0) && (
            <span
              className="environment-actions-ab"
              title={`${ahead} ahead, ${behind} behind the upstream`}
            >
              {ahead > 0 ? `↑${ahead}` : ''}
              {behind > 0 ? `↓${behind}` : ''}
            </span>
          )}
        </div>
      )}

      {transcript.length > 0 && (
        <pre className="environment-transcript">{transcript.map((entry) => entry.text).join('\n')}</pre>
      )}

      {shownFiles.length > 0 && (
        <ul className="environment-changes">
          {shownFiles.map((file) => (
            <li
              key={file.path}
              className={`environment-change is-${file.kind}`}
              title={file.path}
            >
              <span className="environment-change-name">{workspaceFileBasename(file.path)}</span>
              <span className="environment-change-kind">{workspaceFileKindLetter(file.kind)}</span>
            </li>
          ))}
          {(extraCount > 0 || status?.filesTruncated) && (
            <li className="environment-change-more">
              {status?.filesTruncated ? 'More changes…' : `+${extraCount} more`}
            </li>
          )}
        </ul>
      )}

      {(provisioning || status) && (
        <div className="environment-action-row">
          {provisioning && (
            <button
              type="button"
              className="agent-monitor-action"
              disabled={busy}
              data-testid="environment-cancel-provision"
              title="Stop creating this worktree"
              onClick={onCancelProvision}
            >
              <X size={13} /> Cancel
            </button>
          )}
          {status?.dirty && (
            <button
              type="button"
              className="agent-monitor-action"
              disabled={busy}
              data-testid="environment-commit"
              title="Commit the uncommitted changes in this workspace"
              onClick={() => onAction({ action: 'commit' })}
            >
              <GitCommit size={13} /> Commit
            </button>
          )}
          {offDefault && (
            <button
              type="button"
              className="agent-monitor-action"
              disabled={busy}
              data-testid="environment-squash"
              title={`Squash this branch into ${status.defaultBranch}`}
              onClick={() => onAction({ action: 'squash_merge', targetBranch: status.defaultBranch! })}
            >
              <GitMerge size={13} /> Squash into {status.defaultBranch}
            </button>
          )}
          {status && (pr ? (
            <>
              <a
                className="environment-pr-link"
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                title={pr.title}
              >
                <GitPullRequest size={13} aria-hidden="true" />
                <span className="environment-pr-title">PR #{pr.number}</span>
                <span className={`environment-pr-state${pr.isDraft ? ' is-draft' : ''}`}>
                  {pr.isDraft ? 'Draft' : pr.state}
                </span>
                <ExternalLink size={11} aria-hidden="true" />
              </a>
              <button
                type="button"
                className="agent-monitor-action"
                disabled={busy}
                onClick={() => onAction({ action: pr.isDraft ? 'pull_request_ready' : 'pull_request_draft' })}
              >
                <GitPullRequest size={13} /> {pr.isDraft ? 'Mark ready' : 'Convert to draft'}
              </button>
              <button
                type="button"
                className="agent-monitor-action"
                disabled={busy}
                onClick={() => onAction({ action: 'pull_request_merge', method: 'squash' })}
              >
                <GitMerge size={13} /> Merge squash
              </button>
            </>
          ) : (
            <button
              type="button"
              className="agent-monitor-action"
              disabled={busy}
              data-testid="environment-create-pr"
              title="Open a pull request for this branch"
              onClick={() => onAction({ action: 'pull_request_create', title: status.branchName ?? 'Worktree' })}
            >
              <GitPullRequest size={13} /> Open pull request
            </button>
          ))}
        </div>
      )}
      {message && <p className="environment-action-message">{message}</p>}
    </section>
  );
}
