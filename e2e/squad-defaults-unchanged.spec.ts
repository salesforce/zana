import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect } from './fixtures/app.js';
import {
  coordinatorResult, createJobTeamContext, initSquadRepo, jobTeamFailure, launchSquadFixture,
  readCoordinatorLog, squadInitial, squadNowReceipt, squadTerminal, SQUAD_WRITE_PLAN, teardownJobTeam
} from './sdk/job-team-scenario.js';

test.use({ e2e: true, initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true, tmuxScope: 'off' } });
test.setTimeout(180_000);

test('no Launch declarations preserve leave, fail-run, managed push guard and Review floor', async ({ app, home }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'defaults-', root: home, scenario: 'unattended' });
  try {
    const git = initSquadRepo(ctx);
    const remote = join(ctx.projectDir, '.git', 'fixture-remote.git');
    git('init', '--bare', remote);
    git('remote', 'add', 'origin', remote);
    expect(SQUAD_WRITE_PLAN).not.toContain('## Launch');
    const projectId = await launchSquadFixture(ctx, [
      { label: 'default', input: { mode: 'now', title: 'No declaration defaults' } },
      { label: 'review-floor', waitFor: '.e2e-review-policy', input: { mode: 'now', title: 'Review denied' } }
    ], { teamExtra: { worktreeIsolation: true } });
    const receipt = await squadNowReceipt(ctx, 'default');
    const initial = await squadInitial(ctx, 'default');
    expect(initial.resolvedLaunch).toEqual({
      worktree: { value: true, source: 'squad' }, onComplete: { value: 'leave', source: 'default' },
      push: { value: false, source: 'default' }, checks: { value: [], source: 'default' },
      failurePolicyDefault: { value: 'fail-run', source: 'default' }
    });
    expect(initial.workUnits!.every(unit => unit.onFailure === undefined)).toBe(true);
    const terminal = await squadTerminal(ctx, 'default');
    expect(terminal.state).toBe('COMPLETED');
    expect(terminal.resolvedLaunch).toEqual(initial.resolvedLaunch);
    expect(existsSync(receipt.path!)).toBe(true);
    expect(realpathSync(receipt.path!)).not.toBe(realpathSync(ctx.projectDir));
    expect(readFileSync(join(receipt.path!, 'output.txt'), 'utf8')).toBe('output ready\n');
    const hooks = resolve(receipt.path!, spawnSync('git', ['rev-parse', '--git-path', 'zana-hooks'], { cwd: receipt.path, encoding: 'utf8' }).stdout.trim());
    expect(existsSync(join(hooks, 'pre-push'))).toBe(true);
    const push = spawnSync('git', ['-c', `core.hooksPath=${hooks}`, 'push', 'origin', 'HEAD:refs/heads/forbidden'], {
      cwd: receipt.path, encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ZANA_INSTRUCT_WORKTREE_PUSH_AUTHORIZATION: 'nonempty-old-bypass' }
    });
    expect(push.status).not.toBe(0);
    expect(push.stderr).toMatch(/push.*(blocked|disabled|not allowed)|blocked.*push/i);
    expect(git('ls-remote', 'origin')).toBe('');
    await ctx.window.evaluate(id => window.cc.projectSettings.set(id, { launchApproval: 'review' }), projectId);
    writeFileSync(join(ctx.projectDir, '.e2e-review-policy'), 'go');
    await expect.poll(() => coordinatorResult(ctx, 'propose[review-floor]'), { timeout: 60_000 }).not.toBeNull();
    expect(coordinatorResult(ctx, 'propose[review-floor]'), readCoordinatorLog(ctx)).toMatchObject({ ok: false, error: expect.stringContaining('LAUNCH_REVIEW_REQUIRED') });
    expect((await ctx.window.evaluate(id => window.cc.executionBoard.listProject(id), projectId)).executions).toHaveLength(1);
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});

test('no failure declaration fails run instead of retrying failed step', async ({ app, home }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'defaults-failure-', root: home, scenario: 'failed-dag' });
  try {
    initSquadRepo(ctx);
    await launchSquadFixture(ctx, [{ label: 'failed', input: { mode: 'now' } }], { plan: [
      '# Default failure plan', '### fail-root: Fail <!-- executable-step -->',
      '- Work: Fail with deterministic validation error.', '- Mode: read-only', '- Verification: failure recorded.', ''
    ].join('\n') });
    const terminal = await squadTerminal(ctx, 'failed');
    expect(terminal.state).toBe('FAILED');
    expect(terminal.resolvedLaunch.failurePolicyDefault).toEqual({ value: 'fail-run', source: 'default' });
    expect(terminal.workUnits![0]).toMatchObject({ state: 'FAILED', attempt: 1, failureCode: 'VALIDATION_FAILED' });
    expect(terminal.workUnits![0].failureRetry).toBeUndefined();
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});
