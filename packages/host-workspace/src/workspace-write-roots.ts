import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isWithin } from '@zana-ai/zcc-path-confine';
import { getAbsoluteGitDir, getGitCommonDir } from './git.js';

function nestedOrSame(childPath: string, parentPath: string): boolean {
  return isWithin(resolve(childPath), resolve(parentPath));
}

function extraRootsFrom(gitDir: string, commonGitDir: string, workspacePath: string): string[] {
  const candidates = [
    gitDir,
    join(commonGitDir, 'objects'),
    join(commonGitDir, 'refs'),
    join(commonGitDir, 'logs')
  ];
  const seen = new Set<string>();
  const extra: string[] = [];
  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (seen.has(resolved) || nestedOrSame(resolved, workspacePath)) continue;
    seen.add(resolved);
    extra.push(resolved);
  }
  return extra;
}

/**
 * Sync twin used when assembling a Seatbelt profile (pty `create()` is sync).
 * Reads the worktree `.git` file + `commondir`; never shells out.
 */
export function resolveAdditionalWorkspaceWriteRootsSync(workspacePath: string): string[] {
  try {
    const gitPath = join(workspacePath, '.git');
    if (!existsSync(gitPath)) return [];
    const st = statSync(gitPath);
    if (st.isDirectory()) return [];
    const text = readFileSync(gitPath, 'utf8');
    const match = text.match(/^gitdir:\s*(.+)\s*$/m);
    if (!match?.[1]) return [];
    const gitDir = resolve(workspacePath, match[1].trim());
    let commonGitDir = dirname(dirname(gitDir));
    const commonFile = join(gitDir, 'commondir');
    if (existsSync(commonFile)) {
      commonGitDir = resolve(gitDir, readFileSync(commonFile, 'utf8').trim());
    }
    return extraRootsFrom(gitDir, commonGitDir, workspacePath);
  } catch {
    return [];
  }
}

export async function resolveAdditionalWorkspaceWriteRoots(workspacePath: string): Promise<string[]> {
  try {
    const [gitDir, commonGitDir] = await Promise.all([
      getAbsoluteGitDir(workspacePath),
      getGitCommonDir(workspacePath)
    ]);
    return extraRootsFrom(gitDir, commonGitDir, workspacePath);
  } catch {
    return resolveAdditionalWorkspaceWriteRootsSync(workspacePath);
  }
}
