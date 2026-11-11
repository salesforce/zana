import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import {
  coordinatorResult, createJobTeamContext, findJobExecutionId, initSquadRepo, jobTeamFailure,
  launchSquadFixture, openSquadReview, readCoordinatorLog, squadInitial, squadNowReceipt,
  squadReviewReceipt, squadTerminal, SQUAD_WRITE_PLAN, teardownJobTeam
} from './sdk/job-team-scenario.js';
import type { LaunchOptions } from '@zana-ai/zcc-domain/launch-options';
import { stubRecordedOpenDialog } from './sdk/native-dialog.js';

test.use({ e2e: true, initialConfig: {
  teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, sponsorPromptDismissed: true,
  autoRenameTabs: false, tmuxScope: 'off'
}, launchEnv: { ZCC_EXECUTION_STORE: 'json', E2E_NAMED_CHECK_ENV: 'isolated-check-env' } });
test.setTimeout(240_000);

for (const mode of ['now', 'review'] as const) {
  for (const checkout of ['project-root', 'worktree', 'new-worktree'] as const) {
    test(`${mode}: ${checkout} receipt, composer preview and cohort cwd agree`, async ({ app, home }) => {
      const ctx = createJobTeamContext(app, { tmpPrefix: 'launch-parity-', root: home, scenario: 'unattended' });
      try {
        const git = initSquadRepo(ctx);
        const linked = join(ctx.projectDir, '.worktrees', 'user-owned');
        mkdirSync(join(ctx.projectDir, '.worktrees'), { recursive: true });
        git('worktree', 'add', '-b', 'feature/e2e', linked);
        const launchOptions: LaunchOptions = checkout === 'new-worktree'
          ? { worktree: true, onComplete: 'leave', push: false, checks: [], failurePolicyDefault: 'fail-run' }
          : { target: checkout === 'project-root' ? { kind: 'project-root' } : { kind: 'worktree', branch: 'feature/e2e' }, onComplete: 'leave', push: false, checks: [], failurePolicyDefault: 'fail-run' };
        const resolved = {
          worktree: { value: checkout === 'new-worktree', source: 'launch' },
          onComplete: { value: 'leave', source: 'launch' }, push: { value: false, source: 'launch' },
          checks: { value: [], source: 'launch' }, failurePolicyDefault: { value: 'fail-run', source: 'launch' }
        };
        const title = `${mode} ${checkout} parity`;
        const projectId = await launchSquadFixture(ctx, [{ label: 'parity', input: { title, mode, launchOptions } }], {
          // A user-owned target cannot declare destructive plan cleanup, even behind a launch override.
          plan: `## Launch\n- onComplete: ${checkout === 'new-worktree' ? 'delete' : 'leave'}\n- push: true\n\n${SQUAD_WRITE_PLAN}`,
          teamExtra: { worktreeIsolation: true, worktreeOnComplete: 'merge' }
        });
        let executionId: string;
        if (mode === 'review') {
          const receipt = await squadReviewReceipt(ctx, 'parity');
          expect(receipt.proposalId).toBeTruthy();
          expect(receipt.inboxEntryId).toBeTruthy();
          const detail = await openSquadReview(ctx, title);
          await expect(detail).toContainText('onComplete: leave (launch)');
          await expect(detail).toContainText('push: false (launch)');
          await expect(detail).toContainText('checks: none (launch)');
          await expect(detail).toContainText('failurePolicyDefault: fail-run (launch)');
          await expect(detail).toContainText(checkout === 'new-worktree' ? 'New worktree from main' : checkout === 'worktree' ? 'feature/e2e' : 'main');
          if (checkout !== 'new-worktree') await expect(detail).toContainText(realpathSync(checkout === 'worktree' ? linked : ctx.projectDir));
          else await expect(detail).toContainText('path assigned at launch');
           await ctx.window.getByRole('button', { name: 'Review Squad launch' }).click();
           const modal = ctx.window.getByTestId('launch-modal');
           await expect(modal).toContainText('Keep checkout and branch (This launch)');
           await expect(modal).toContainText('Blocked (This launch)');
           await expect(modal).toContainText('No checks (This launch)');
           await expect(modal).toContainText('Fail run (This launch)');
           await expect(modal).toContainText(checkout === 'new-worktree' ? 'New worktree' : checkout === 'worktree' ? 'feature/e2e' : 'main');
          await modal.getByTestId('team-command-send').click();
          await expect(modal).toBeHidden();
          executionId = await findJobExecutionId(ctx.window, projectId, title);
        } else {
          const receipt = await squadNowReceipt(ctx, 'parity');
          expect(receipt).toMatchObject({ location: { kind: checkout, projectId }, branch: checkout === 'worktree' ? 'feature/e2e' : checkout === 'project-root' ? 'main' : expect.stringMatching(/^zcc\//) });
          expect(receipt.path).toBeTruthy();
          const initial = await squadInitial(ctx, 'parity');
          expect(initial.resolvedLaunch).toEqual(resolved);
          executionId = receipt.executionId;
        }
        let cohortCwd = '';
        const roles = new Set<string>();
        await expect.poll(async () => {
          const sessions = await ctx.window.evaluate(async ({ projectId, executionId }) =>
            (await window.cc.terminals.list(projectId)).filter(s => s.cohort?.executionId === executionId)
              .map(s => ({ cwd: s.cwd, role: s.cohort!.role })), { projectId, executionId });
          for (const session of sessions) {
            roles.add(session.role);
            cohortCwd ||= session.cwd;
            expect(realpathSync(session.cwd)).toBe(realpathSync(cohortCwd));
          }
          return [...roles].sort();
        }, { timeout: 30_000, intervals: [100] }).toEqual(['orchestrator', 'worker']);
        const expected = checkout === 'project-root' ? ctx.projectDir : checkout === 'worktree' ? linked : cohortCwd;
        expect(realpathSync(cohortCwd)).toBe(realpathSync(expected));
        if (checkout === 'new-worktree') expect(realpathSync(cohortCwd)).not.toBe(realpathSync(ctx.projectDir));
        await expect.poll(() => existsSync(join(expected, 'output.txt')), { timeout: 60_000 }).toBe(true);
        const boots = readFileSync(join(expected, '.fake-coordinator.log'), 'utf8');
        expect(boots).toMatch(/ORCH:\d+ boot/);
        expect(boots).toMatch(/WORK:\d+ boot/);
        expect(boots).toContain(`cwd=${realpathSync(expected)}`);
        expect(boots).toContain(`home=${home}`);
        await expect.poll(() => ctx.window.evaluate(async ({ projectId, executionId }) =>
          (await window.cc.executionBoard.snapshot(projectId, executionId, 0))?.execution.state,
        { projectId, executionId }), { timeout: 60_000 }).toBe('COMPLETED');
        expect(existsSync(linked), 'user-owned worktree must survive completion').toBe(true);
        expect(git('branch', '--show-current')).toBe('main');
      } catch (error) { throw jobTeamFailure(ctx, error); }
      finally { await teardownJobTeam(ctx); }
    });
  }
}

test('composer attached plan survives repeated previews and launch', async ({ app, home }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'composer-direct-', root: home, scenario: 'unattended' });
  try {
    initSquadRepo(ctx);
    await launchSquadFixture(ctx, [], { teamExtra: { worktreeOnComplete: 'merge' } });
    const owner = ctx.window.getByRole('dialog', { name: /^Agent / }).first();
    await owner.getByRole('button', { name: 'Close' }).click();
    await ctx.window.getByTestId('nav-agents').or(ctx.window.getByTestId('project-nav-agents')).click();
    await ctx.window.getByTestId('agents-board-new-thread').first().click();
    const modal = ctx.window.getByTestId('launch-modal');
    await modal.locator('.launch-segmented').getByRole('button', { name: 'Squad', exact: true }).click();
    await modal.getByLabel('Squad', { exact: true }).click();
    await ctx.window.getByRole('listbox', { name: 'Squad' }).getByRole('option', { name: 'E2E Job Team' }).click();
    await modal.getByRole('button', { name: 'Machine and project', exact: true }).click();
    await ctx.window.getByRole('listbox', { name: 'Machine and project' }).getByRole('option', { name: ctx.projectName }).click();
    await modal.getByLabel('Squad planning').click();
    await ctx.window.getByRole('option', { name: 'Plan provided in goal', exact: true }).click();
    const planPath = join(ctx.projectDir, 'attached-plan.md');
    writeFileSync(planPath, `## Launch\n- worktree: true\n- onComplete: leave\n- push: false\n\n${SQUAD_WRITE_PLAN}`);
    await stubRecordedOpenDialog(app.electron, [[planPath]]);
    await modal.getByTestId('team-command-input').fill('Follow attached plan');
    await modal.getByRole('button', { name: 'Attach sources' }).click();
    await expect(modal.getByLabel('Attached sources')).toContainText('attached-plan.md');
    const customize = modal.getByRole('button', { name: /^Customize launch/ });
    const review = modal.getByRole('button', { name: 'Review settings', exact: true });
    const createPlugin = modal.getByTestId('composer-create-plugin');
    await expect(createPlugin).toBeVisible();
    const [customizeBox, reviewBox, createPluginBox] = await Promise.all([
      customize.boundingBox(), review.boundingBox(), createPlugin.boundingBox()
    ]);
    expect(customizeBox).not.toBeNull();
    expect(reviewBox).not.toBeNull();
    expect(createPluginBox).not.toBeNull();
    expect(Math.abs(customizeBox!.height - createPluginBox!.height)).toBeLessThan(0.1);
    expect(Math.abs(reviewBox!.height - createPluginBox!.height)).toBeLessThan(0.1);

    await review.click();
    const reviewed = modal.getByLabel('Reviewed launch settings');
    await expect(reviewed).toContainText('Create new worktree (Plan)');
    await expect(reviewed).toContainText('Keep checkout and branch (Plan)');
    await expect(reviewed).toContainText('Blocked (Plan)');
    await expect(review).toHaveAttribute('aria-expanded', 'true');
    await expect(customize).toHaveAttribute('aria-expanded', 'false');
    const [reviewedBox, reviewButtonBox] = await Promise.all([reviewed.boundingBox(), review.boundingBox()]);
    expect(reviewedBox).not.toBeNull();
    expect(reviewButtonBox).not.toBeNull();
    expect(reviewedBox!.y).toBeGreaterThan(reviewButtonBox!.y);

    await customize.click();
    await expect(reviewed).toBeHidden();
    await expect(customize).toHaveAttribute('aria-expanded', 'true');
    await expect(review).toHaveAttribute('aria-expanded', 'false');
    await modal.getByLabel('On complete', { exact: true }).selectOption('delete');
    await modal.getByLabel('Push', { exact: true }).selectOption('true');
    await review.click();
    await expect(reviewed).toContainText('Delete checkout and branch (This launch)');
    await expect(reviewed).toContainText('Allowed (This launch)');
    await modal.getByTestId('team-command-send').click();
    await expect(modal).toBeHidden();
    await expect.poll(() => ctx.window.evaluate(async id => (await window.cc.executionBoard.listProject(id)).executions[0]?.state, ctx.projectId!), { timeout: 60_000 }).toBe('COMPLETED');
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});

test('invalid, wrong-repository and conflicting targets reject before cohort spawn; project Review floor holds', async ({ app, home }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'target-reject-', root: home });
  try {
    const git = initSquadRepo(ctx);
    const foreign = join(home, 'foreign-repository');
    mkdirSync(foreign);
    execFileSync('git', ['init', '-b', 'foreign'], { cwd: foreign, env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    git('branch', 'unopened');
    const entries = [
      { label: 'invalid', launchOptions: { target: { kind: 'worktree', branch: '../bad' } } },
      { label: 'wrong-repo', launchOptions: { target: { kind: 'worktree', branch: 'foreign' } } },
      { label: 'unopened', launchOptions: { target: { kind: 'worktree', branch: 'unopened' } } },
      { label: 'conflict', launchOptions: { target: { kind: 'project-root' }, worktree: true } },
      { label: 'delete-user', launchOptions: { target: { kind: 'project-root' }, onComplete: 'delete' } },
      { label: 'unknown-check', launchOptions: { checks: ['unregistered_e2e_check'] } }
    ];
    const projectId = await launchSquadFixture(ctx, [
      ...entries.map(entry => ({ label: entry.label, waitFor: '.e2e-go', input: { mode: 'now', launchOptions: entry.launchOptions } })),
      { label: 'review-policy', waitFor: '.e2e-policy', input: { mode: 'now', launchOptions: { target: { kind: 'project-root' } } } }
    ]);
    writeFileSync(join(ctx.projectDir, '.e2e-go'), 'go');
    await expect.poll(() => coordinatorResult(ctx, 'propose[unknown-check]'), { timeout: 60_000 }).not.toBeNull();
    for (const entry of entries) expect(coordinatorResult(ctx, `propose[${entry.label}]`), readCoordinatorLog(ctx)).toMatchObject({ ok: false, error: expect.any(String) });
    expect(coordinatorResult(ctx, 'propose[invalid]')?.error).toMatch(/invalid|target/i);
    expect(coordinatorResult(ctx, 'propose[wrong-repo]')?.error).toMatch(/target|worktree|branch/i);
    expect(coordinatorResult(ctx, 'propose[unopened]')?.error).toMatch(/target|worktree|branch/i);
    expect(coordinatorResult(ctx, 'propose[conflict]')?.error).toMatch(/conflict|invalid/i);
    expect(coordinatorResult(ctx, 'propose[delete-user]')?.error).toMatch(/user-owned|onComplete|invalid/i);
    expect(coordinatorResult(ctx, 'propose[unknown-check]')?.error).toMatch(/unknown.*check|check.*unknown|unregistered_e2e_check/i);
    await ctx.window.evaluate(id => window.cc.projectSettings.set(id, { launchApproval: 'review' }), projectId);
    writeFileSync(join(ctx.projectDir, '.e2e-policy'), 'go');
    await expect.poll(() => coordinatorResult(ctx, 'propose[review-policy]'), { timeout: 60_000 }).not.toBeNull();
    expect(coordinatorResult(ctx, 'propose[review-policy]')?.error).toContain('LAUNCH_REVIEW_REQUIRED');
    expect((await ctx.window.evaluate(id => window.cc.executionBoard.listProject(id), projectId)).executions).toEqual([]);
    expect(await ctx.window.evaluate(async id => (await window.cc.terminals.list(id)).filter(s => s.cohort), projectId)).toEqual([]);
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});

test('review revalidates branch checkout and rejects changed target without fallback', async ({ app, home }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'review-revalidate-', root: home });
  try {
    const git = initSquadRepo(ctx);
    const linked = join(ctx.projectDir, '.worktrees', 'review-owned');
    git('worktree', 'add', '-b', 'feature/review-owned', linked);
    const projectId = await launchSquadFixture(ctx, [{ label: 'stale', input: {
      mode: 'review', title: 'Stale review target', launchOptions: { target: { kind: 'worktree', branch: 'feature/review-owned' } }
    } }]);
    const receipt = await squadReviewReceipt(ctx, 'stale');
    expect(receipt.proposalId).toBeTruthy();
    const detail = await openSquadReview(ctx, 'Stale review target');
    await expect(detail).toContainText('feature/review-owned (user-owned)');
    await expect(detail).toContainText(realpathSync(linked));
    await ctx.window.getByRole('button', { name: 'Review Squad launch' }).click();
    const modal = ctx.window.getByTestId('launch-modal');
    await expect(modal).toBeVisible();
    git('-C', linked, 'switch', '-c', 'feature/changed-after-review');
    // Main revalidates the reviewed target at admission and must reject this stale branch.
    const preview = modal.getByLabel('Effective launch settings');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Launch preview could not validate the plan, sources, or target. Retry after correcting them.');
    await expect(modal.getByTestId('team-command-send')).toBeDisabled();
    expect((await ctx.window.evaluate(id => window.cc.executionBoard.listProject(id), projectId)).executions).toEqual([]);
    expect(await ctx.window.evaluate(async id => (await window.cc.terminals.list(id)).filter(s => s.cohort), projectId)).toEqual([]);
    expect(existsSync(linked)).toBe(true);
    expect(existsSync(join(linked, 'output.txt'))).toBe(false);
    expect(existsSync(join(ctx.projectDir, 'output.txt'))).toBe(false);
    expect(git('branch', '--show-current')).toBe('main');
    expect(git('-C', linked, 'branch', '--show-current')).toBe('feature/changed-after-review');
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});

for (const outcome of ['passed', 'failed', 'timeout', 'output-limit', 'missing-executable'] as const) {
  test(`named check through owner Settings IPC and squad_launch: ${outcome}, capture cleanup`, async ({ home }) => {
    test.skip(process.platform === 'win32', 'Named check execution requires POSIX process groups and file limits');
    const captureRoot = join(home, 'check-captures');
    mkdirSync(captureRoot);
    const app = await launchApp(home, { e2e: true, initialConfig: {
      teamJobLaunchEnabled: true, sponsorPromptDismissed: true, tmuxScope: 'off'
    }, env: { TMPDIR: captureRoot, ZCC_EXECUTION_STORE: 'json', E2E_NAMED_CHECK_ENV: 'isolated-check-env' } });
    const ctx = createJobTeamContext(app, { tmpPrefix: 'named-check-', root: home, scenario: 'unattended' });
    try {
      initSquadRepo(ctx);
      const bin = join(home, 'check-bin');
      mkdirSync(bin);
      const executable = join(bin, 'fixture-check');
      // Absolute shebang avoids invoking Electron-as-Node; command resolution still goes through PATH.
      writeFileSync(executable, `#!${process.execPath}\n${String.raw`
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const fd = fs.fstatSync(1);
const capture = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('named-check-')).map(n => path.join(os.tmpdir(), n)).find(d => {
  try { const s = fs.statSync(path.join(d, 'output')); return s.ino === fd.ino && s.dev === fd.dev; } catch { return false; }
});
const output = 'X'.repeat(12000) + '\nCHECK-END-12000\n';
fs.writeSync(1, output);
const bytes = Buffer.alloc(output.length);
fs.readSync(1, bytes, 0, bytes.length, 0);
fs.writeFileSync('.e2e-check.json', JSON.stringify({ cwd: process.cwd(), home: process.env.HOME, env: process.env.E2E_NAMED_CHECK_ENV, executable: fs.realpathSync(process.argv[1]), mode: fd.mode & 511, capture, bytes: fs.fstatSync(1).size, tail: bytes.toString().slice(-17), pid: process.pid, captured: bytes.toString() === output }));
const outcome = process.argv[2];
if (outcome === 'timeout') setInterval(() => {}, 1000);
else if (outcome === 'output-limit') { for (;;) fs.writeSync(1, 'X'.repeat(16384)); }
else process.exit(outcome === 'failed' ? 7 : 0);
`}`);
      chmodSync(executable, 0o700);
      const projectId = await launchSquadFixture(ctx, [{ label: 'check', waitFor: '.e2e-go', input: { mode: 'now', title: `Named ${outcome}`, launchOptions: { worktree: true, checks: ['verify'] } } }]);
      const command = outcome === 'missing-executable' ? 'e2e_no_such_executable_8729' : `PATH='${bin}':"$PATH" fixture-check ${outcome}`;
      await ctx.window.evaluate(async ({ projectId, command }) => {
        await window.cc.namedChecks.set({ kind: 'global' }, [{ name: 'verify', command: 'exit 99' }]);
        await window.cc.namedChecks.set({ kind: 'project', projectId }, [{ name: 'verify', command }]);
      }, { projectId, command });
      expect(await ctx.window.evaluate(id => window.cc.namedChecks.get({ kind: 'project', projectId: id }), projectId)).toEqual([{ name: 'verify', command }]);
      writeFileSync(join(ctx.projectDir, '.e2e-go'), 'go');
      const receipt = await squadNowReceipt(ctx, 'check');
      expect(receipt.path).toBeTruthy();
      const terminal = await squadTerminal(ctx, 'check');
      expect(terminal.state).toBe(outcome === 'passed' ? 'COMPLETED' : 'FAILED');
      expect(terminal.workUnits![0].state).toBe(outcome === 'passed' ? 'COMPLETED' : 'FAILED');
      if (outcome !== 'passed') {
        const records = JSON.parse(readFileSync(join(home, 'electron-user-data', 'squad-executions.json'), 'utf8')).records;
        const persisted = records.find((r: { id: string }) => r.id === receipt.executionId);
        expect(persisted.workUnits[0].structuredResult).toMatchObject({ reference: 'check:verify', result: {
          name: 'verify', untrusted: true,
          status: outcome === 'missing-executable' ? 'failed' : outcome,
          ...(outcome === 'output-limit' ? {} : { exitCode: outcome === 'failed' ? 7 : outcome === 'missing-executable' ? 127 : null })
        } });
        if (outcome === 'failed') {
          const output = persisted.workUnits[0].structuredResult.result.output as string;
          expect(Buffer.byteLength(output), 'runner receipt must survive the Electron/engine boundary beyond 8192 bytes').toBeGreaterThan(8192);
          expect(output).toContain('CHECK-END-12000');
        }
      }
      if (outcome !== 'missing-executable') {
        const proof = JSON.parse(readFileSync(join(receipt.path!, '.e2e-check.json'), 'utf8'));
        expect(proof).toMatchObject({ cwd: realpathSync(receipt.path!), home, env: 'isolated-check-env', executable: realpathSync(executable), mode: 0o600, captured: true });
        expect(proof.tail).toMatch(/CHECK-END-12000\n$/);
        expect(proof.bytes).toBeGreaterThan(8192);
        expect(proof.capture).toBeTruthy();
        await expect.poll(() => existsSync(proof.capture), { timeout: 15_000 }).toBe(false);
        await expect.poll(() => { try { process.kill(proof.pid, 0); return true; } catch { return false; } }, { timeout: 15_000 }).toBe(false);
      }
      await expect.poll(() => readdirSync(captureRoot).filter(name => name.startsWith('named-check-')), { timeout: 15_000 }).toEqual([]);
      await openSquadBoard(ctx, `Named ${outcome}`);
      await expect(ctx.window.getByLabel('Squad details')).toContainText(outcome === 'passed' ? 'COMPLETED' : 'FAILED');
    } catch (error) { throw jobTeamFailure(ctx, error); }
    finally { await teardownJobTeam(ctx); await closeApp(app.electron); }
  });
}

async function openSquadBoard(ctx: ReturnType<typeof createJobTeamContext>, title: string) {
  const owner = ctx.window.getByRole('dialog', { name: /^Agent / }).first();
  if (await owner.count()) await owner.getByRole('button', { name: 'Close' }).click();
  await ctx.window.getByTestId('nav-agents').or(ctx.window.getByTestId('project-nav-agents')).click();
  await ctx.window.locator('.agent-card').filter({ hasText: title }).first().click();
}
