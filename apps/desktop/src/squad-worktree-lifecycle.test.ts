import { describe, expect, it, vi } from 'vitest';
import {
  claimSquadWorktreeFollowUp,
  ineligibleSquadWorktreeFallback,
  mayReleaseSquadWorktreeGuard,
  releaseSquadWorktreeFollowUp,
  resolveSquadWorktreeDisposition,
  resolveSquadWorktreeIsolation,
  resolveSquadWorktreePreparation,
  restoreSquadWorktreeFollowUp,
  shouldReplaySquadWorktreeTerminalEffects,
  SQUAD_WORKTREE_FALLBACK_NOTICE,
  squadWorktreeHasActiveFollowUp,
  squadWorktreeFollowUpExecution,
  withSquadWorktreeLifecycleLock
} from './squad-worktree-lifecycle.js';

describe('squad worktree lifecycle', () => {
  it('resolves explicit launch override, squad policy, then project-or-global default', () => {
    expect(resolveSquadWorktreeIsolation({ launch: false, project: true, global: true, squad: true })).toBe(false);
    expect(resolveSquadWorktreeIsolation({ launch: true, project: false, global: false, squad: false })).toBe(true);
    // Unset squad policy delegates to existing project-over-global behavior.
    expect(resolveSquadWorktreeIsolation({ project: false, global: true })).toBe(false);
    expect(resolveSquadWorktreeIsolation({ project: true, global: false })).toBe(true);
    expect(resolveSquadWorktreeIsolation({ global: true })).toBe(true);
    // Squad On and Off force their setting over the inherited project/global value.
    expect(resolveSquadWorktreeIsolation({ project: false, global: true, squad: true })).toBe(true);
    expect(resolveSquadWorktreeIsolation({ project: true, global: true, squad: false })).toBe(false);
    expect(resolveSquadWorktreeIsolation({ global: true, squad: false })).toBe(false);
    expect(resolveSquadWorktreeIsolation({ squad: true })).toBe(true);
    expect(resolveSquadWorktreeIsolation({ project: true })).toBe(true);
    expect(resolveSquadWorktreeIsolation({})).toBe(false);
  });

  it('reattaches recorded worktrees after isolation settings change', () => {
    expect(resolveSquadWorktreePreparation({
      retained: true,
      launch: false,
      squad: false,
      project: false,
      global: false
    })).toBe('reattach');
    expect(resolveSquadWorktreePreparation({ retained: false, global: false })).toBe('project-root');
    expect(resolveSquadWorktreePreparation({ retained: false, squad: true })).toBe('create');
  });

  it('requires a confirm phase before delete or force delete', () => {
    expect(resolveSquadWorktreeDisposition('choose', 'delete')).toBe('confirm');
    expect(resolveSquadWorktreeDisposition('choose', 'confirm-delete')).toBe('invalid');
    expect(resolveSquadWorktreeDisposition('choose', 'force-delete')).toBe('invalid');
    expect(resolveSquadWorktreeDisposition('confirm', 'confirm-delete')).toBe('delete');
    expect(resolveSquadWorktreeDisposition('confirm', 'force-delete')).toBe('force');
  });

  it('releases squad push guard only after cohort termination is confirmed', () => {
    expect(mayReleaseSquadWorktreeGuard({ ok: true, value: { lifecycleState: 'cancel-pending', pendingSessionIds: [] } })).toBe(false);
    expect(mayReleaseSquadWorktreeGuard({ ok: true, value: { lifecycleState: 'canceled', pendingSessionIds: ['worker-1'] } })).toBe(false);
    expect(mayReleaseSquadWorktreeGuard({ ok: false })).toBe(false);
    expect(mayReleaseSquadWorktreeGuard({ ok: true, value: { lifecycleState: 'canceled', pendingSessionIds: [] } })).toBe(true);
  });

  it('allows leave from either phase without permitting unsupported actions', () => {
    expect(resolveSquadWorktreeDisposition('choose', 'leave')).toBe('leave');
    expect(resolveSquadWorktreeDisposition('confirm', 'leave')).toBe('leave');
    expect(resolveSquadWorktreeDisposition('choose', 'instruct')).toBe('instruct');
    expect(resolveSquadWorktreeDisposition('confirm', 'instruct')).toBe('invalid');
  });

  it.each([
    ['remote project', { path: '/project', remote: { host: 'remote' } }, true],
    ['quick-agent project', { path: '/project', quickAgent: true }, true],
    ['non-Git local project', { path: '/project' }, false]
  ])('falls back without a worktree and gives exact Inbox copy for %s', async (_kind, project, git) => {
    const isGitRepo = vi.fn(async () => git);

    await expect(ineligibleSquadWorktreeFallback(project, isGitRepo)).resolves.toEqual({
      squadWorktree: undefined,
      notice: {
        subject: 'Squad ran in the project folder',
        comments: 'Worktrees need a local Git project, so this squad worked in the project folder. Its changes are in your working copy.'
      }
    });
    expect(SQUAD_WORKTREE_FALLBACK_NOTICE).toEqual({
      subject: 'Squad ran in the project folder',
      comments: 'Worktrees need a local Git project, so this squad worked in the project folder. Its changes are in your working copy.'
    });
    expect(isGitRepo).toHaveBeenCalledTimes(project.remote || project.quickAgent ? 0 : 1);
  });

  it('serializes lifecycle side effects per execution without blocking another worktree', async () => {
    let release!: () => void;
    const steps: string[] = [];
    const first = withSquadWorktreeLifecycleLock('execution-1', async () => {
      steps.push('first');
      await new Promise<void>((resolve) => { release = resolve; });
    });
    const stale = withSquadWorktreeLifecycleLock('execution-1', async () => { steps.push('stale'); });
    await withSquadWorktreeLifecycleLock('execution-2', async () => { steps.push('other'); });

    expect(steps).toEqual(['first', 'other']);
    release();
    await Promise.all([first, stale]);
    expect(steps).toEqual(['first', 'other', 'stale']);
  });

  it.each(['teardown guard disable', 'delete removal', 'instruct spawn'] as const)(
    'rejects stale %s after resume advances ownership before locked side effect',
    async (sideEffect) => {
      const ran: string[] = [];
      let stateVersion = 4;
      let release!: () => void;
      const resume = withSquadWorktreeLifecycleLock('execution-1', async () => {
        await new Promise<void>((resolve) => { release = resolve; });
        stateVersion = 5;
      });
      // Each queued side effect captured version 4 and must re-check it under the lock.
      const stale = withSquadWorktreeLifecycleLock('execution-1', async () => {
        if (stateVersion !== 4) return false;
        ran.push(sideEffect);
        return true;
      });

      await Promise.resolve();
      expect(ran).toEqual([]);
      release();
      await resume;
      await expect(stale).resolves.toBe(false);
      expect(ran).toEqual([]);

      // Once ownership is stable, the same side effect runs under its own label.
      stateVersion = 4;
      await expect(withSquadWorktreeLifecycleLock('execution-1', async () => {
        ran.push(sideEffect);
        return true;
      })).resolves.toBe(true);
      expect(ran).toEqual([sideEffect]);
    }
  );

  it('retains follow-up ownership until confirmed exit releases its session', async () => {
    await withSquadWorktreeLifecycleLock('execution-follow-up', async () => {
      claimSquadWorktreeFollowUp('execution-follow-up', 'follow-up-1');
      claimSquadWorktreeFollowUp('execution-follow-up', 'follow-up-2');
      expect(squadWorktreeHasActiveFollowUp('execution-follow-up')).toBe(true);
      expect(squadWorktreeFollowUpExecution('follow-up-1')).toBe('execution-follow-up');
      releaseSquadWorktreeFollowUp('execution-follow-up', 'follow-up-1');
      expect(squadWorktreeHasActiveFollowUp('execution-follow-up')).toBe(true);
      releaseSquadWorktreeFollowUp('execution-follow-up', 'follow-up-2');
      expect(squadWorktreeHasActiveFollowUp('execution-follow-up')).toBe(false);
      expect(squadWorktreeFollowUpExecution('follow-up-2')).toBeUndefined();
    });
  });

  it('restores retained follow-up ownership after restart until confirmed exit', async () => {
    await withSquadWorktreeLifecycleLock('execution-restart', async () => {
      restoreSquadWorktreeFollowUp('execution-restart', 'follow-up-survivor');
      expect(squadWorktreeHasActiveFollowUp('execution-restart')).toBe(true);
      expect(squadWorktreeFollowUpExecution('follow-up-survivor')).toBe('execution-restart');
      releaseSquadWorktreeFollowUp('execution-restart', 'follow-up-survivor');
      expect(squadWorktreeHasActiveFollowUp('execution-restart')).toBe(false);
    });
  });

  it('keeps delete and resume guards active through repeated terminal restores', async () => {
    await withSquadWorktreeLifecycleLock('execution-restore-cycle', async () => {
      const mayDeleteOrResume = () => !squadWorktreeHasActiveFollowUp('execution-restore-cycle');

      // Each replacement session inherits durable ownership from its predecessor.
      restoreSquadWorktreeFollowUp('execution-restore-cycle', 'follow-up-1');
      restoreSquadWorktreeFollowUp('execution-restore-cycle', 'follow-up-2');
      expect(squadWorktreeHasActiveFollowUp('execution-restore-cycle')).toBe(true);
      expect(mayDeleteOrResume()).toBe(false);

      releaseSquadWorktreeFollowUp('execution-restore-cycle', 'follow-up-1');
      expect(squadWorktreeHasActiveFollowUp('execution-restore-cycle')).toBe(true);
      expect(mayDeleteOrResume()).toBe(false);

      releaseSquadWorktreeFollowUp('execution-restore-cycle', 'follow-up-2');
      expect(squadWorktreeHasActiveFollowUp('execution-restore-cycle')).toBe(false);
      expect(mayDeleteOrResume()).toBe(true);
    });
  });

  it('replays terminal worktree effects after a crash before their handler, then dedupes later boots', () => {
    const terminal = {
      state: 'COMPLETED', stateVersion: 4,
      squadWorktree: { path: '/project/.worktrees/squad-1', branch: 'zcc/squad-1' }
    };

    // Crash after terminal state persisted but before host terminal handler runs.
    expect(shouldReplaySquadWorktreeTerminalEffects(terminal)).toBe(true);
    expect(shouldReplaySquadWorktreeTerminalEffects({
      ...terminal,
      terminalWorktreeEffectsStateVersion: terminal.stateVersion
    })).toBe(false);
    expect(shouldReplaySquadWorktreeTerminalEffects({ ...terminal, dismissedAt: 1 })).toBe(false);
  });

  it('serializes stale delete behind follow-up ownership until confirmed exit', async () => {
    let releaseExit!: () => void;
    const steps: string[] = [];
    const followUpExit = withSquadWorktreeLifecycleLock('execution-race', async () => {
      claimSquadWorktreeFollowUp('execution-race', 'follow-up-1');
      await new Promise<void>((resolve) => { releaseExit = resolve; });
      releaseSquadWorktreeFollowUp('execution-race', 'follow-up-1');
    });
    const staleDelete = withSquadWorktreeLifecycleLock('execution-race', async () => {
      if (squadWorktreeHasActiveFollowUp('execution-race')) return false;
      steps.push('delete');
      return true;
    });

    await Promise.resolve();
    releaseExit();
    await followUpExit;
    await expect(staleDelete).resolves.toBe(true);
    expect(steps).toEqual(['delete']);
  });
});
