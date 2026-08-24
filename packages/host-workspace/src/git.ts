import { spawn } from 'node:child_process';
import { lstat, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type {
  DefaultBranchRelation,
  GitCheckoutRef,
  WorkspaceDiffResponse,
  WorkspaceDiffTarget,
  WorkspaceFileStatus,
  WorkspaceGitOperation,
  WorkspaceStatus
} from '@zana-ai/zcc-domain';
import { gitChildEnv } from './git-env.js';
import { WorkspaceError } from './error.js';

export const GIT_TIMEOUT_MS = 20_000;
export const GIT_MAX_BUFFER = 16 * 1024 * 1024;
export const DEFAULT_MAX_DIFF_BYTES = 256 * 1024;
export const DEFAULT_MAX_FILES = 400;

/**
 * Truncates `value` to at most `maxBytes` UTF-8 bytes on a codepoint boundary.
 * A naive `buffer.subarray(0, maxBytes)` can slice a multibyte character, which
 * `toString('utf8')` then renders as U+FFFD (3 bytes) — corrupting the text and
 * overshooting the budget. Walk the cut point back over continuation bytes so
 * the straddling codepoint is dropped whole.
 */
export function truncateToMaxBytes(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.byteLength <= maxBytes) return value;
  let cut = maxBytes;
  while (cut > 0 && (buffer[cut] & 0xc0) === 0x80) cut -= 1;
  return buffer.subarray(0, cut).toString('utf8');
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  code: number;
  truncated?: boolean;
}

