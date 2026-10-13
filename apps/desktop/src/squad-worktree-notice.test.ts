import { describe, expect, it } from 'vitest';
import { SQUAD_WORKTREE_NOTICE, squadWorktreeNotice, squadWorktreeRetainedNotice, squadWorktreeUnavailableNotice } from './squad-worktree-notice.js';

describe('squad worktree notices', () => {
  it('stamps arbitrary notice input with the structured discriminator', () => {
    expect(squadWorktreeNotice({ projectId: 'p', comments: 'x' })).toEqual({ projectId: 'p', comments: 'x', squadNotice: SQUAD_WORKTREE_NOTICE });
  });

  it('builds a stamped unavailable notice with stable dedupe key', () => {
    expect(squadWorktreeUnavailableNotice({ id: 'p', name: 'Proj' }, 'run-1', 'boom')).toEqual({
      projectId: 'p',
      projectLabel: 'Proj',
      subject: 'Squad worktree unavailable',
      comments: 'Squad run uses project root because shared worktree creation failed: boom',
      executionId: 'run-1',
      dedupeKey: 'squad-worktree-fallback:run-1',
      squadNotice: 'worktree-lifecycle'
    });
  });

  it('builds a stamped retained notice keyed by state version', () => {
    const notice = squadWorktreeRetainedNotice({ projectId: 'p', executionId: 'run-1', stateVersion: 7, jobTitle: 'Job', state: 'FAILED', worktreePath: '/p/.worktrees/x' });
    expect(notice).toMatchObject({
      squadNotice: 'worktree-lifecycle',
      subject: 'Squad worktree retained',
      origin: { title: 'Job' },
      dedupeKey: 'squad-worktree-retained:run-1:7'
    });
    expect(notice.comments).toBe('Execution failed. The shared worktree remains at `/p/.worktrees/x`. Open Squad details to inspect recovery options and manage the retained worktree.');
  });
});
