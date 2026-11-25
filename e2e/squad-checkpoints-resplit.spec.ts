/**
 * Squad unit checkpoints (AC5) and scope re-split (AC6) through the built app. Zero model spend: the fake
 * coordinator/worker binary writes through the real PostToolUse hook commands main injects into the worker's
 * --settings (so main attributes each path to the claim), and the Squad launcher is the owner that answers.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import {
  coordinatorResult, createJobTeamContext, initSquadRepo, jobTeamFailure, launchSquadFixture, readCoordinatorLog,
  squadNowReceipt, squadTerminal, teardownJobTeam, type JobTeamContext
} from './sdk/job-team-scenario.js';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true, tmuxScope: 'off' },
  launchEnv: { ZCC_WORK_CLAIM_LEASE_MS: '60000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '60000' }
});
test.setTimeout(240_000);

let callSeq = 0;
async function ownerCall(ctx: JobTeamContext, tool: string, input: Record<string, unknown>) {
  const label = `${tool}#${++callSeq}`;
  writeFileSync(join(ctx.projectDir, '.e2e-owner-call.json'), JSON.stringify({ label, tool, input }));
  await expect.poll(() => coordinatorResult(ctx, `owner-call[${label}]`), { timeout: 30_000, intervals: [250] }).not.toBeNull();
  return coordinatorResult<Record<string, unknown>>(ctx, `owner-call[${label}]`)!;
}

test('failed unit is restored from the git baseline; pre-dirty paths and the sibling unit are untouched', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'unit-checkpoints-', scenario: 'success' });
  try {
    const git = initSquadRepo(ctx);
    writeFileSync(join(ctx.projectDir, 'tracked.txt'), 'tracked original\n');
    writeFileSync(join(ctx.projectDir, 'predirty.txt'), 'base\n');
    git('add', 'tracked.txt', 'predirty.txt');
    git('commit', '-m', 'Add tracked files');
    // The user's own uncommitted edit, present before the Squad starts: it must never be attributed to or restored for a unit.
    writeFileSync(join(ctx.projectDir, 'predirty.txt'), 'user edit\n');
    const gitState = () => ({ commits: git('rev-list', '--all', '--count'), stash: git('stash', 'list'), branches: git('branch', '--list', '--all') });
    const before = gitState();

    await launchSquadFixture(ctx, [{ label: 'ckpt', input: { mode: 'now', title: 'Checkpoint run', launchOptions: { target: { kind: 'project-root' } } } }], { workerQuantity: 2, plan: [
      '# Checkpoint plan',
      '### ckpt-fail: Failing unit <!-- executable-step -->', '- Work: Edit tracked.txt, create owned.txt, touch predirty.txt, then fail.',
      '- Write scope: `tracked.txt`, `owned.txt`, `predirty.txt`', '- Verification: Failure is recorded.', '',
      '### ckpt-pass: Passing sibling <!-- executable-step -->', '- Work: Create sibling.txt.',
      '- Write scope: `sibling.txt`', '- Verification: Read sibling.txt.', ''
    ].join('\n') });
    const receipt = await squadNowReceipt(ctx, 'ckpt');
    expect(receipt.path && join(receipt.path)).toBeTruthy();
    const terminal = await squadTerminal(ctx, 'ckpt');
    expect(readCoordinatorLog(ctx)).toContain('ckpt hooks PostToolUse=true');
    const failed = terminal.workUnits!.find(u => u.id === 'ckpt-fail')!;
    const passed = terminal.workUnits!.find(u => u.id === 'ckpt-pass')!;
    expect(failed.state).toBe('FAILED');
    expect(passed.state).toBe('COMPLETED');

    // Restored from git HEAD, created file deleted, the user's pre-dirty file and the sibling's work left alone.
    await expect.poll(() => readFileSync(join(ctx.projectDir, 'tracked.txt'), 'utf8'), { timeout: 30_000 }).toBe('tracked original\n');
    await expect.poll(() => existsSync(join(ctx.projectDir, 'owned.txt')), { timeout: 30_000 }).toBe(false);
    expect(readFileSync(join(ctx.projectDir, 'predirty.txt'), 'utf8')).toBe('worker overwrote predirty\n');
    expect(readFileSync(join(ctx.projectDir, 'sibling.txt'), 'utf8')).toBe('sibling done\n');

    // The failed unit's checkpoint lists what was restored, deleted and left; the passing unit saved evidence only.
    const checkpointOf = async (unitId: string) => {
      let checkpoint: Record<string, unknown> | undefined;
      await expect.poll(async () => {
        const status = await ownerCall(ctx, 'execution.status', { executionId: receipt.executionId, mode: 'full' });
        const units = ((status as { value?: { workUnits?: { id: string; checkpoint?: Record<string, unknown> }[] } }).value)?.workUnits;
        checkpoint = units?.find(u => u.id === unitId)?.checkpoint;
        return checkpoint?.state;
      }, { timeout: 30_000 }).toBeTruthy();
      return checkpoint!;
    };
    const failedCheckpoint = await checkpointOf('ckpt-fail');
    expect(failedCheckpoint).toMatchObject({ state: 'partial', restored: ['tracked.txt'], deleted: ['owned.txt'], preDirty: ['predirty.txt'] });
    expect((await checkpointOf('ckpt-pass')).state).toBe('saved');

    // No commit, stash or branch is ever created by checkpointing.
    expect(gitState()).toEqual(before);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: ctx.projectDir, encoding: 'utf8' })).toContain('predirty.txt');
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});

test('owner answer naming an out-of-scope file asks to confirm for a contract-only answer, then splits into a child unit', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'scope-resplit-', scenario: 'success' });
  try {
    await launchSquadFixture(ctx, [{ label: 'split', input: { mode: 'now', title: 'Scope split run' } }], { workerQuantity: 2, plan: [
      '# Scope split plan',
      '### scope-parent: Parent unit <!-- executable-step -->', '- Work: Write parent.txt after the owner answers the question.',
      '- Write scope: `parent.txt`', '- Verification: Read parent.txt.', ''
    ].join('\n') });
    const receipt = await squadNowReceipt(ctx, 'split');
    const executionId = receipt.executionId;
    const view = () => ctx.window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return { blockers: (snap?.execution.blockers ?? []).map(b => ({ id: b.id, resolved: b.resolved })), units: (snap?.execution.work?.assignments ?? []).map(u => ({ id: u.workUnitId, state: u.state })) };
    }, { projectId: ctx.projectId!, executionId });
    await expect.poll(async () => (await view()).blockers.some(b => b.id === 'blk-scope-parent' && !b.resolved), { timeout: 60_000, intervals: [250] }).toBe(true);

    // A contract-only answer cannot be decided mechanically: nothing is sent and no unit is created.
    const confirm = await ownerCall(ctx, 'execution.respond', { executionId, blockerId: 'blk-scope-parent', message: 'Please also rework the API schema for this change.' });
    expect(confirm.ok).toBe(false);
    expect(confirm.error).toMatch(/Scope check for unit scope-parent.*Nothing was sent/s);
    expect((await view()).units.map(u => u.id)).toEqual(['scope-parent']);
    expect((await view()).blockers.find(b => b.id === 'blk-scope-parent')?.resolved).toBe(false);

    // Naming a file outside the parent's scope splits the added scope into a child unit, routed to the other worker.
    const split = await ownerCall(ctx, 'execution.respond', { executionId, blockerId: 'blk-scope-parent', message: 'Also update server/contract.ts to match the new schema.' });
    expect(split.ok, JSON.stringify(split)).toBe(true);
    expect(split.value).toMatchObject({ splitChildId: 'scope-parent-split-1' });

    const terminal = await squadTerminal(ctx, 'split');
    expect(terminal.state).toBe('COMPLETED');
    const parent = terminal.workUnits!.find(u => u.id === 'scope-parent')!;
    const child = terminal.workUnits!.find(u => u.id === 'scope-parent-split-1')!;
    expect(parent).toMatchObject({ state: 'COMPLETED', files: ['parent.txt'] });
    expect(child).toMatchObject({ state: 'COMPLETED', files: ['server/contract.ts'] });
    expect(readFileSync(join(receipt.path!, 'server', 'contract.ts'), 'utf8')).toContain('contract');
    expect(readFileSync(join(receipt.path!, 'parent.txt'), 'utf8')).toBe('parent done\n');
    // The parent's worker was told the file now belongs to the child.
    expect(readCoordinatorLog(ctx)).toContain('[Zana scope split] server/contract.ts now belong to unit scope-parent-split-1');
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});
