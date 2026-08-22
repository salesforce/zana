import { spawn } from 'node:child_process';
import type { GitHostPullRequest, GitHostPullRequestMergeMethod } from '@zana-ai/zcc-domain';
import { gitChildEnv } from './git-env.js';
import { getCurrentBranch } from './git.js';
import { WorkspaceError } from './error.js';

const GH_VIEW_TIMEOUT_MS = 10_000;
const GH_ACTION_TIMEOUT_MS = 60_000;
const GH_MAX_BUFFER = 16 * 1024 * 1024;

function runGh(cwd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, {
      cwd,
      env: gitChildEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    const take = (chunks: Buffer[], buf: Buffer) => {
      size += buf.length;
      if (size > GH_MAX_BUFFER) {
        child.kill('SIGKILL');
        reject(new WorkspaceError('gh_failed', 'gh output exceeded the buffer cap'));
        return;
      }
      chunks.push(buf);
    };
    child.stdout.on('data', (buf: Buffer) => take(stdout, buf));
    child.stderr.on('data', (buf: Buffer) => take(stderr, buf));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new WorkspaceError('gh_failed', 'gh timed out'));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        reject(new WorkspaceError('gh_missing', 'gh is not installed on this host'));
        return;
      }
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code: code ?? 1
      });
    });
  });
}

export async function getPullRequestForCurrentBranch(cwd: string): Promise<GitHostPullRequest | null> {
  const branch = await getCurrentBranch(cwd);
  if (!branch) return null;
  const result = await runGh(cwd, [
    'pr',
    'view',
    '--json',
    'number,title,state,url,isDraft,baseRefName,headRefName,updatedAt,reviewDecision,mergeStateStatus,mergeable'
  ], GH_VIEW_TIMEOUT_MS);
  if (result.code !== 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new WorkspaceError('gh_failed', 'gh returned malformed JSON');
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as Record<string, unknown>;
  if (typeof row.number !== 'number' || typeof row.url !== 'string') return null;
  return {
    number: row.number,
    title: typeof row.title === 'string' ? row.title : '',
    state: typeof row.state === 'string' ? row.state : 'UNKNOWN',
    url: row.url,
    isDraft: row.isDraft === true,
    baseRefName: typeof row.baseRefName === 'string' ? row.baseRefName : '',
    headRefName: typeof row.headRefName === 'string' ? row.headRefName : branch,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
    reviewDecision: typeof row.reviewDecision === 'string' ? row.reviewDecision : null,
    mergeStateStatus: typeof row.mergeStateStatus === 'string' ? row.mergeStateStatus : null,
    mergeable: typeof row.mergeable === 'string' ? row.mergeable : null
  };
}

export async function runPullRequestAction(
  cwd: string,
  action: { operation: 'ready' } | { operation: 'draft' } | { operation: 'merge'; method: GitHostPullRequestMergeMethod }
): Promise<{ ok: true; message: string }> {
  const args = action.operation === 'merge'
    ? ['pr', 'merge', `--${action.method}`]
    : action.operation === 'ready'
      ? ['pr', 'ready']
      : ['pr', 'ready', '--undo'];
  const result = await runGh(cwd, args, GH_ACTION_TIMEOUT_MS);
  if (result.code !== 0) {
    throw new WorkspaceError('gh_failed', result.stderr.trim() || `gh pr ${action.operation} failed`);
  }
  return { ok: true, message: result.stdout.trim() || `pull request ${action.operation}` };
}
