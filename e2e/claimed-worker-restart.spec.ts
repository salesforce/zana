import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import {
  createJobTeamContext, initSquadRepo, jobTeamFailure, launchJobTeamCliOwner, launchSquadFixture,
  squadInitial, squadNowReceipt, squadTerminal, teardownJobTeam, waitForCoordinatorResult
} from './sdk/job-team-scenario.js';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true, tmuxScope: 'off' },
  launchEnv: {
    ZCC_WORK_CLAIM_LEASE_MS: '60000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '60000',
    ZCC_WORKER_API_ERROR_NUDGE_MS: '2000', ZCC_WORKER_API_ERROR_NUDGE_TURN_MS: '8000',
    ZCC_WORKER_API_ERROR_RESTART_DELAY_MS: '2000', ZCC_WORKER_API_ERROR_RESTART_TURN_MS: '30000'
  }
});

test('fresh authenticated owner resumes squad_launch run without changing user-owned checkout', async ({ app, home }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'owner-resume-', root: home, scenario: 'stalled-worker' });
  try {
    const git = initSquadRepo(ctx);
    const linked = join(ctx.projectDir, '.worktrees', 'resume-owned');
    git('worktree', 'add', '-b', 'feature/resume-owned', linked);
    const projectId = await launchSquadFixture(ctx, [{ label: 'owned', input: {
      mode: 'now', title: 'Owner resume checkout', launchOptions: { target: { kind: 'worktree', branch: 'feature/resume-owned' } }
    } }], { plan: [
      '### stall-unit: Hold claim <!-- executable-step -->', '- Work: Hold assigned claim until stopped.',
      '- Mode: read-only', '- Verification: Owner can resume.', ''
    ].join('\n') });
    const receipt = await squadNowReceipt(ctx, 'owned');
    const tokenFile = join(home, '.zcc', 'execution-resume.enc');
    await expect.poll(() => existsSync(tokenFile), { timeout: 15_000 }).toBe(true);
    const stored = JSON.parse(readFileSync(tokenFile, 'utf8')).tokens.find((entry: { executionId: string }) => entry.executionId === receipt.executionId);
    expect(Boolean(stored), 'main cached isolated E2E resume grant').toBe(true);
    const token = Buffer.from(stored.tokenEnc, 'base64').toString('utf8');
    const ownerModal = ctx.window.getByRole('dialog', { name: /^Agent / }).first();
    if (await ownerModal.count()) await ownerModal.getByRole('button', { name: 'Close' }).click();
    const oldOwner = await ctx.window.evaluate(async id =>
      (await window.cc.terminals.list(id)).find(s => s.title.includes('E2E launch Squad'))!.id, projectId);
    await ctx.window.evaluate(id => window.cc.terminals.close(id), oldOwner);
    writeFileSync(join(ctx.projectDir, '.e2e-proposal.json'), JSON.stringify({ planPath: '.e2e-plan.md', proposals: [
      { label: 'resume', tool: 'execution.resume_binding', input: { executionId: receipt.executionId, token } },
      { label: 'status', tool: 'execution.status', input: { executionId: receipt.executionId } }
    ] }));
    await launchJobTeamCliOwner(ctx, { workerQuantity: 1, prompt: 'E2E launch Squad' });
    await waitForCoordinatorResult(ctx, 'propose[resume]');
    const status = await waitForCoordinatorResult<{ id: string; reportTo: { id: string; role: string }; squadWorktree: { path: string; ownership: string; targetKind: string } }>(ctx, 'propose[status]');
    expect(status.id).toBe(receipt.executionId);
    expect(status.reportTo.role).toBe('owner');
    expect(status.reportTo.id).not.toBe(oldOwner);
    expect(status.squadWorktree).toMatchObject({ path: realpathSync(linked), ownership: 'user', targetKind: 'worktree' });
    const board = await ctx.window.evaluate(id => window.cc.executionBoard.listProject(id), projectId);
    expect(board.executions).toHaveLength(1);
    expect(existsSync(linked)).toBe(true);
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});
test.setTimeout(180_000);

