import { useEffect, useState, type ReactNode } from 'react';
import { Box, Copy, Cpu, Folder, Gauge, GitBranch, GitPullRequest, Server } from 'lucide-react';
import type { GitHostPullRequest, WorkspaceStatus } from '@zana-ai/zcc-domain';
import { handleHttpLinkClick } from '../../../lib/in-app-browser-link-preference.js';
import { product } from '../../../lib/product-client.js';
import { useData } from '../../../store.js';
import {
  workspaceFileBasename,
  workspaceFileKindLetter,
  workspaceStatusPresentation
} from '../../EnvironmentActions.js';
import {
  applyIfCurrent,
  copyText,
  environmentLabel,
  hydrateRemoteToolProxyInfo,
  hydrateThreadInfo,
  sshRowValue,
  sshStatusText,
  threadInfoEnvironmentLabel,
  type ThreadSshStatus
} from './threadSecondaryPanelLogic.js';
import {
  humanThreadModelLabel,
  humanThreadReasoningLabel
} from '../pickers/thread-execution-labels.js';
import { ThreadStorageBrowser } from './ThreadStorageBrowser.js';

export { environmentLabel };

export function ThreadInfoRows({
  isWorktree,
  environmentName,
  cwd,
  branchName,
  workspaceStatus,
  pullRequest,
  model,
  reasoningLevel,
  providerId,
  remoteToolProxy = false,
  sshTarget = null,
  sshStatus = null,
  remoteDirectory = null
}: {
  isWorktree: boolean;
  environmentName?: string | null;
  cwd: string | null;
  branchName: string | null;
  workspaceStatus: WorkspaceStatus | null;
  pullRequest: GitHostPullRequest | null;
  model?: string | null;
  reasoningLevel?: string | null;
  providerId?: string | null;
  remoteToolProxy?: boolean;
  sshTarget?: string | null;
  sshStatus?: ThreadSshStatus | null;
  remoteDirectory?: string | null;
}) {
  const gitLabel = remoteToolProxy ? null : workspaceStatusPresentation(workspaceStatus).label;
  const files = remoteToolProxy ? [] : (workspaceStatus?.files ?? []);
  const modelLabel = model ? humanThreadModelLabel(model, providerId ?? undefined) : null;
  const reasoningLabel = humanThreadReasoningLabel(reasoningLevel);
  const directory = remoteDirectory || cwd;
  const sshLabel = sshTarget ? sshRowValue(sshTarget, sshStatus) : null;
  const sshTone = sshStatus === 'connected' ? 'connected' : sshStatus === 'unreachable' ? 'unreachable' : null;

  return (
    <div className="thread-info-content" data-testid="thread-info-tab">
      <InfoRow icon={<Box size={14} />} label="Environment" testId="thread-info-environment">
        {threadInfoEnvironmentLabel(isWorktree, environmentName, remoteToolProxy)}
      </InfoRow>

      {sshLabel ? (
        <InfoRow icon={<Server size={14} />} label="SSH" testId="thread-info-ssh">
          <span className="thread-info-directory" title={sshLabel}>
            <span className="thread-info-truncate">{sshTarget}</span>
            {sshStatusText(sshStatus) ? (
              <span
                className={`thread-info-ssh-status${sshTone ? ` is-${sshTone}` : ''}`}
                data-testid="thread-info-ssh-status"
              >
                {sshStatusText(sshStatus)}
              </span>
            ) : null}
          </span>
        </InfoRow>
      ) : null}

      {directory ? (
        <InfoRow icon={<Folder size={14} />} label="Directory" testId="thread-info-directory">
          <span className="thread-info-directory">
            <span className="thread-info-truncate" title={directory}>{directory}</span>
            <button
              type="button"
              className="thread-info-copy"
              aria-label="Copy directory"
              data-testid="thread-info-copy-directory"
              onClick={() => { void copyText(directory); }}
            >
              <Copy size={12} />
            </button>
          </span>
        </InfoRow>
      ) : null}

      {branchName && !remoteToolProxy ? (
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
          <a
            className="thread-info-link"
            href={pullRequest.url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              if (handleHttpLinkClick(pullRequest.url)) event.preventDefault();
            }}
          >
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

      {modelLabel ? (
        <InfoRow icon={<Cpu size={14} />} label="Model" testId="thread-info-model">
          {modelLabel}
        </InfoRow>
      ) : null}

      {reasoningLabel ? (
        <InfoRow icon={<Gauge size={14} />} label="Reasoning" testId="thread-info-reasoning">
          {reasoningLabel}
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
  isWorktree,
  cwd,
  branchName,
  environmentId,
  model,
  reasoningLevel,
  providerId,
  onOpenStorageFile
}: {
  threadId: string;
  projectId: string | null;
  isWorktree: boolean;
  cwd: string | null;
  branchName: string | null;
  environmentId: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
  providerId?: string | null;
  onOpenStorageFile?: (path: string, title: string) => void;
}) {
  const project = useData((s) => s.projects.find((row) => row.id === projectId) ?? null);
  const [environmentName, setEnvironmentName] = useState<string | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus | null>(null);
  const [pullRequest, setPullRequest] = useState<GitHostPullRequest | null>(null);
  const [remoteToolProxy, setRemoteToolProxy] = useState(false);
  const [sshTarget, setSshTarget] = useState<string | null>(null);
  const [sshStatus, setSshStatus] = useState<ThreadSshStatus | null>(null);
  const [remoteDirectory, setRemoteDirectory] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void hydrateThreadInfo(projectId, threadId, environmentId, {
      listEnvironments: product.environments.list,
      status: product.environments.status,
      pullRequest: product.environments.pullRequest
    }).then((data) => {
      applyIfCurrent(cancelled, data, (next) => {
        setEnvironmentName(next.environmentName);
        setWorkspaceStatus(next.status as WorkspaceStatus | null);
        setPullRequest(next.pullRequest as GitHostPullRequest | null);
      });
    });
    return () => { cancelled = true; };
  }, [environmentId, projectId, threadId]);

  useEffect(() => {
    let cancelled = false;
    setRemoteToolProxy(false);
    setSshTarget(null);
    setSshStatus(null);
    setRemoteDirectory(null);
    if (!project?.remote || project.hostId) return;
    void hydrateRemoteToolProxyInfo(project, {
      getSettings: (id) => product.projectSettings.get(id),
      remoteRoot: (id) => product.fs.remoteRoot(id)
    }).then((next) => {
      applyIfCurrent(cancelled, next, (info) => {
        setRemoteToolProxy(info.active);
        setSshTarget(info.sshTarget);
        setSshStatus(info.active ? (info.sshStatus ?? 'unreachable') : null);
        setRemoteDirectory(info.remoteDirectory);
      });
    });
    return () => { cancelled = true; };
  }, [project?.id, project?.hostId, project?.remote?.host, project?.remote?.user]);

  return (
    <>
      <ThreadInfoRows
        isWorktree={isWorktree}
        environmentName={environmentName}
        cwd={cwd}
        branchName={branchName}
        workspaceStatus={workspaceStatus}
        pullRequest={pullRequest}
        model={model}
        reasoningLevel={reasoningLevel}
        providerId={providerId}
        remoteToolProxy={remoteToolProxy}
        sshTarget={sshTarget}
        sshStatus={sshStatus}
        remoteDirectory={remoteDirectory}
      />
      <ThreadStorageBrowser threadId={threadId} onOpenFile={onOpenStorageFile} />
    </>
  );
}
