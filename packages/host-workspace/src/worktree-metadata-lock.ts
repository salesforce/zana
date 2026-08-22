import { withQueuedLock } from './process-local-queued-lock.js';
import { getGitCommonDir } from './git.js';

/**
 * Serialize `git worktree` metadata mutations for one repository.
 * Lock order (deadlock avoidance): checkout mutation lock, THEN this lock.
 */
export async function withWorktreeMetadataLock<T>(cwd: string, run: () => Promise<T>): Promise<T> {
  const commonDir = await getGitCommonDir(cwd);
  return withQueuedLock(`worktree-meta:${commonDir}`, run);
}