for (const target of ['managed', 'project-root', 'worktree'] as const) {
  test(`CLAIMED engineer restart keeps session, claim and ${target} target ownership via squad_launch`, async ({ app, home }) => {
    const ctx = createJobTeamContext(app, { tmpPrefix: 'claimed-restart-', root: home, scenario: 'api-error-restart' });
    try {
      const git = initSquadRepo(ctx);
      const linked = join(ctx.projectDir, '.worktrees', 'engineer');
      if (target === 'worktree') git('worktree', 'add', '-b', 'feature/engineer', linked);
      const projectId = await launchSquadFixture(ctx, [{ label: 'restart', input: {
        mode: 'now', title: `CLAIMED ${target}`,
        launchOptions: target === 'managed' ? { worktree: true, onComplete: 'leave' }
          : { target: target === 'project-root' ? { kind: 'project-root' } : { kind: 'worktree', branch: 'feature/engineer' } }
      } }], { plan: [
        '# Restart plan', '### api-error-unit: Recover <!-- executable-step -->',
        '- Work: Write api-error.txt after transient API recovery.',
        '- Write scope: `api-error.txt`', '- Verification: Read api-error.txt.', ''
      ].join('\n') });
      const receipt = await squadNowReceipt(ctx, 'restart');
      const initial = await squadInitial(ctx, 'restart');
      let sessionId = '';
      let claimId = '';
      let generation = 0;
      const observed = new Map<string, string>();
      await expect.poll(async () => ctx.window.evaluate(async ({ projectId, executionId }) => {
        const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
        return { unit: snap?.execution.work?.assignments.find(u => u.workUnitId === 'api-error-unit'),
          workers: (await window.cc.terminals.list(projectId)).filter(s => s.cohort?.executionId === executionId && s.cohort.role === 'worker').map(s => ({ id: s.id, cwd: s.cwd })) };
      }, { projectId, executionId: receipt.executionId }).then(view => {
        if (view.unit?.state !== 'CLAIMED' || !view.workers.length) return false;
        sessionId = view.workers[0].id;
        claimId = view.unit.claimId!;
        generation = view.unit.claimGeneration!;
        return true;
      }), { timeout: 60_000, intervals: [100] }).toBe(true);
      await expect.poll(async () => {
        const snap = await ctx.window.evaluate(async ({ projectId, executionId }) => {
          const snapshot = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
          const workers = (await window.cc.terminals.list(projectId)).filter(s => s.cohort?.executionId === executionId && s.cohort.role === 'worker').map(s => ({ id: s.id, cwd: s.cwd }));
          return { snapshot, workers };
        }, { projectId, executionId: receipt.executionId });
        for (const worker of snap.workers) observed.set(worker.id, worker.cwd);
        const unit = snap.snapshot?.execution.work?.assignments.find(u => u.workUnitId === 'api-error-unit');
        if (unit?.state === 'CLAIMED') {
          expect(unit.claimId).toBe(claimId);
          expect(unit.claimGeneration).toBe(generation);
        }
        return snap.snapshot?.execution.state;
      }, { timeout: 120_000, intervals: [100] }).toBe('COMPLETED');
      const terminal = await squadTerminal(ctx, 'restart');
      expect(terminal.workUnits![0]).toMatchObject({ state: 'COMPLETED', claimGeneration: generation });
      expect(terminal.workUnits![0].history.filter(h => h.action === 'claimed')).toHaveLength(1);
      expect([...observed.keys()]).toEqual([sessionId]);
      expect(realpathSync(observed.get(sessionId)!)).toBe(realpathSync(receipt.path!));
      expect(terminal.squadWorktree?.path).toBe(receipt.path);
      expect(terminal.squadWorktree?.ownership ?? 'managed').toBe(target === 'managed' ? 'managed' : 'user');
      if (target !== 'managed') expect(terminal.squadWorktree?.targetKind).toBe(target);
      expect(terminal.resolvedLaunch).toEqual(initial.resolvedLaunch);
      if (target === 'project-root') expect(realpathSync(receipt.path!)).toBe(realpathSync(ctx.projectDir));
      if (target === 'worktree') expect(realpathSync(receipt.path!)).toBe(realpathSync(linked));
      const log = readFileSync(join(receipt.path!, '.fake-coordinator.log'), 'utf8');
      const boots = [...log.matchAll(/WORK:\d+ boot .*resumed=(true|false) sid=(\S+)/g)];
      expect(boots.map(m => m[1])).toEqual(['false', 'true']);
      expect(boots.map(m => m[2])).toEqual([sessionId, sessionId]);
      expect(readFileSync(join(receipt.path!, 'api-error.txt'), 'utf8')).toBe('RECOVERED: ready\n');
      expect(existsSync(receipt.path!)).toBe(true);
      expect(git('branch', '--show-current')).toBe('main');
    } catch (error) {
      if (ctx.projectId) {
        const views = await ctx.window.evaluate(async projectId => {
          const board = await window.cc.executionBoard.listProject(projectId);
          return Promise.all(board.executions.map(entry => window.cc.executionBoard.snapshot(projectId, entry.executionId, 0)));
        }, ctx.projectId).catch(() => null);
        ctx.diagnostics.push(`restart board snapshots: ${JSON.stringify(views)}`);
      }
      throw jobTeamFailure(ctx, error);
    }
    finally { await teardownJobTeam(ctx); }
  });
}

