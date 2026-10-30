import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  DEFAULT_SETUP_TIMEOUT_MS,
  ENV_SETUP_SCRIPT_NAME,
  type ProvisioningTranscriptEntry
} from '@zana-ai/zcc-domain';
import { gitChildEnv } from './git-env.js';
import {
  detectGitRepo,
  discoverWorkspace,
  defaultBranchRelation,
  getGitCommonDir,
  hasDeclaredSubmodules,
  pathExists,
  readDefaultBranch,
  readOriginDefaultBranch,
  revParse,
  runGit
} from './git.js';
import { withGitRefMutationLock } from './git-ref-mutation-lock.js';
import { WorkspaceError } from './error.js';
import { withCheckoutMutationLock } from './checkout-mutation-lock.js';
import { withWorktreeMetadataLock } from './worktree-metadata-lock.js';
import { copyWorktreeIncludeFiles } from './worktree-include.js';
import { killProcessesWithCwdUnder } from '@zana-ai/zcc-agent-process-utils';

export interface CreateWorktreeArgs {
  sourcePath: string;
  targetPath: string;
  branchName: string;
  baseBranch: string | null;
  timeoutMs?: number;
  onProgress?: (entry: ProvisioningTranscriptEntry) => void;
  signal?: AbortSignal;
}

function emit(onProgress: CreateWorktreeArgs['onProgress'], entry: ProvisioningTranscriptEntry) {
  onProgress?.(entry);
}

