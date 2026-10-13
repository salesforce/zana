import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { currentRetainedSquadWorktreeAction, isCurrentRetainedSquadWorktreeAction, isTerminalSquadExecution, isWithinRetainedSquadWorktreeBase, squadFollowUpPrompt } from '../inbox-actions/squad-instruct.js';

describe('retained squad instruct host action', () => {
  const host = readFileSync(new URL('../host.ts', import.meta.url), 'utf8');
  // The retained-worktree lifecycle lives in extracted modules; host.ts only wires them.
  const runtime = readFileSync(new URL('../squad-worktree-runtime.ts', import.meta.url), 'utf8');
  const sessionLifecycle = readFileSync(new URL('../squad-session-lifecycle.ts', import.meta.url), 'utf8');
  const support = readFileSync(new URL('../team-launch-support.ts', import.meta.url), 'utf8');

  it('reports retained terminal worktree status without rendering lifecycle actions as Inbox questions', () => {
    expect(runtime).toContain('inboxStore.appendOnce(squadWorktreeRetainedNotice({');
    const terminalNotice = runtime.slice(runtime.indexOf('async function handleSquadWorktreeTerminal'), runtime.indexOf('async function replayUndisposedTerminalEffects'));
    expect(terminalNotice).not.toContain("questions: [{ prompt: 'Choose worktree disposition'");
  });

  it('keeps squad push guard and terminal actions fenced until cohort teardown confirms', () => {
    expect(runtime).toContain('const teardown = await deps.cancelTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);');
    expect(runtime).toContain('if (!mayReleaseSquadWorktreeGuard(teardown)) return;');
    expect(runtime.indexOf('if (!mayReleaseSquadWorktreeGuard(teardown)) return;')).toBeLessThan(
      runtime.indexOf('git.setWorktreePushProtection(project.path, worktree.path, false)')
    );
    expect(runtime.indexOf('if (!mayReleaseSquadWorktreeGuard(teardown)) return;')).toBeLessThan(
      runtime.indexOf('inboxStore.appendOnce(squadWorktreeRetainedNotice({')
    );
  });

  it('replays terminal worktree effects at boot after restoring follow-up claims', () => {
    expect(host).toContain('await recoverSquadStateAtBoot({');
    expect(support.indexOf('await deps.squadFollowUpClaims.restoreSurvivingClaims();')).toBeLessThan(
      support.indexOf('await deps.squadWorktreeRuntime.replayUndisposedTerminalEffects();')
    );
    expect(runtime).toContain('await executionStore.markSquadWorktreeTerminalEffects(record.id, record.stateVersion);');
    expect(runtime).toContain('if (!shouldReplaySquadWorktreeTerminalEffects(record)) continue;');
    expect(runtime).toContain('if (!fs.existsSync(worktree.path)) {');
  });

  it('reconfines retained worktree from execution state before normal agent launch', () => {
    expect(runtime).toContain("throw new Error('retained squad worktree is unavailable')");
    expect(runtime).toContain('fs.realpathSync(record.squadWorktree.path)');
    expect(runtime).toContain('isWithinRetainedSquadWorktreeBase(path, project.path)');
    expect(runtime).toContain('git.getGitStatus(path)');
    expect(runtime).toContain('worktreeInfo: worktree');
    expect(host).toContain('launchAuthorizedTerminal(');
    expect(host).toContain("{ retainWorktree: true }");
  });

  it('fails retained recovery when isolation settings change instead of falling back to project root', () => {
    const retainedRecovery = runtime.slice(
      runtime.indexOf('async function prepareSquadWorktree'),
      runtime.indexOf('async function create(')
    );

    expect(retainedRecovery).toContain("if (!project || !retainedWorktree) throw new Error('WORKTREE_UNAVAILABLE');");
    expect(retainedRecovery).toContain('withinBase(path, project.path)');
    expect(retainedRecovery).toContain('status.branch !== retainedWorktree.branch');
    expect(retainedRecovery).toContain("throw new Error('WORKTREE_UNAVAILABLE');");
    expect(retainedRecovery).toContain('retained: retainedWorktree !== undefined');
    expect(retainedRecovery).toContain("if (preparation === 'reattach') return reattach(");
  });

  it('rejects stale, escaped, and non-terminal worktree state', () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-squad-instruct-'));
    try {
      const worktree = join(root, '.worktrees', 'squad-1');
      mkdirSync(worktree, { recursive: true });
      expect(isWithinRetainedSquadWorktreeBase(realpathSync(worktree), realpathSync(root))).toBe(true);
      expect(isWithinRetainedSquadWorktreeBase(realpathSync(root), realpathSync(root))).toBe(false);
      expect(isWithinRetainedSquadWorktreeBase(join(root, '.worktrees'), root)).toBe(false);
      expect(isWithinRetainedSquadWorktreeBase(join(root, 'elsewhere'), root)).toBe(false);
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
    // Leave disposition makes stale Delete/Force-delete capabilities unusable.
    expect(isCurrentRetainedSquadWorktreeAction(action, { ...terminal, squadWorktreeDisposition: 'left' })).toBe(false);
    expect(isCurrentRetainedSquadWorktreeAction(action, { ...terminal, squadWorktree: undefined })).toBe(false);
    expect(isCurrentRetainedSquadWorktreeAction({ ...action, executionId: 'other' }, terminal)).toBe(false);
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
    expect(runtime).toContain('stateVersion: record.stateVersion');
    expect(runtime).toContain('squad-worktree-lifecycle:${record.id}:${record.stateVersion}:${phase}');
    expect(runtime).toMatch(/currentRetainedSquadWorktreeAction\(\s*fencedAction/);
    expect(runtime).toContain('maySpawn: async () =>');
    expect(runtime).toContain('await retainedSquadWorktreeForInstruct(await currentRecord())');
    expect(runtime).toContain('const current = await currentRecord();');
    expect(runtime).toContain('retained = await retainedSquadWorktreeForInstruct(current);');
  });

  it('projects stale, missing-resource, and active-follow-up safety rejections into Inbox status', () => {
    expect(runtime).toContain("new InboxActionOperatorError('This action is unavailable because the Squad run resumed or changed state.', true)");
    expect(runtime).toContain('new InboxActionOperatorError(RETAINED_UNAVAILABLE_MESSAGE, true)');
    expect(runtime).toContain("const RETAINED_UNAVAILABLE_MESSAGE = 'Retained Squad worktree or branch is unavailable.';");
    expect(runtime).toContain('new InboxActionOperatorError(ACTIVE_FOLLOW_UP_MESSAGE)');
    expect(runtime).toContain("'Worktree is in use by an active follow-up agent. Wait for it to exit, then try again.'");
    expect(runtime).toContain('new InboxActionOperatorError(CONFIRMATION_UNAVAILABLE_MESSAGE, true)');
    expect(runtime).toContain("'This confirmation is unavailable because the retained Squad worktree or branch no longer exists.'");
  });

  it('creates a fresh delete confirmation and revokes sibling confirmations after deletion', () => {
    expect(runtime).toMatch(/phase === 'confirm'\s*\? await inboxStore\.append\(notice\)/);
    expect(runtime).toContain('return { keepPending: true };');
    expect(runtime).toContain('inboxActionRegistry.markUnavailable(SQUAD_WORKTREE_ACTION');
    expect(runtime).toContain('retained Squad worktree was deleted');
  });

  it('uses one execution-scoped lifecycle lock across resume, teardown, deletion, and final instruct spawn', () => {
    expect(host).toContain('withExecutionLifecycleLock: withSquadWorktreeLifecycleLock');
    expect(runtime).toContain('withSquadWorktreeLifecycleLock(record.id, async () => {');
    expect(runtime).toContain('const latest = await executionStore.get(record.id);');
    expect(runtime).toContain('const beforeCreate = await executionStore.get(record.id);');
    expect(runtime).toContain('withSpawnLock: async (spawn) => withSquadWorktreeLifecycleLock(record.id');
    expect(runtime).toContain('const latest = await currentRecord();');
    expect(runtime).toContain('await retainedSquadWorktreeForInstruct(latest);');
    expect(support).toContain('lifecycle?.withSpawnLock ? lifecycle.withSpawnLock(spawn) : spawn()');
    expect(host).toContain('runSpawnLifecycle(spawnLifecycle, spawn)');
  });

  it('persists follow-up ownership and restores it under lifecycle lock before recovery', () => {
    expect(host).toContain('followUpExecutionId,');
    expect(runtime).toContain('}, record.id);');
    const restoreLaunch = readFileSync(new URL('../terminal-restore-launch.ts', import.meta.url), 'utf8');
    expect(restoreLaunch.match(/followUpExecutionId: capability\.followUpExecutionId/g)).toHaveLength(2);
    expect(restoreLaunch.match(/retainWorktree: Boolean\(capability\.followUpExecutionId\)/g)).toHaveLength(2);
    const terminals = readFileSync(new URL('../ipc/terminals.ts', import.meta.url), 'utf8');
    expect(terminals).toContain('restoreCapabilityLaunch(');
    expect(terminals).toContain('reconnectCapabilityLaunch(');
    expect(sessionLifecycle).toContain('await withSquadWorktreeLifecycleLock(followUpExecutionId');
    expect(support.indexOf('await deps.squadFollowUpClaims.restoreSurvivingClaims();')).toBeLessThan(
      support.indexOf('await deps.squadExecutionService.restoreDeadlines();')
    );
    expect(sessionLifecycle).toContain('clearClaim(sessionId);');
    expect(host).toContain('squadFollowUpClaims.releaseOnExit(sessionId)');
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