test('app reboot reconciles in-flight CLAIMED worker without losing run, snapshot or user checkout', async ({ home }) => {
  let app = await launchApp(home, { e2e: true, initialConfig: {
    teamJobLaunchEnabled: true, sponsorPromptDismissed: true, tmuxScope: 'off'
  }, env: { ZCC_EXECUTION_STORE: 'json', ZCC_WORKER_API_ERROR_NUDGE_MS: '60000' } });
  const ctx = createJobTeamContext(app, { tmpPrefix: 'claimed-boot-', root: home, scenario: 'api-error-restart' });
  try {
    const git = initSquadRepo(ctx);
    const linked = join(ctx.projectDir, '.worktrees', 'boot-owner');
    git('worktree', 'add', '-b', 'feature/boot-owner', linked);
    const projectId = await launchSquadFixture(ctx, [{ label: 'boot', input: {
      mode: 'now', title: 'Boot CLAIMED worker', launchOptions: { target: { kind: 'worktree', branch: 'feature/boot-owner' } }
    } }], { plan: [
      '### api-error-unit: Recover <!-- executable-step -->', '- Work: Write api-error.txt.',
      '- Write scope: `api-error.txt`', '- Verification: Read api-error.txt.', ''
    ].join('\n') });
    const receipt = await squadNowReceipt(ctx, 'boot');
    const before = await squadInitial(ctx, 'boot');
    await expect.poll(() => app.window.evaluate(async ({ projectId, executionId }) =>
      (await window.cc.executionBoard.snapshot(projectId, executionId, 0))?.execution.work?.counts.CLAIMED,
    { projectId, executionId: receipt.executionId }), { timeout: 60_000, intervals: [100] }).toBe(1);
    const file = join(home, 'electron-user-data', 'squad-executions.json');
    await expect.poll(() => JSON.parse(readFileSync(file, 'utf8')).records.find((r: { id: string }) => r.id === receipt.executionId)?.workUnits[0].state,
      { timeout: 15_000 }).toBe('CLAIMED');
    // Abrupt death preserves an in-flight claim; graceful quit exercises a different shutdown path.
    const exited = new Promise<void>(resolve => app.electron.process().once('exit', () => resolve()));
    app.electron.process().kill('SIGKILL');
    await Promise.race([exited, new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Electron did not exit after SIGKILL')), 15_000);
      timer.unref();
    })]);
    const saved = JSON.parse(readFileSync(file, 'utf8')).records.find((r: { id: string }) => r.id === receipt.executionId);
    expect(saved).toBeDefined();
    expect(saved.workUnits[0].state).toBe('CLAIMED');
    expect(saved.resolvedLaunch).toEqual(before.resolvedLaunch);
    expect(saved.squadWorktree).toMatchObject({ ownership: 'user', targetKind: 'worktree', path: realpathSync(linked) });
    app = await launchApp(home, { e2e: true, env: { ZCC_EXECUTION_STORE: 'json', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '500' } });
    ctx.app = app;
    ctx.window = app.window;
    await expect.poll(() => app.window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return { state: snap?.execution.state, claimed: snap?.execution.work?.counts.CLAIMED };
    }, { projectId, executionId: receipt.executionId }), { timeout: 60_000 }).toMatchObject({ claimed: 0, state: 'BLOCKED' });
    expect(await app.window.evaluate(async id => (await window.cc.projects.list()).some(project => project.id === id), projectId),
      'original project remains registered after reboot').toBe(true);
    await expect.poll(() => JSON.parse(readFileSync(file, 'utf8')).records.find((r: { id: string }) => r.id === receipt.executionId)?.state,
      { timeout: 15_000 }).toBe('BLOCKED');
    const after = JSON.parse(readFileSync(file, 'utf8')).records.find((r: { id: string }) => r.id === receipt.executionId);
    expect(after.id).toBe(saved.id);
    // Abrupt death reclaims the orphan claim; its sole no-progress slot needs human recovery.
    expect(after.workUnits[0].state).toBe('BLOCKED');
    expect(after.workUnits.filter((unit: { state: string }) => unit.state === 'CLAIMED')).toHaveLength(0);
    expect(after.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'no-progress:1:api-error-unit:1', audience: 'human', resolved: false })
    ]));
    expect(after.resolvedLaunch).toEqual(saved.resolvedLaunch);
    expect(after.squadWorktree).toEqual(saved.squadWorktree);
    expect(existsSync(join(linked, 'api-error.txt'))).toBe(false);
    expect(existsSync(join(ctx.projectDir, 'api-error.txt'))).toBe(false);
    expect(existsSync(linked)).toBe(true);
    expect(git('worktree', 'list', '--porcelain')).toContain(realpathSync(linked));
    // Assert hydration before teardown removes the project (failure screenshots
    // taken afterward otherwise show only the surviving Default Project).
    await expect(app.window.locator('.project-item').filter({ hasText: ctx.projectName }).first()).toBeVisible();
    await app.window.getByTestId('nav-agents').or(app.window.getByTestId('project-nav-agents')).click();
    await app.window.locator('.agent-card').filter({ hasText: 'Boot CLAIMED worker' }).first().click();
    await expect(app.window.getByLabel('Squad details')).toContainText('BLOCKED');
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); await closeApp(app.electron); }
});