async function runSetupScript(
  workspacePath: string,
  timeoutMs: number,
  onProgress: CreateWorktreeArgs['onProgress'],
  signal?: AbortSignal
): Promise<void> {
  if (!(await pathExists(join(workspacePath, ENV_SETUP_SCRIPT_NAME)))) {
    emit(onProgress, { type: 'step', key: 'setup', text: `${ENV_SETUP_SCRIPT_NAME} not present`, status: 'completed' });
    return;
  }
  emit(onProgress, { type: 'step', key: 'setup', text: `Running ${ENV_SETUP_SCRIPT_NAME}`, status: 'started' });
  await new Promise<void>((resolve, reject) => {
    const child = spawn('env', ['bash', ENV_SETUP_SCRIPT_NAME], {
      cwd: workspacePath,
      env: gitChildEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const onAbort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', onAbort);
    child.stdout.on('data', (buf: Buffer) => emit(onProgress, { type: 'output', key: 'setup', text: buf.toString('utf8') }));
    child.stderr.on('data', (buf: Buffer) => emit(onProgress, { type: 'output', key: 'setup', text: buf.toString('utf8') }));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new WorkspaceError('setup_failed', `${ENV_SETUP_SCRIPT_NAME} timed out`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else reject(new WorkspaceError('setup_failed', `${ENV_SETUP_SCRIPT_NAME} exited ${code ?? 'null'}`));
    });
  });
  emit(onProgress, { type: 'step', key: 'setup', text: `${ENV_SETUP_SCRIPT_NAME} completed`, status: 'completed' });
}

const BASE_FETCH_TIMEOUT_MS = 15_000;

async function fetchRemoteBranch(
  sourcePath: string,
  remote: string,
  branch: string,
  onProgress: CreateWorktreeArgs['onProgress']
): Promise<void> {
  const ref = `${remote}/${branch}`;
  emit(onProgress, { type: 'step', key: 'fetch', text: `Fetching ${ref}`, status: 'started' });
  const commonDir = await getGitCommonDir(sourcePath);
  const result = await withGitRefMutationLock(commonDir, () =>
    runGit(sourcePath, ['fetch', '--quiet', remote, `+refs/heads/${branch}:refs/remotes/${ref}`], {
      allowFail: true,
      timeoutMs: BASE_FETCH_TIMEOUT_MS,
      extraEnv: { GIT_TERMINAL_PROMPT: '0' }
    })
  );
  // Offline or unauthenticated: continue from the last fetched remote ref.
  emit(onProgress, {
    type: 'step',
    key: 'fetch',
    text: result.code === 0 ? `Fetched ${ref}` : `Could not fetch ${ref}; using local refs`,
    status: 'completed'
  });
}

/** Splits `remote/branch` when it names a configured remote; local branches return null. */
async function parseRemoteBranch(
  sourcePath: string,
  baseBranch: string
): Promise<{ remote: string; branch: string } | null> {
  const remotes = (await runGit(sourcePath, ['remote'], { allowFail: true })).stdout.split('\n').filter(Boolean);
  // Longest match first so `team/fork` wins over `team` for `team/fork/main`.
  const remote = remotes
    .filter((name) => baseBranch.startsWith(`${name}/`) && baseBranch.length > name.length + 1)
    .sort((a, b) => b.length - a.length)[0];
  if (!remote) return null;
  if (await revParse(sourcePath, `refs/heads/${baseBranch}`)) return null;
  return { remote, branch: baseBranch.slice(remote.length + 1) };
}

/**
 * Picks the commit a new managed worktree starts from. An explicit base that
 * resolves wins; a remote-tracking base (`origin/feature`) is fetched first.
 * Otherwise use the default branch, preferring a freshly
 * fetched origin copy unless the local branch has commits origin lacks.
 * HEAD is the last resort, e.g. a repository with no default branch.
 */
export async function resolveWorktreeStartPoint(
  sourcePath: string,
  baseBranch: string | null,
  onProgress?: CreateWorktreeArgs['onProgress']
): Promise<string> {
  if (baseBranch) {
    const remoteBase = await parseRemoteBranch(sourcePath, baseBranch);
    if (remoteBase) await fetchRemoteBranch(sourcePath, remoteBase.remote, remoteBase.branch, onProgress);
    if (await revParse(sourcePath, baseBranch)) return baseBranch;
  }
  const originDefault = await readOriginDefaultBranch(sourcePath);
  if (originDefault) {
    await fetchRemoteBranch(sourcePath, 'origin', originDefault, onProgress);
    const originRef = `origin/${originDefault}`;
    if (await revParse(sourcePath, `refs/remotes/${originRef}`)) {
      const relation = await defaultBranchRelation(sourcePath, originDefault, originDefault);
      if (relation !== 'local-ahead' && relation !== 'diverged') return originRef;
    }
  }
  const localDefault = await readDefaultBranch(sourcePath);
  if (localDefault && (await revParse(sourcePath, `refs/heads/${localDefault}`))) return localDefault;
  return 'HEAD';
}

export async function createWorktree(args: CreateWorktreeArgs): Promise<{ path: string }> {
  const { sourcePath, targetPath, branchName, baseBranch } = args;
  if (!(await detectGitRepo(sourcePath))) {
    throw new WorkspaceError('not_a_repo', 'source path is not a git repository');
  }
  if (await hasDeclaredSubmodules(sourcePath)) {
    throw new WorkspaceError('submodules_unsupported', 'repositories with submodules are not supported for managed worktrees');
  }
  const head = await revParse(sourcePath, 'HEAD');
  if (!head) throw new WorkspaceError('empty_repo', 'source repository has no commits');

  if (await pathExists(targetPath)) {
    const existing = await discoverWorkspace(targetPath);
    if (existing.isGitRepo && existing.branchName === branchName) {
      emit(args.onProgress, { type: 'step', key: 'worktree', text: 'Reusing existing worktree', status: 'completed' });
      return { path: targetPath };
    }
    throw new WorkspaceError('target_exists', `worktree target already exists: ${targetPath}`);
  }

  const startPoint = await resolveWorktreeStartPoint(sourcePath, baseBranch, args.onProgress);
  emit(args.onProgress, { type: 'step', key: 'worktree', text: `Creating worktree on ${branchName}`, status: 'started' });
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
  // Lock order: checkout mutation, then worktree metadata.
  await withCheckoutMutationLock(sourcePath, () =>
    withWorktreeMetadataLock(sourcePath, async () => {
      const branchExists = await revParse(sourcePath, `refs/heads/${branchName}`);
      const gitArgs = branchExists
        ? ['worktree', 'add', targetPath, branchName]
        : ['worktree', 'add', '-B', branchName, targetPath, startPoint];
      await runGit(sourcePath, gitArgs, { timeoutMs: 20_000 });
    })
  );
  emit(args.onProgress, { type: 'step', key: 'worktree', text: 'Worktree created', status: 'completed' });

  try {
    const copied = await copyWorktreeIncludeFiles(sourcePath, targetPath, args.signal);
    emit(args.onProgress, {
      type: 'step',
      key: 'include',
      text: `Copied ${copied.copied.length} include file(s)`,
      status: 'completed'
    });
    await runSetupScript(targetPath, args.timeoutMs ?? DEFAULT_SETUP_TIMEOUT_MS, args.onProgress, args.signal);
  } catch (error) {
    await removeWorktree({ path: targetPath, sourcePath, force: true });
    throw error;
  }
  return { path: targetPath };
}

export async function removeWorktree(args: {
  path: string;
  sourcePath?: string;
  force?: boolean;
}): Promise<void> {
  await killProcessesWithCwdUnder({ directory: args.path });
  const cwd = args.sourcePath ?? args.path;
  try {
    await withCheckoutMutationLock(cwd, () =>
      withWorktreeMetadataLock(cwd, async () => {
        await runGit(cwd, ['worktree', 'remove', ...(args.force ? ['--force'] : []), args.path], { allowFail: true });
      })
    );
  } catch {
    // Git metadata cleanup is best-effort. Destroy still removes the checkout
    // directory so a missing cwd / PATH cannot leave an orphan worktree.
  }
  await rm(args.path, { recursive: true, force: true });
}

export async function ensurePersonalWorkspace(targetPath: string): Promise<{ path: string }> {
  await mkdir(targetPath, { recursive: true, mode: 0o700 });
  return { path: targetPath };
}
