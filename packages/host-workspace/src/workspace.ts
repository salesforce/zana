import { realpath, stat } from 'node:fs/promises';
import type {
  DiscoveredWorkspaceProperties,
  ProvisioningTranscriptEntry,
  WorkspaceDiffTarget,
  WorkspaceProvisionType,
  WorkspaceStatus
} from '@zana-ai/zcc-domain';
import { WorkspaceError } from './error.js';
import {
  cloneRepository,
  commitAll,
  detectGitRepo,
  discoverWorkspace,
  inspectOriginUrl,
  listLocalBranches,
  pathExists,
  readWorkspaceDiff,
  readWorkspaceStatus,
  squashMergeInto,
  switchBranch
} from './git.js';
import { withCheckoutMutationLock } from './checkout-mutation-lock.js';
import {
  createWorktree,
  ensurePersonalWorkspace,
  removeWorktree
} from './provisioning.js';
import { getPullRequestForCurrentBranch, runPullRequestAction } from './git-host.js';
import { resolveAdditionalWorkspaceWriteRoots } from './workspace-write-roots.js';
import { PROJECT_CHECKOUTS_DIR_NAME } from '@zana-ai/zcc-domain';
import { join } from 'node:path';

export type UnmanagedCheckout =
  | { kind: 'existing'; name: string }
  | { kind: 'new'; name: string; baseBranch: string };

export type ProvisionInput =
  | {
      workspaceProvisionType: 'unmanaged';
      path: string;
      checkout?: UnmanagedCheckout;
      onProgress?: (entry: ProvisioningTranscriptEntry) => void;
      signal?: AbortSignal;
    }
  | {
      workspaceProvisionType: 'managed-worktree';
      sourcePath: string;
      targetPath: string;
      branchName: string;
      baseBranch: string | null;
      setupTimeoutMs: number;
      onProgress?: (entry: ProvisioningTranscriptEntry) => void;
      signal?: AbortSignal;
    }
  | {
      workspaceProvisionType: 'personal';
      targetPath: string;
      onProgress?: (entry: ProvisioningTranscriptEntry) => void;
      signal?: AbortSignal;
    };

export async function provisionWorkspace(input: ProvisionInput): Promise<{
  discovered: DiscoveredWorkspaceProperties;
  transcript: ProvisioningTranscriptEntry[];
}> {
  const transcript: ProvisioningTranscriptEntry[] = [];
  const onProgress = (entry: ProvisioningTranscriptEntry) => {
    transcript.push(entry);
    input.onProgress?.(entry);
  };
  if (input.workspaceProvisionType === 'unmanaged') {
    let path: string;
    try {
      path = await realpath(input.path);
      if (!(await stat(path)).isDirectory()) throw new Error('not a directory');
    } catch {
      throw new WorkspaceError('path_not_found', `path is not a directory: ${input.path}`);
    }
    if (input.checkout) {
      if (!(await detectGitRepo(path))) {
        throw new WorkspaceError('not_a_repo', 'cannot checkout a branch in a non-git directory');
      }
      await withCheckoutMutationLock(path, async () => {
        if (input.checkout?.kind === 'existing') await switchBranch(path, input.checkout.name);
        else if (input.checkout?.kind === 'new') await switchBranch(path, input.checkout.name, input.checkout.baseBranch);
      });
    }
    return { discovered: await discoverWorkspace(path), transcript };
  }
  if (input.workspaceProvisionType === 'personal') {
    const created = await ensurePersonalWorkspace(input.targetPath);
    const path = await realpath(created.path);
    onProgress({ type: 'step', key: 'personal', text: 'Personal workspace ready', status: 'completed' });
    return { discovered: await discoverWorkspace(path), transcript };
  }
  const created = await createWorktree({
    sourcePath: input.sourcePath,
    targetPath: input.targetPath,
    branchName: input.branchName,
    baseBranch: input.baseBranch,
    timeoutMs: input.setupTimeoutMs,
    onProgress,
    signal: input.signal
  });
  const path = await realpath(created.path);
  return { discovered: await discoverWorkspace(path), transcript };
}

export async function destroyWorkspace(args: {
  path: string;
  workspaceProvisionType: WorkspaceProvisionType;
  sourcePath?: string;
}): Promise<void> {
  if (args.workspaceProvisionType === 'unmanaged') return;
  if (args.workspaceProvisionType === 'personal') {
    const { rm } = await import('node:fs/promises');
    await rm(args.path, { recursive: true, force: true });
    return;
  }
  await removeWorktree({ path: args.path, sourcePath: args.sourcePath, force: true });
}

export async function workspaceStatus(path: string): Promise<WorkspaceStatus> {
  return readWorkspaceStatus(path);
}

export async function workspaceDiff(path: string, target: WorkspaceDiffTarget) {
  return readWorkspaceDiff(path, target);
}

export async function workspaceCommit(path: string, message: string, noVerify = false) {
  return withCheckoutMutationLock(path, () => commitAll(path, message, noVerify));
}

export async function workspaceSquashMerge(path: string, targetBranch: string, message: string) {
  return withCheckoutMutationLock(path, () => squashMergeInto(path, targetBranch, message));
}

export async function workspaceBranches(path: string, limit?: number) {
  if (!(await detectGitRepo(path))) return { branches: [] as string[], truncated: false };
  return listLocalBranches(path, limit);
}

export async function workspacePullRequest(path: string) {
  return getPullRequestForCurrentBranch(path);
}

export async function workspacePullRequestAction(
  path: string,
  action: Parameters<typeof runPullRequestAction>[1]
) {
  return runPullRequestAction(path, action);
}

export async function resolveCloneDefaultPath(dataDir: string, projectSlug: string): Promise<string> {
  return join(dataDir, PROJECT_CHECKOUTS_DIR_NAME, projectSlug);
}

export async function cloneProject(args: {
  dataDir: string;
  projectSlug: string;
  remoteUrl: string;
  targetPath?: string;
}): Promise<{ path: string; gitRemoteUrl: string | null }> {
  const target = args.targetPath ?? await resolveCloneDefaultPath(args.dataDir, args.projectSlug);
  if (await pathExists(target)) {
    throw new WorkspaceError('clone_target_exists', `clone target already exists: ${target}`);
  }
  const path = await cloneRepository(args.remoteUrl, target);
  return { path, gitRemoteUrl: await inspectOriginUrl(path) };
}

export { resolveAdditionalWorkspaceWriteRoots };
