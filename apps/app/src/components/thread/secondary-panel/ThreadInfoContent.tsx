import { useEffect, useState, type ReactNode } from 'react';
import { Box, ChevronDown, Copy, Folder, GitBranch, GitPullRequest, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { GitHostPullRequest, WorkspaceStatus } from '@zana-ai/zcc-domain';
import { product } from '../../../lib/product-client.js';
import { getThreadRoutePath } from '../../../lib/route-paths.js';
import {
  workspaceFileBasename,
  workspaceFileKindLetter,
  workspaceStatusPresentation
} from '../../EnvironmentActions.js';
import {
  applyIfCurrent,
  copyText,
  environmentLabel,
  hydrateThreadInfo,
  parentFromSelectValue,
  type ThreadOption
} from './threadSecondaryPanelLogic.js';

export type ParentOption = ThreadOption;
export { environmentLabel };

export function ThreadInfoRows({
  threadId,
  parentThreadId,
  parentOptions,
  forks,
  isWorktree,
  environmentName,
  cwd,
  branchName,
  workspaceStatus,
  pullRequest,
  onAssignParent
}: {
  threadId: string;
  parentThreadId: string | null;
  parentOptions: ParentOption[];
  forks: ParentOption[];
  isWorktree: boolean;
  environmentName?: string | null;
  cwd: string | null;
  branchName: string | null;
  workspaceStatus: WorkspaceStatus | null;
  pullRequest: GitHostPullRequest | null;
  onAssignParent: (parentThreadId: string | null) => void;
}) {
  const parent = parentOptions.find((option) => option.id === parentThreadId) ?? null;
  const gitLabel = workspaceStatusPresentation(workspaceStatus).label;
  const files = workspaceStatus?.files ?? [];

  return (
    <div className="thread-info-content" data-testid="thread-info-tab">
      <InfoRow icon={<UserRound size={14} />} label="Parent" testId="thread-info-parent">
        {parent ? (
          <span className="thread-info-parent-value">
            <Link to={getThreadRoutePath(parent.id)} className="thread-info-link">{parent.title}</Link>
            <button
              type="button"
              className="thread-info-clear"
              aria-label="Clear parent thread"
              onClick={() => onAssignParent(null)}
            >
              ×
            </button>
          </span>
        ) : (
          <label className="thread-info-select-wrap">
            <select
              className="thread-info-select"
              aria-label="Assign parent thread"
              value=""
              onChange={(event) => onAssignParent(parentFromSelectValue(event.target.value))}
            >
              <option value="">None</option>
              {parentOptions.filter((option) => option.id !== threadId).map((option) => (
                <option key={option.id} value={option.id}>{option.title}</option>
              ))}
            </select>
            <ChevronDown size={12} aria-hidden="true" />
          </label>
        )}
      </InfoRow>

      {forks.length > 0 ? (
        <InfoRow icon={<UserRound size={14} />} label="Forks" testId="thread-info-forks">
          <ul className="thread-info-forks">
            {forks.map((fork) => (
              <li key={fork.id}>
                <Link to={getThreadRoutePath(fork.id)} className="thread-info-link">{fork.title}</Link>
              </li>
            ))}
          </ul>
        </InfoRow>
      ) : null}

      <InfoRow icon={<Box size={14} />} label="Environment" testId="thread-info-environment">
        {environmentLabel(isWorktree, environmentName)}
      </InfoRow>

      {cwd ? (
        <InfoRow icon={<Folder size={14} />} label="Directory" testId="thread-info-directory">
          <span className="thread-info-directory">
            <span className="thread-info-truncate" title={cwd}>{cwd}</span>
            <button
              type="button"
              className="thread-info-copy"
              aria-label="Copy directory"
              data-testid="thread-info-copy-directory"
              onClick={() => { void copyText(cwd); }}
            >
              <Copy size={12} />
            </button>
          </span>
        </InfoRow>
      ) : null}

      {branchName ? (
        <InfoRow icon={<GitBranch size={14} />} label="Branch" testId="thread-info-branch">
          {branchName}
        </InfoRow>
      ) : null}

      {gitLabel ? (
        <InfoRow icon={<GitBranch size={14} />} label="Git status" testId="thread-info-git">
          {gitLabel}
        </InfoRow>
      ) : null}

      {pullRequest ? (
        <InfoRow icon={<GitPullRequest size={14} />} label="Pull request" testId="thread-info-pr">
          <a className="thread-info-link" href={pullRequest.url} target="_blank" rel="noreferrer">
            #{pullRequest.number} {pullRequest.state}
          </a>
        </InfoRow>
      ) : null}

      {files.length > 0 ? (
        <InfoRow icon={<Folder size={14} />} label="Changed files" testId="thread-info-files" alignStart>
          <ul className="thread-info-files">
            {files.slice(0, 12).map((file) => (
              <li key={file.path} className={`thread-info-file is-${file.kind}`} title={file.path}>
                <span>{workspaceFileKindLetter(file.kind)}</span>
                <span className="thread-info-truncate">{workspaceFileBasename(file.path)}</span>
              </li>
            ))}
          </ul>
        </InfoRow>
      ) : null}
    </div>
  );
}

function InfoRow({
  icon,
  label,
  children,
  testId,
  alignStart
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  testId?: string;
  alignStart?: boolean;
}) {
  return (
    <div className={`thread-info-row${alignStart ? ' is-start' : ''}`} data-testid={testId}>
      <div className="thread-info-label">
        <span className="thread-info-icon" aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="thread-info-value">{children}</div>
    </div>
  );
}

export function ThreadInfoContent({
  threadId,
  projectId,
  parentThreadId,
  isWorktree,
  cwd,
  branchName,
  environmentId,
  onAssignedParent
}: {
  threadId: string;
  projectId: string | null;
  parentThreadId: string | null;
  isWorktree: boolean;
  cwd: string | null;
  branchName: string | null;
  environmentId: string | null;
  onAssignedParent: (parentThreadId: string | null) => void;
}) {
  const [options, setOptions] = useState<ParentOption[]>([]);
  const [forks, setForks] = useState<ParentOption[]>([]);
  const [environmentName, setEnvironmentName] = useState<string | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus | null>(null);
  const [pullRequest, setPullRequest] = useState<GitHostPullRequest | null>(null);

  useEffect(() => {
    let cancelled = false;
    void hydrateThreadInfo(projectId, threadId, environmentId, {
      listThreads: product.threads.list,
      listEnvironments: product.environments.list,
      status: product.environments.status,
      pullRequest: product.environments.pullRequest
    }).then((data) => {
      applyIfCurrent(cancelled, data, (next) => {
        setOptions(next.options);
        setForks(next.forks);
        setEnvironmentName(next.environmentName);
        setWorkspaceStatus(next.status as WorkspaceStatus | null);
        setPullRequest(next.pullRequest as GitHostPullRequest | null);
      });
    });
    return () => { cancelled = true; };
  }, [environmentId, projectId, threadId]);

  return (
    <ThreadInfoRows
      threadId={threadId}
      parentThreadId={parentThreadId}
      parentOptions={options}
      forks={forks}
      isWorktree={isWorktree}
      environmentName={environmentName}
      cwd={cwd}
      branchName={branchName}
      workspaceStatus={workspaceStatus}
      pullRequest={pullRequest}
      onAssignParent={onAssignedParent}
    />
  );
}
