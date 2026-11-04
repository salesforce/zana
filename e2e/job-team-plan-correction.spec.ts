/**
 * Squad "plan correction" flow through the real UI and the built Electron app.
 *
 * A Squad launched with "Plan provided in goal" whose plan fails DAG validation
 * parks (no work is registered or dispatched) and raises an Inbox card
 * "Plan correction required". Request changes wakes the coordinator with the
 * rejection + source plan + the corrected-plan path; once the coordinator writes
 * a valid plan there and goes idle, a second card offers Approve / Request
 * changes / Cancel. If the coordinator ends its turns without writing the file,
 * a "stalled" card appears instead.
 *
 * The coordinator is the deterministic fake from `makeJobTeamCoordinatorBinary`
 * (`plan-correction` / `plan-correction-silent`); no model is called.
 *
 * "Plan provided in goal" with prose that contains no plan steps at all takes the
 * same parked path (never a silent coordinator repair).
 *
 * Not covered here on purpose: "a valid provided plan bypasses correction" is
 * already asserted by job-team-launch-ui.spec.ts (provided portable plan seeds
 * four units and completes with no correction card).
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';

test.use({ e2e: true, initialConfig: { teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, autoRenameTabs: false } });
test.setTimeout(150_000);

// Mutating step with NO Write scope: parses, but fails DAG validation.
const DEFECTIVE_PLAN = [
  '# Defective Plan',
  '',
  '### write: Write output <!-- executable-step -->',
  '- Mode: Mutating',
  '- Work: Create output.',
  '- Verification: Read output.',
  ''
].join('\n');

interface Setup {
  projectId: string;
  projectDir: string;
  projectName: string;
  agent: ReturnType<typeof makeJobTeamCoordinatorBinary>;
}

async function setup(window: Page, scenario: 'plan-correction' | 'plan-correction-silent'): Promise<Setup> {
  const agent = makeJobTeamCoordinatorBinary({ scenario });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-plan-correction-'));
  writeFileSync(join(projectDir, 'plan.md'), DEFECTIVE_PLAN);
  await window.evaluate((bin) => window.cc.config.set({
    teamJobLaunchEnabled: true,
    sponsorPromptDismissed: true,
    claudeBinary: bin,
    defaultHarness: 'claude',
    trustZccToolsEnabled: false,
    tmuxScope: 'off'
  }), agent.path);
  await window.evaluate(() => window.cc.personas.save({
    id: 'e2e-orchestrator', name: 'E2E Orchestrator', description: 'Plan correction coordinator',
    baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
  }));
  await window.evaluate(() => window.cc.personas.save({
    id: 'e2e-worker', name: 'E2E Worker', description: 'Plan correction worker',
    baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
  }));
  await window.evaluate(() => window.cc.teams.save({
    id: 'e2e-job-team', name: 'E2E Job Team', description: 'Plan correction team',
    slots: [{ personaId: 'e2e-worker', quantity: 2 }], orchestratorPersonaId: 'e2e-orchestrator'
  }));
  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    return ((res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string }).id;
  }, projectDir);
  expect(projectId).toBeTruthy();
  return { projectId, projectDir, projectName: basename(projectDir), agent };
}

/** `goal` defaults to a path to the defective plan file; pass prose to exercise the no-plan-steps case. */
async function launchProvidedPlan(window: Page, s: Setup, goal = `implement ${join(s.projectDir, 'plan.md')}`): Promise<string> {
  await window.getByTestId('nav-agents').click();
  await window.getByTestId('agents-board-new-thread').first().click();
  const modal = window.getByTestId('launch-modal');
  await expect(modal).toBeVisible();
  await modal.locator('.launch-segmented').getByRole('button', { name: 'Squad', exact: true }).click();
  const goalInput = modal.getByTestId('team-command-input');
  await goalInput.click();
  await goalInput.fill(goal);
  const teamPicker = modal.getByLabel('Squad', { exact: true });
  await teamPicker.click();
  await window.getByRole('listbox', { name: 'Squad' }).getByRole('option', { name: 'E2E Job Team' }).click();
  const projectPicker = modal.getByRole('button', { name: 'Machine and project', exact: true });
  await projectPicker.click();
  await window.getByRole('listbox', { name: 'Machine and project' }).getByRole('option', { name: s.projectName, exact: false }).click();
  await modal.getByLabel('Squad planning').click();
  await window.getByRole('option', { name: 'Plan provided in goal', exact: true }).click();
  const send = modal.getByTestId('team-command-send');
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();
  await expect(modal).toBeHidden();

  await expect.poll(async () => window.evaluate(async (id) =>
    (await window.cc.executionBoard.listProject(id)).executions[0]?.executionId ?? '', s.projectId),
  { timeout: 15_000, intervals: [500] }).not.toBe('');
  return window.evaluate(async (id) => (await window.cc.executionBoard.listProject(id)).executions[0]!.executionId, s.projectId);
}

async function readExecution(window: Page, projectId: string, executionId: string) {
  return window.evaluate(async (input) => {
    const snapshot = await window.cc.executionBoard.snapshot(input.projectId, input.executionId, 0);
    if (!snapshot) return null;
    const execution = snapshot.execution as { state: string; timeoutReason?: string; work?: { total?: number } };
    return { state: execution.state, timeoutReason: execution.timeoutReason, workTotal: execution.work?.total ?? 0 };
  }, { projectId, executionId });
}

