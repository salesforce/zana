/**
 * Goal variant of the Squad "plan correction" flow.
 *
 * A Squad goal (assignment team, planSource 'provided', no success criteria,
 * created through the same IPC as GoalsPanel) whose statement is a defective
 * plan parks its Squad when activated and raises the Inbox correction card.
 * Request changes -> the fake coordinator writes a corrected plan -> Approve
 * resumes the SAME execution to COMPLETED and rewrites the goal statement to
 * the corrected plan. Editing the goal statement during review makes Approve
 * fail with the "goal plan was edited" cause and leaves the statement alone.
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';

test.use({ e2e: true, initialConfig: { teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, autoRenameTabs: false } });
test.setTimeout(240_000);

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
  agent: ReturnType<typeof makeJobTeamCoordinatorBinary>;
}

async function setup(window: Page): Promise<Setup> {
  const agent = makeJobTeamCoordinatorBinary({ scenario: 'plan-correction' });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-plan-correction-goal-'));
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
  return { projectId, projectDir, agent };
}

/** Create the Squad goal exactly as GoalsPanel does; returns the goal id. */
async function createGoal(window: Page, s: Setup): Promise<string> {
  const created = await window.evaluate((input) => window.cc.goals.create({
    projectId: input.projectId, scope: { projectId: input.projectId }, title: 'Goal correction squad',
    statement: input.statement, successCriteria: [], assignment: { kind: 'team', teamId: 'e2e-job-team' },
    planSource: 'provided', maxIterations: 3, noProgressLimit: 2
  }), { projectId: s.projectId, statement: DEFECTIVE_PLAN });
  expect(created, JSON.stringify(created)).toMatchObject({ ok: true });
  return (created as { value: { id: string } }).value.id;
}

function goalStatement(s: Setup, goalId: string): string {
  const file = join(s.projectDir, '.zcc', 'goals', `${goalId}.json`);
  return (JSON.parse(readFileSync(file, 'utf8')) as { statement?: string }).statement ?? '';
}

async function executionIds(window: Page, projectId: string): Promise<string[]> {
  return window.evaluate(async (id) => (await window.cc.executionBoard.listProject(id)).executions.map((e) => e.executionId), projectId);
}

async function readExecution(window: Page, projectId: string, executionId: string) {
  return window.evaluate(async (input) => {
    const snapshot = await window.cc.executionBoard.snapshot(input.projectId, input.executionId, 0);
    if (!snapshot) return null;
    const execution = snapshot.execution as { state: string; work?: { total?: number } };
    return { state: execution.state, workTotal: execution.work?.total ?? 0 };
  }, { projectId, executionId });
}

/** Open the "Plan correction required" Inbox card whose body contains `text`. */
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

async function teardown(window: Page, s: Setup | null, goalId: string | null): Promise<void> {
  if (!s) return;
  await window.evaluate(async (input) => {
    if (input.goalId) { try { await window.cc.goals.setStatus(input.goalId, 'paused'); } catch { /* best-effort */ } }
    try {
      for (const session of await window.cc.terminals.list(input.pid)) {
        try { await window.cc.terminals.close(session.id); } catch { /* best-effort */ }
      }
    } catch { /* best-effort */ }
    try { await window.cc.projects.remove(input.pid); } catch { /* best-effort */ }
  }, { pid: s.projectId, goalId }).catch(() => undefined);
  rmSync(s.projectDir, { recursive: true, force: true });
  s.agent.cleanup();
}

/** Activate the goal; its first iteration launches the parked Squad. */
async function activate(window: Page, s: Setup, goalId: string): Promise<string> {
  const before = new Set(await executionIds(window, s.projectId));
  const res = await window.evaluate((id) => window.cc.goals.setStatus(id, 'active'), goalId);
  expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
  let fresh = '';
  await expect.poll(async () => {
    fresh = (await executionIds(window, s.projectId)).find((id) => !before.has(id)) ?? '';
    return fresh;
  }, { timeout: 60_000, intervals: [500], message: 'new execution after goal activation' }).not.toBe('');
  return fresh;
}

async function requestCorrection(window: Page, s: Setup, executionId: string): Promise<void> {
  await openCorrectionCard(window, 'No valid revised plan is ready to review');
  expect(await readExecution(window, s.projectId, executionId)).toMatchObject({ workTotal: 0 });
  expect(coordinatorLog(s.projectDir)).not.toContain('assigned');
  await choose(window, 'Request changes');
  const correctedRel = `.zana/execution-plan-corrected-${executionId}.md`;
  await expect.poll(() => coordinatorLog(s.projectDir), { timeout: 30_000, intervals: [500] })
    .toContain(`plan-correction wrote corrected plan ${correctedRel}`);
  await openCorrectionCard(window, 'Review the proposed corrected plan');
}

test('goal Squad defective plan parks, is corrected, approved, resumes, and the goal statement is rewritten', async ({ app }) => {
  const { window } = app;
  let s: Setup | null = null;
  let goalId: string | null = null;
  try {
    s = await setup(window);
    goalId = await createGoal(window, s);
    // goals.create trims the statement.
    expect(goalStatement(s, goalId)).toBe(DEFECTIVE_PLAN.trim());
    const executionId = await activate(window, s, goalId);

    await requestCorrection(window, s, executionId);
    expect(await readExecution(window, s.projectId, executionId)).toMatchObject({ workTotal: 0 });
    await choose(window, 'Approve');

    await expect.poll(async () => (await readExecution(window, s!.projectId, executionId))?.state, {
      timeout: 60_000, intervals: [1_000]
    }).toBe('COMPLETED');
    expect(await readExecution(window, s.projectId, executionId)).toMatchObject({ workTotal: 1 });
    expect(readFileSync(join(s.projectDir, 'output.txt'), 'utf8')).toContain('output ready');

    // The goal's statement is now the corrected plan (with realistic trailing periods).
    await expect.poll(() => goalStatement(s!, goalId!), { timeout: 15_000, intervals: [500] }).not.toBe(DEFECTIVE_PLAN.trim());
    expect(goalStatement(s, goalId)).toContain('### write: Write output <!-- executable-step -->');
    expect(goalStatement(s, goalId)).toContain('Write scope: `output.txt`.');
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${s ? coordinatorLog(s.projectDir) : ''}`);
  } finally {
    await teardown(window, s, goalId);
  }
});

test('editing the goal plan during review makes Approve fail with the "goal plan was edited" cause', async ({ app }) => {
  const { window } = app;
  let s: Setup | null = null;
  let goalId: string | null = null;
  try {
    s = await setup(window);
    goalId = await createGoal(window, s);
    const executionId = await activate(window, s, goalId);
    await requestCorrection(window, s, executionId);

    const edited = `${DEFECTIVE_PLAN}\n<!-- edited during review -->`;
    const res = await window.evaluate((input) => window.cc.goals.update(input.id, { statement: input.statement }), { id: goalId, statement: edited });
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
    await choose(window, 'Approve');

    await expect(window.getByText(/goal plan was edited/i).first()).toBeVisible({ timeout: 30_000 });
    expect(goalStatement(s, goalId)).toBe(edited);
    expect(await readExecution(window, s.projectId, executionId)).toMatchObject({ workTotal: 0 });
    expect(coordinatorLog(s.projectDir)).not.toContain('assigned');
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${s ? coordinatorLog(s.projectDir) : ''}`);
  } finally {
    await teardown(window, s, goalId);
  }
});
