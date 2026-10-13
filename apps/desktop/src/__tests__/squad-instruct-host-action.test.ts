import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { currentRetainedSquadWorktreeAction, isCurrentRetainedSquadWorktreeAction, isTerminalSquadExecution, isWithinRetainedSquadWorktreeBase, squadFollowUpPrompt } from '../inbox-actions/squad-instruct.js';

describe('retained squad instruct host action', () => {
  const host = readFileSync(new URL('../host.ts', import.meta.url), 'utf8');

  it('reports retained terminal worktree status without rendering lifecycle actions as Inbox questions', () => {
    expect(host).toContain('inboxStore.appendOnce(squadWorktreeRetainedNotice({');
    const terminalNotice = host.slice(host.indexOf('async function handleSquadWorktreeTerminal'), host.indexOf('async function replayUndisposedSquadWorktreeTerminalEffects'));
    expect(terminalNotice).not.toContain("questions: [{ prompt: 'Choose worktree disposition'");
  });

  it('keeps squad push guard and terminal actions fenced until cohort teardown confirms', () => {
    expect(host).toContain('const teardown = await cancelTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);');
    expect(host).toContain('if (!mayReleaseSquadWorktreeGuard(teardown)) return;');
    expect(host.indexOf('if (!mayReleaseSquadWorktreeGuard(teardown)) return;')).toBeLessThan(
      host.indexOf('setWorktreePushProtection(project.path, worktree.path, false)')
    );
    expect(host.indexOf('if (!mayReleaseSquadWorktreeGuard(teardown)) return;')).toBeLessThan(
      host.indexOf('inboxStore.appendOnce(squadWorktreeRetainedNotice({')
    );
  });

  it('replays terminal worktree effects at boot after restoring follow-up claims', () => {
    expect(host.indexOf('await restoreSurvivingSquadWorktreeFollowUpClaims();')).toBeLessThan(
      host.indexOf('await replayUndisposedSquadWorktreeTerminalEffects();')
    );
    expect(host).toContain('await executionStore.markSquadWorktreeTerminalEffects(record.id, record.stateVersion);');
    expect(host).toContain('if (!shouldReplaySquadWorktreeTerminalEffects(record)) continue;');
    expect(host).toContain('if (!existsSync(worktree.path)) {');
  });

  it('reconfines retained worktree from execution state before normal agent launch', () => {
    expect(host).toContain("throw new Error('retained squad worktree is unavailable')");
    expect(host).toContain('realpathSync(record.squadWorktree.path)');
    expect(host).toContain('isWithinRetainedSquadWorktreeBase(path, project.path)');
    expect(host).toContain('getGitStatus(path)');
    expect(host).toContain('launchAuthorizedTerminal({');
    expect(host).toContain('worktreeInfo: worktree');
    expect(host).toContain("{ retainWorktree: true }");
  });

  it('fails retained recovery when isolation settings change instead of falling back to project root', () => {
    const retainedRecovery = host.slice(
      host.indexOf('const retainedWorktree = record.squadWorktree;'),
      host.indexOf("if (preparation === 'project-root') return record;", host.indexOf('const retainedWorktree = record.squadWorktree;'))
    );

    expect(retainedRecovery).toContain("if (!project || !retainedWorktree) throw new Error('WORKTREE_UNAVAILABLE');");
    expect(retainedRecovery).toContain('isWithinSquadWorktreeBase(path, project.path)');
    expect(retainedRecovery).toContain('status.branch !== retainedWorktree.branch');
    expect(retainedRecovery).toContain("throw new Error('WORKTREE_UNAVAILABLE');");
    expect(retainedRecovery).toContain('retained: retainedWorktree !== undefined');
    expect(retainedRecovery).toContain("if (preparation === 'reattach') {");
  });

  it('rejects stale, escaped, and non-terminal worktree state', () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-squad-instruct-'));
    try {
      const worktree = join(root, '.worktrees', 'squad-1');
      mkdirSync(worktree, { recursive: true });
      expect(isWithinRetainedSquadWorktreeBase(realpathSync(worktree), realpathSync(root))).toBe(true);
      expect(isWithinRetainedSquadWorktreeBase(realpathSync(root), realpathSync(root))).toBe(false);
      expect(isTerminalSquadExecution('COMPLETED')).toBe(true);
      expect(isTerminalSquadExecution('FAILED')).toBe(true);
      expect(isTerminalSquadExecution('STOPPED')).toBe(true);
      expect(isTerminalSquadExecution('RUNNING')).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fences terminal actions to their exact state generation across resume', () => {
    const action = { executionId: 'execution-1', phase: 'choose', stateVersion: 4 };
    const terminal = { id: 'execution-1', state: 'FAILED', stateVersion: 4, squadWorktree: { path: '/project/.worktrees/squad-1', branch: 'zcc/squad-1' } };
    expect(isCurrentRetainedSquadWorktreeAction(action, terminal)).toBe(true);
    // beginRetry changes this stateVersion before resumed work can own worktree.
    expect(isCurrentRetainedSquadWorktreeAction(action, { ...terminal, state: 'RUNNING', stateVersion: 5 })).toBe(false);
    expect(isCurrentRetainedSquadWorktreeAction(action, { ...terminal, stateVersion: 5 })).toBe(false);
    expect(isCurrentRetainedSquadWorktreeAction(action, { ...terminal, dismissedAt: 1 })).toBe(false);
  });

  it('rejects a delete or spawn action when resume wins between async checks', async () => {
    const action = { executionId: 'execution-1', phase: 'choose', stateVersion: 4 };
    const terminal = { id: 'execution-1', state: 'FAILED', stateVersion: 4, squadWorktree: { path: '/project/.worktrees/squad-1', branch: 'zcc/squad-1' } };
    const resumed = { ...terminal, state: 'RUNNING', stateVersion: 5 };
    const get = vi.fn().mockResolvedValueOnce(terminal).mockResolvedValueOnce(resumed);

    await expect(currentRetainedSquadWorktreeAction(action, get)).resolves.toBe(terminal);
    await expect(currentRetainedSquadWorktreeAction(action, get)).rejects.toThrow('stale squad worktree action');
  });

  it('rechecks terminal generation and retained path at final spawn/delete boundary', () => {
    expect(host).toContain('stateVersion: record.stateVersion');
    expect(host).toContain('squad-worktree-lifecycle:${record.id}:${record.stateVersion}:${phase}');
    expect(host).toContain('currentRetainedSquadWorktreeAction(\n        fencedAction');
    expect(host).toContain('maySpawn: async () =>');
    expect(host).toContain('await retainedSquadWorktreeForInstruct(await currentRecord())');
    expect(host).toContain('const current = await currentRecord();');
    expect(host).toContain('retained = await retainedSquadWorktreeForInstruct(current);');
  });

  it('projects stale, missing-resource, and active-follow-up safety rejections into Inbox status', () => {
    expect(host).toContain("new InboxActionOperatorError('This action is unavailable because the Squad run resumed or changed state.', true)");
    expect(host).toContain("new InboxActionOperatorError('Retained Squad worktree or branch is unavailable.', true)");
    expect(host).toContain("new InboxActionOperatorError('Worktree is in use by an active follow-up agent. Wait for it to exit, then try again.')");
    expect(host).toContain("new InboxActionOperatorError('This confirmation is unavailable because the retained Squad worktree or branch no longer exists.', true)");
  });

  it('creates a fresh delete confirmation and revokes sibling confirmations after deletion', () => {
    expect(host).toContain("phase === 'confirm'\n    ? await inboxStore.append(notice)");
    expect(host).toContain('return { keepPending: true };');
    expect(host).toContain('inboxActionRegistry.markUnavailable(SQUAD_WORKTREE_ACTION');
    expect(host).toContain('retained Squad worktree was deleted');
  });

  it('uses one execution-scoped lifecycle lock across resume, teardown, deletion, and final instruct spawn', () => {
    expect(host).toContain('withExecutionLifecycleLock: withSquadWorktreeLifecycleLock');
    expect(host).toContain('withSquadWorktreeLifecycleLock(record.id, async () => {');
    expect(host).toContain('const latest = await executionStore.get(record.id);');
    expect(host).toContain('const beforeCreate = await executionStore.get(record.id);');
    expect(host).toContain('withSpawnLock: async (spawn) => withSquadWorktreeLifecycleLock(record.id');
    expect(host).toContain('const latest = await currentRecord();');
    expect(host).toContain('await retainedSquadWorktreeForInstruct(latest);');
    expect(host).toContain('return spawnLifecycle?.withSpawnLock ? spawnLifecycle.withSpawnLock(spawn) : spawn();');
  });

  it('persists follow-up ownership and restores it under lifecycle lock before recovery', () => {
    expect(host).toContain('followUpExecutionId,');
    expect(host).toContain('}, record.id);');
    expect(readFileSync(new URL('../ipc/terminals.ts', import.meta.url), 'utf8')
      .match(/capability\.followUpExecutionId/g)).toHaveLength(4);
    const terminals = readFileSync(new URL('../ipc/terminals.ts', import.meta.url), 'utf8');
    expect(terminals.match(/retainWorktree: Boolean\(capability\.followUpExecutionId\)/g)).toHaveLength(2);
    expect(host).toContain('await withSquadWorktreeLifecycleLock(capability.followUpExecutionId');
    expect(host.indexOf('await restoreSurvivingSquadWorktreeFollowUpClaims();')).toBeLessThan(
      host.indexOf('await squadExecutionService.restoreDeadlines();')
    );
    expect(host).toContain('clearSquadWorktreeFollowUpClaim(sessionId);');
  });

  it('provides source execution, squad, and branch context without restoring squad guard', () => {
    expect(squadFollowUpPrompt({
      instruction: 'Finish tests', executionId: 'execution-1', teamId: 'team-1', branch: 'zcc/team-1'
    })).toContain('Source execution: execution-1');
    expect(squadFollowUpPrompt({
      instruction: 'Finish tests', executionId: 'execution-1', teamId: 'team-1', branch: 'zcc/team-1'
    })).toContain('Source squad: team-1');
    expect(squadFollowUpPrompt({
      instruction: 'Finish tests', executionId: 'execution-1', teamId: 'team-1', branch: 'zcc/team-1'
    })).toContain('Source branch: zcc/team-1');
    expect(host).toContain('!req.cohort?.executionId && !opts?.retainWorktree');
  });
});