function runGitProcess(
  cwd: string,
  args: string[],
  timeoutMs: number,
  maxBuffer: number,
  overflow: 'throw' | 'truncate',
  extraEnv?: NodeJS.ProcessEnv
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: { ...gitChildEnv(), ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    let truncated = false;
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const settleResolve = (result: GitCommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const onChunk = (chunks: Buffer[], buf: Buffer) => {
      if (settled || truncated) return;
      const next = size + buf.length;
      if (next > maxBuffer) {
        truncated = true;
        const keep = maxBuffer - size;
        if (keep > 0) chunks.push(buf.subarray(0, keep));
        size = maxBuffer;
        child.kill('SIGKILL');
        if (overflow === 'throw') {
          settleReject(new WorkspaceError('git_failed', 'git output exceeded the buffer cap'));
        }
        return;
      }
      size = next;
      chunks.push(buf);
    };
    child.stdout.on('data', (buf: Buffer) => onChunk(stdoutChunks, buf));
    child.stderr.on('data', (buf: Buffer) => onChunk(stderrChunks, buf));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settleReject(new WorkspaceError('git_failed', `git timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      const err = error as NodeJS.ErrnoException;
      settleResolve({
        stdout: '',
        stderr: err.code === 'ENOENT' ? 'git not found or cwd missing' : String(error),
        code: 127
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      settleResolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        code: truncated && overflow === 'truncate' ? 0 : (code ?? 1),
        truncated
      });
    });
  });
}

export async function runGit(
  cwd: string,
  args: string[],
  options: {
    timeoutMs?: number;
    maxBuffer?: number;
    allowFail?: boolean;
    overflow?: 'throw' | 'truncate';
    extraEnv?: NodeJS.ProcessEnv;
  } = {}
): Promise<GitCommandResult> {
  if (!isAbsolute(cwd)) {
    throw new WorkspaceError('invalid_path', 'git cwd must be absolute');
  }
  const result = await runGitProcess(
    cwd,
    args,
    options.timeoutMs ?? GIT_TIMEOUT_MS,
    options.maxBuffer ?? GIT_MAX_BUFFER,
    options.overflow ?? 'throw',
    options.extraEnv
  );
  if (result.code !== 0 && !options.allowFail && !result.truncated) {
    throw new WorkspaceError('git_failed', result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result;
}

/**
 * Record-bounded `git` for NUL-delimited listings (`ls-files -z`). Stops after
 * `maxRecords` complete records so a huge untracked tree cannot fill the 16 MB
 * process buffer. `truncated` is true when the ceiling was hit.
 */
export async function runGitWithNullRecordLimit(
  cwd: string,
  args: string[],
  maxRecords: number,
  extraEnv?: NodeJS.ProcessEnv
): Promise<{ stdout: string; truncated: boolean }> {
  if (!Number.isInteger(maxRecords) || maxRecords <= 0) {
    throw new WorkspaceError('invalid_request', 'maxRecords must be a positive integer');
  }
  if (!isAbsolute(cwd)) {
    throw new WorkspaceError('invalid_path', 'git cwd must be absolute');
  }
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: { ...gitChildEnv(), ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const records: Buffer[] = [];
    let pending = Buffer.alloc(0);
    let truncated = false;
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      if (!settled) {
        settled = true;
        reject(new WorkspaceError('git_failed', `git timed out after ${GIT_TIMEOUT_MS}ms`));
      }
    }, GIT_TIMEOUT_MS);
    const finish = (stdout: string, wasTruncated: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, truncated: wasTruncated });
    };
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled || truncated) return;
      const input = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      let start = 0;
      for (let i = 0; i < input.length; i++) {
        if (input[i] !== 0) continue;
        records.push(Buffer.from(input.subarray(start, i)));
        start = i + 1;
        if (records.length >= maxRecords) {
          truncated = true;
          child.kill('SIGKILL');
          finish(`${records.map((record) => record.toString('utf8')).join('\0')}\0`, true);
          return;
        }
      }
      pending = Buffer.from(input.subarray(start));
    });
    child.stderr.resume();
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new WorkspaceError('git_failed', error instanceof Error ? error.message : String(error)));
    });
    child.on('close', () => {
      if (settled) return;
      const tail = pending.length > 0 ? pending.toString('utf8') : '';
      const parts = records.map((record) => record.toString('utf8'));
      if (tail) parts.push(tail);
      finish(parts.length > 0 ? `${parts.join('\0')}${tail ? '' : records.length > 0 ? '\0' : ''}` : '', false);
    });
  });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export async function detectGitRepo(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], { allowFail: true });
  return result.code === 0 && result.stdout.trim() === 'true';
}

export async function isGitWorktree(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ['rev-parse', '--git-dir'], { allowFail: true });
  if (result.code !== 0) return false;
  const gitDir = result.stdout.trim();
  return gitDir.includes('/worktrees/') || !gitDir.endsWith('.git');
}

export async function getGitCommonDir(cwd: string): Promise<string> {
  const result = await runGit(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return result.stdout.trim();
}

export async function getAbsoluteGitDir(cwd: string): Promise<string> {
  const result = await runGit(cwd, ['rev-parse', '--path-format=absolute', '--git-dir']);
  return result.stdout.trim();
}

export async function getCurrentBranch(cwd: string): Promise<string | null> {
  const result = await runGit(cwd, ['branch', '--show-current'], { allowFail: true });
  const name = result.stdout.trim();
  return name.length > 0 ? name : null;
}

export async function revParse(cwd: string, ref: string): Promise<string | null> {
  const result = await runGit(cwd, ['rev-parse', '--verify', '--quiet', ref], { allowFail: true });
  const sha = result.stdout.trim();
  return result.code === 0 && sha ? sha : null;
}

export async function readDefaultBranch(cwd: string): Promise<string | null> {
  const origin = await runGit(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD'], { allowFail: true });
  if (origin.code === 0) {
    const name = origin.stdout.trim().replace(/^refs\/remotes\/origin\//, '');
    if (name) return name;
  }
  for (const candidate of ['main', 'master']) {
    if (await revParse(cwd, `refs/heads/${candidate}`)) return candidate;
  }
  return getCurrentBranch(cwd);
}

export async function readOriginDefaultBranch(cwd: string): Promise<string | null> {
  const origin = await runGit(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD'], { allowFail: true });
  if (origin.code !== 0) return null;
  const name = origin.stdout.trim().replace(/^refs\/remotes\/origin\//, '');
  return name || null;
}

export async function defaultBranchRelation(
  cwd: string,
  localBranch: string | null,
  originDefault: string | null
): Promise<DefaultBranchRelation | null> {
  if (!localBranch || !originDefault) return null;
  const local = await revParse(cwd, `refs/heads/${localBranch}`);
  const remote = await revParse(cwd, `refs/remotes/origin/${originDefault}`)
    ?? await revParse(cwd, `refs/heads/${originDefault}`);
  if (!local || !remote) return 'unknown';
  if (local === remote) return 'equal';
  const left = await runGit(cwd, ['rev-list', '--count', `${remote}..${local}`], { allowFail: true });
  const right = await runGit(cwd, ['rev-list', '--count', `${local}..${remote}`], { allowFail: true });
  const ahead = Number.parseInt(left.stdout.trim(), 10) || 0;
  const behind = Number.parseInt(right.stdout.trim(), 10) || 0;
  if (ahead > 0 && behind > 0) return 'diverged';
  if (ahead > 0) return 'local-ahead';
  if (behind > 0) return 'local-behind';
  return 'equal';
}

export async function getCheckoutRef(cwd: string): Promise<GitCheckoutRef> {
  const branch = await getCurrentBranch(cwd);
  const sha = await revParse(cwd, 'HEAD');
  if (branch && sha) return { kind: 'branch', branchName: branch, headSha: sha };
  if (sha) return { kind: 'detached', headSha: sha };
  if (branch) return { kind: 'unborn', branchName: branch };
  return { kind: 'unknown', reason: 'no HEAD' };
}

export async function getWorkspaceGitOperation(cwd: string): Promise<WorkspaceGitOperation> {
  const gitDir = await getAbsoluteGitDir(cwd);
  const has = async (name: string) => pathExists(join(gitDir, name));
  if (await has('MERGE_HEAD')) {
    return { kind: 'merge', hasConflicts: await hasConflicts(cwd) };
  }
  if (await has('REBASE_HEAD') || await pathExists(join(gitDir, 'rebase-merge')) || await pathExists(join(gitDir, 'rebase-apply'))) {
    return { kind: 'rebase', hasConflicts: await hasConflicts(cwd) };
  }
  if (await has('CHERRY_PICK_HEAD')) {
    return { kind: 'cherry-pick', hasConflicts: await hasConflicts(cwd) };
  }
  if (await has('REVERT_HEAD')) {
    return { kind: 'revert', hasConflicts: await hasConflicts(cwd) };
  }
  return { kind: 'none' };
}

async function hasConflicts(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true });
  return result.stdout.trim().length > 0;
}

export async function hasDeclaredSubmodules(cwd: string): Promise<boolean> {
  return pathExists(join(cwd, '.gitmodules'));
}

export async function listLocalBranches(cwd: string, limit = 200): Promise<{ branches: string[]; truncated: boolean }> {
  const result = await runGit(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  const branches = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  return { branches: branches.slice(0, limit), truncated: branches.length > limit };
}

export async function switchBranch(cwd: string, name: string, createFrom?: string): Promise<void> {
  if (createFrom) {
    await runGit(cwd, ['switch', '-C', name, createFrom], { timeoutMs: GIT_TIMEOUT_MS });
    return;
  }
  await runGit(cwd, ['switch', name], { timeoutMs: GIT_TIMEOUT_MS });
}

export async function discoverWorkspace(cwd: string): Promise<{
  path: string;
  isGitRepo: boolean;
  isWorktree: boolean;
  branchName: string | null;
  defaultBranch: string | null;
}> {
  const isGitRepo = await detectGitRepo(cwd);
  if (!isGitRepo) {
    return { path: cwd, isGitRepo: false, isWorktree: false, branchName: null, defaultBranch: null };
  }
  return {
    path: cwd,
    isGitRepo: true,
    isWorktree: await isGitWorktree(cwd),
    branchName: await getCurrentBranch(cwd),
    defaultBranch: await readDefaultBranch(cwd)
  };
}

function porcelainKind(code: string): WorkspaceFileStatus['kind'] {
  if (code.includes('?')) return 'untracked';
  if (code.includes('A')) return 'added';
  if (code.includes('D')) return 'deleted';
  if (code.includes('R')) return 'renamed';
  if (code.includes('C')) return 'copied';
  if (code.includes('T')) return 'typechange';
  return 'modified';
}

export async function readWorkspaceStatus(cwd: string, maxFiles = DEFAULT_MAX_FILES): Promise<WorkspaceStatus> {
  const discovered = await discoverWorkspace(cwd);
  if (!discovered.isGitRepo) {
    return {
      path: cwd,
      isGitRepo: false,
      isWorktree: false,
      branchName: null,
      defaultBranch: null,
      defaultBranchRelation: null,
      originDefaultBranch: null,
      checkout: { kind: 'unknown', reason: 'not a git repo' },
      operation: { kind: 'none' },
      ahead: null,
      behind: null,
      dirty: false,
      files: [],
      filesTruncated: false
    };
  }
  const status = await runGit(cwd, ['status', '--porcelain=v1', '-b', '-uall'], {
    overflow: 'truncate'
  });
  const lines = status.stdout.split('\n').filter(Boolean);
  const header = lines.find((line) => line.startsWith('## ')) ?? '';
  let ahead: number | null = 0;
  let behind: number | null = 0;
  const aheadMatch = /ahead (\d+)/.exec(header);
  const behindMatch = /behind (\d+)/.exec(header);
  if (aheadMatch) ahead = Number(aheadMatch[1]);
  if (behindMatch) behind = Number(behindMatch[1]);
  const fileLines = lines.filter((line) => !line.startsWith('## '));
  const files: WorkspaceFileStatus[] = fileLines.slice(0, maxFiles).map((line) => {
    const code = line.slice(0, 2);
    const path = line.slice(3).split(' -> ').pop() ?? line.slice(3);
    return {
      path,
      kind: porcelainKind(code),
      staged: code[0] !== ' ' && code[0] !== '?',
      additions: null,
      deletions: null
    };
  });
  const originDefault = await readOriginDefaultBranch(cwd);
  return {
    path: cwd,
    isGitRepo: true,
    isWorktree: discovered.isWorktree,
    branchName: discovered.branchName,
    defaultBranch: discovered.defaultBranch,
    defaultBranchRelation: await defaultBranchRelation(cwd, discovered.branchName, originDefault),
    originDefaultBranch: originDefault,
    checkout: await getCheckoutRef(cwd),
    operation: await getWorkspaceGitOperation(cwd),
    ahead,
    behind,
    dirty: fileLines.length > 0,
    files,
    filesTruncated: fileLines.length > maxFiles || Boolean(status.truncated)
  };
}

function diffArgsFor(target: WorkspaceDiffTarget): string[] {
  if (target.type === 'uncommitted') return ['diff', 'HEAD'];
  if (target.type === 'commit') return ['show', '--format=', target.sha];
  return ['diff', `${target.mergeBaseBranch}...HEAD`];
}

export async function readWorkspaceDiff(
  cwd: string,
  target: WorkspaceDiffTarget,
  maxDiffBytes = DEFAULT_MAX_DIFF_BYTES
): Promise<WorkspaceDiffResponse> {
  if (!(await detectGitRepo(cwd))) {
    return { diff: '', truncated: false, shortstat: '', files: '', mergeBaseRef: null };
  }
  let mergeBaseRef: string | null = null;
  if (target.type === 'branch_committed' || target.type === 'all') {
    const mb = await runGit(cwd, ['merge-base', target.mergeBaseBranch, 'HEAD'], { allowFail: true });
    mergeBaseRef = mb.code === 0 ? mb.stdout.trim() || null : null;
  }
  const args = diffArgsFor(target);
  const result = await runGit(cwd, args, {
    allowFail: true,
    maxBuffer: maxDiffBytes + 1,
    overflow: 'truncate'
  });
  const overflowed = Boolean(result.truncated) || Buffer.byteLength(result.stdout, 'utf8') > maxDiffBytes;
  const diff = overflowed ? truncateToMaxBytes(result.stdout, maxDiffBytes) : result.stdout;
  const truncated = overflowed;
  const nameOnly = await runGit(cwd, [...diffArgsFor(target), '--name-only'], { allowFail: true });
  const short = await runGit(cwd, [...diffArgsFor(target), '--shortstat'], { allowFail: true });
  return {
    diff,
    truncated,
    shortstat: short.stdout.trim(),
    files: nameOnly.stdout.trim(),
    mergeBaseRef
  };
}

export async function commitAll(cwd: string, message: string, noVerify = false): Promise<{ commitSha: string; commitSubject: string }> {
  const trimmed = message.trim();
  if (!trimmed) throw new WorkspaceError('invalid_message', 'commit message is required');
  await runGit(cwd, ['add', '-A']);
  const args = ['commit', '-m', trimmed];
  if (noVerify) args.push('--no-verify');
  await runGit(cwd, args);
  const sha = await revParse(cwd, 'HEAD');
  if (!sha) throw new WorkspaceError('git_failed', 'commit succeeded but HEAD is missing');
  return { commitSha: sha, commitSubject: trimmed.split('\n')[0] ?? trimmed };
}

export async function squashMergeInto(
  cwd: string,
  targetBranch: string,
  message: string
): Promise<{ merged: boolean; commitSha: string; commitSubject: string }> {
  const source = await getCurrentBranch(cwd);
  if (!source) throw new WorkspaceError('git_failed', 'cannot squash-merge from a detached HEAD');
  if (source === targetBranch) throw new WorkspaceError('invalid_request', 'source and target branch are the same');
  await switchBranch(cwd, targetBranch);
  const merge = await runGit(cwd, ['merge', '--squash', source], { allowFail: true });
  if (merge.code !== 0) {
    await runGit(cwd, ['reset', '--merge'], { allowFail: true });
    throw new WorkspaceError('git_failed', merge.stderr.trim() || 'squash merge failed');
  }
  const committed = await commitAll(cwd, message.trim() || `Squash merge ${source}`);
  return { merged: true, ...committed };
}

export async function cloneRepository(
  remoteUrl: string,
  targetPath: string,
  onProgress?: (line: string) => void
): Promise<string> {
  if (await pathExists(targetPath)) {
    throw new WorkspaceError('clone_target_exists', `clone target already exists: ${targetPath}`);
  }
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['clone', '--progress', remoteUrl, targetPath], {
      cwd: dirname(targetPath),
      env: gitChildEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let leftover = '';
    const onChunk = (buf: Buffer) => {
      leftover += buf.toString('utf8');
      const parts = leftover.split(/\r|\n/);
      leftover = parts.pop() ?? '';
      for (const line of parts) {
        const trimmed = line.trim();
        if (trimmed) onProgress?.(trimmed);
      }
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new WorkspaceError('git_failed', 'git clone timed out'));
    }, 20 * 60 * 1000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new WorkspaceError('git_failed', error instanceof Error ? error.message : String(error)));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (leftover.trim()) onProgress?.(leftover.trim());
      if (code === 0) resolve();
      else reject(new WorkspaceError('git_failed', `git clone exited ${code ?? 'null'}`));
    });
  });
  return targetPath;
}

export async function inspectOriginUrl(cwd: string): Promise<string | null> {
  const result = await runGit(cwd, ['remote', 'get-url', 'origin'], { allowFail: true });
  const url = result.stdout.trim();
  return result.code === 0 && url ? url : null;
}