/** Open the (single) "Plan correction required" Inbox card whose body contains `text`. */
async function openCorrectionCard(window: Page, text: string): Promise<void> {
  await window.getByTestId('nav-inbox').or(window.getByTestId('project-nav-inbox')).click();
  await expect.poll(async () => {
    const rows = window.locator('.inbox-row').filter({ hasText: 'Plan correction required' });
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await rows.nth(i).click();
      if (await window.locator('.inbox-question').filter({ hasText: text }).count()) return true;
    }
    return false;
  }, { timeout: 30_000, intervals: [1_000], message: `Inbox card containing "${text}"` }).toBe(true);
}

async function choose(window: Page, option: string): Promise<void> {
  await window.getByRole('radio', { name: new RegExp(`${option}$`, 'i') }).click();
  await window.getByRole('button', { name: /^(Continue|Reopen & answer)$/ }).click();
}

function coordinatorLog(projectDir: string): string {
  const logPath = join(projectDir, '.fake-coordinator.log');
  return existsSync(logPath) ? readFileSync(logPath, 'utf8') : 'no fake coordinator log';
}

async function teardown(window: Page, s: Setup | null): Promise<void> {
  if (!s) return;
  await window.evaluate(async (pid) => {
    try {
      for (const session of await window.cc.terminals.list(pid)) {
        try { await window.cc.terminals.close(session.id); } catch { /* best-effort */ }
      }
    } catch { /* best-effort */ }
    try { await window.cc.projects.remove(pid); } catch { /* best-effort */ }
  }, s.projectId).catch(() => undefined);
  rmSync(s.projectDir, { recursive: true, force: true });
  s.agent.cleanup();
}

test('defective provided plan parks, is corrected by the coordinator, approved, and completes', async ({ app }) => {
  const { window } = app;
  let s: Setup | null = null;
  try {
    s = await setup(window, 'plan-correction');
    const executionId = await launchProvidedPlan(window, s);

    // Card 1: parked, nothing registered or dispatched.
    await openCorrectionCard(window, 'Plan requires revisions to proceed');
    expect(await readExecution(window, s.projectId, executionId)).toMatchObject({ workTotal: 0 });
    expect(coordinatorLog(s.projectDir)).not.toContain('assigned');

    await choose(window, 'Request changes');

    // The coordinator is woken with the corrected-plan path and writes a valid plan.
    const correctedRel = `.zana/execution-plan-corrected-${executionId}.md`;
    await expect.poll(() => coordinatorLog(s!.projectDir), { timeout: 30_000, intervals: [500] })
      .toContain(`plan-correction wrote corrected plan ${correctedRel}`);

    // Card 2: reviewable corrected plan with Approve.
    await openCorrectionCard(window, 'Review the proposed corrected plan');
    expect(await readExecution(window, s.projectId, executionId)).toMatchObject({ workTotal: 0 });
    await choose(window, 'Approve');

    await expect.poll(async () => (await readExecution(window, s!.projectId, executionId))?.state, {
      timeout: 60_000, intervals: [1_000]
    }).toBe('COMPLETED');
    expect(await readExecution(window, s.projectId, executionId)).toMatchObject({ workTotal: 1 });
    expect(readFileSync(join(s.projectDir, 'output.txt'), 'utf8')).toContain('output ready');
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${s ? coordinatorLog(s.projectDir) : ''}`);
  } finally {
    await teardown(window, s);
  }
});

test('coordinator that never writes the corrected plan stalls, and Cancel stops the run', async ({ app }) => {
  const { window } = app;
  let s: Setup | null = null;
  try {
    s = await setup(window, 'plan-correction-silent');
    const executionId = await launchProvidedPlan(window, s);

    await openCorrectionCard(window, 'Plan requires revisions to proceed');
    await choose(window, 'Request changes');

    // Two idle edges with no artifact -> stalled card.
    await openCorrectionCard(window, 'finished its turn without writing a corrected plan');
    expect(existsSync(join(s.projectDir, '.zana', `execution-plan-corrected-${executionId}.md`))).toBe(false);
    expect(coordinatorLog(s.projectDir)).toContain('plan-correction wake received');
    await choose(window, 'Cancel');

    await expect.poll(() => readExecution(window, s!.projectId, executionId), { timeout: 60_000, intervals: [1_000] })
      .toMatchObject({ state: 'STOPPED', timeoutReason: 'plan-correction-cancelled' });
    expect(coordinatorLog(s.projectDir)).not.toContain('assigned');
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${s ? coordinatorLog(s.projectDir) : ''}`);
  } finally {
    await teardown(window, s);
  }
});

test('provided goal that is prose with no plan steps parks for correction, is corrected, approved, and completes', async ({ app }) => {
  const { window } = app;
  let s: Setup | null = null;
  try {
    s = await setup(window, 'plan-correction');
    const executionId = await launchProvidedPlan(window, s, 'Write the output file for this project.');

    // Parked: no coordinator-driven repair, nothing registered or dispatched.
    await openCorrectionCard(window, 'Plan requires revisions to proceed');
    expect(await readExecution(window, s.projectId, executionId)).toMatchObject({ workTotal: 0 });
    expect(coordinatorLog(s.projectDir)).not.toContain('assigned');
    expect(coordinatorLog(s.projectDir)).not.toContain('wrote corrected plan');

    await choose(window, 'Request changes');
    await openCorrectionCard(window, 'Review the proposed corrected plan');
    expect(await readExecution(window, s.projectId, executionId)).toMatchObject({ workTotal: 0 });
    await choose(window, 'Approve');

    await expect.poll(async () => (await readExecution(window, s!.projectId, executionId))?.state, {
      timeout: 60_000, intervals: [1_000]
    }).toBe('COMPLETED');
    expect(readFileSync(join(s.projectDir, 'output.txt'), 'utf8')).toContain('output ready');
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${s ? coordinatorLog(s.projectDir) : ''}`);
  } finally {
    await teardown(window, s);
  }
});