test('restart refuses a user worktree branch that moved after the CLAIMED snapshot', async ({ home }) => {
  let app = await launchApp(home, { e2e: true, initialConfig: {
    teamJobLaunchEnabled: true, sponsorPromptDismissed: true, tmuxScope: 'off'
  }, env: { ZCC_EXECUTION_STORE: 'json', ZCC_WORKER_API_ERROR_NUDGE_MS: '60000' } });
  const ctx = createJobTeamContext(app, { tmpPrefix: 'claimed-target-drift-', root: home, scenario: 'api-error-restart' });
  try {
    const git = initSquadRepo(ctx);
    const linked = join(ctx.projectDir, '.worktrees', 'original-target');
    const moved = join(ctx.projectDir, '.worktrees', 'moved-target');
    git('worktree', 'add', '-b', 'feature/target-drift', linked);
    const projectId = await launchSquadFixture(ctx, [{ label: 'drift', input: {
      mode: 'now', title: 'Target drift must not resume', launchOptions: { target: { kind: 'worktree', branch: 'feature/target-drift' } }
    } }], { plan: [
      '### api-error-unit: Recover <!-- executable-step -->', '- Work: Write api-error.txt.',
      '- Write scope: `api-error.txt`', '- Verification: Read api-error.txt.', ''
    ].join('\n') });
    const receipt = await squadNowReceipt(ctx, 'drift');
    await expect.poll(() => app.window.evaluate(async ({ projectId, executionId }) =>
      (await window.cc.executionBoard.snapshot(projectId, executionId, 0))?.execution.work?.counts.CLAIMED,
    { projectId, executionId: receipt.executionId }), { timeout: 60_000, intervals: [100] }).toBe(1);
    const file = join(home, 'electron-user-data', 'squad-executions.json');
    await expect.poll(() => JSON.parse(readFileSync(file, 'utf8')).records.find((r: { id: string }) => r.id === receipt.executionId)?.workUnits[0].state,
      { timeout: 15_000 }).toBe('CLAIMED');
    const exited = new Promise<void>(resolve => app.electron.process().once('exit', () => resolve()));
    app.electron.process().kill('SIGKILL');
    await Promise.race([exited, new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Electron did not exit after SIGKILL')), 15_000);
      timer.unref();
    })]);
    git('worktree', 'remove', '--force', linked);
    git('worktree', 'add', moved, 'feature/target-drift');
    expect(existsSync(linked)).toBe(false);
    expect(existsSync(moved)).toBe(true);
    app = await launchApp(home, { e2e: true, env: { ZCC_EXECUTION_STORE: 'json', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '500' } });
    ctx.app = app;
    ctx.window = app.window;
    await expect.poll(() => app.window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return { state: snap?.execution.state, claimed: snap?.execution.work?.counts.CLAIMED, blockers: snap?.execution.blockers };
    }, { projectId, executionId: receipt.executionId }), { timeout: 60_000 }).toMatchObject({ claimed: 0, state: 'BLOCKED' });
    const restarted = await app.window.evaluate(async ({ projectId, executionId }) =>
      (await window.cc.executionBoard.snapshot(projectId, executionId, 0))?.execution,
    { projectId, executionId: receipt.executionId });
    expect(restarted.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'no-progress:1:api-error-unit:1', resolved: false })
    ]));
    const after = JSON.parse(readFileSync(file, 'utf8')).records.find((r: { id: string }) => r.id === receipt.executionId);
    expect(after.squadWorktree).toMatchObject({ path: receipt.path, branch: 'feature/target-drift', ownership: 'user', targetKind: 'worktree' });
    expect(after.squadWorktree.path).not.toBe(realpathSync(moved));
    expect(existsSync(join(moved, 'api-error.txt'))).toBe(false);
    expect(existsSync(join(ctx.projectDir, 'api-error.txt'))).toBe(false);
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); await closeApp(app.electron); }
});
