/**
 * Scheduled variant of the Squad "plan correction" flow (manual test MT-6).
 *
 * A project schedule (kind=team, planning "Plan provided in goal") whose saved
 * prompt is a defective plan parks its Squad on "Run now" and raises the
 * Inbox correction card. Request changes -> the fake coordinator writes a
 * corrected plan -> Approve resumes the SAME execution to COMPLETED, and the
 * schedule's stored prompt becomes the corrected plan, so a second "Run now"
 * launches with no correction card. With a silent coordinator, Cancel stops the
 * run (plan-correction-cancelled) and the stored prompt is unchanged.
 * Reuses the fake coordinator scenarios from job-team-plan-correction.spec.ts.
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
  projectName: string;
  scheduleId: string;
  agent: ReturnType<typeof makeJobTeamCoordinatorBinary>;
}

async function setup(window: Page, scenario: 'plan-correction' | 'plan-correction-silent'): Promise<Setup> {
  const agent = makeJobTeamCoordinatorBinary({ scenario });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-plan-correction-'));
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
  const created = await window.evaluate((input) => window.cc.scheduler.create({
    projectId: input.projectId, scope: { projectId: input.projectId }, name: 'Scheduled correction squad',
    every: '1d', profile: 'claude', kind: 'team', teamId: 'e2e-job-team', planSource: 'provided',
    prompt: input.prompt, enabled: false, inboxLevel: 'silent'
  }), { projectId, prompt: DEFECTIVE_PLAN });
  expect(created).toMatchObject({ ok: true });
  const scheduleId = (created as { value: { id: string } }).value.id;
  return { projectId, projectDir, projectName: basename(projectDir), scheduleId, agent };
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


function storedPrompt(s: Setup): string {
  const file = join(s.projectDir, '.zcc', 'schedules', `${s.scheduleId}.json`);
  return (JSON.parse(readFileSync(file, 'utf8')) as { prompt?: string }).prompt ?? '';
}

async function executionIds(window: Page, projectId: string): Promise<string[]> {
  return window.evaluate(async (id) => (await window.cc.executionBoard.listProject(id)).executions.map((e) => e.executionId), projectId);
}

/** Click "Run now" on the schedule's detail page and return the new execution id. */
async function runNow(window: Page, s: Setup): Promise<string> {
  const before = new Set(await executionIds(window, s.projectId));
  await window.evaluate((id) => { history.pushState({}, '', `/schedules/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, s.scheduleId);
  const panel = window.getByTestId('schedule-info-panel');
  await expect(panel).toBeVisible();
  const button = panel.getByRole('button', { name: 'Run now', exact: true });
  await expect(button).toBeEnabled({ timeout: 15_000 });
  await button.click();
  let fresh = '';
  await expect.poll(async () => {
    fresh = (await executionIds(window, s.projectId)).find((id) => !before.has(id)) ?? '';
    return fresh;
  }, { timeout: 30_000, intervals: [500], message: 'new execution after Run now' }).not.toBe('');
  return fresh;
}

test('scheduled defective plan parks, is corrected, approved, completes, and the schedule prompt is rewritten', async ({ app }) => {
  const { window } = app;
  let s: Setup | null = null;
  try {
    s = await setup(window, 'plan-correction');
    expect(storedPrompt(s)).toBe(DEFECTIVE_PLAN);
    const executionId = await runNow(window, s);

    await openCorrectionCard(window, 'No valid revised plan is ready to review');
    expect(await readExecution(window, s.projectId, executionId)).toMatchObject({ workTotal: 0 });
    expect(coordinatorLog(s.projectDir)).not.toContain('assigned');
    await choose(window, 'Request changes');

    const correctedRel = `.zana/execution-plan-corrected-${executionId}.md`;
    await expect.poll(() => coordinatorLog(s!.projectDir), { timeout: 30_000, intervals: [500] })
      .toContain(`plan-correction wrote corrected plan ${correctedRel}`);

    await openCorrectionCard(window, 'Review the proposed corrected plan');
    expect(await readExecution(window, s.projectId, executionId)).toMatchObject({ workTotal: 0 });
    await choose(window, 'Approve');

    await expect.poll(async () => (await readExecution(window, s!.projectId, executionId))?.state, {
      timeout: 60_000, intervals: [1_000]
    }).toBe('COMPLETED');
    expect(await readExecution(window, s.projectId, executionId)).toMatchObject({ workTotal: 1 });
    // Same execution resumed; no second one was created by the approval.
    expect(await executionIds(window, s.projectId)).toEqual([executionId]);
    expect(readFileSync(join(s.projectDir, 'output.txt'), 'utf8')).toContain('output ready');

    // The schedule's stored prompt is now the corrected plan.
    await expect.poll(() => storedPrompt(s!), { timeout: 15_000, intervals: [500] }).not.toBe(DEFECTIVE_PLAN);
    expect(storedPrompt(s)).toContain('### write: Write output <!-- executable-step -->');
    expect(storedPrompt(s)).toContain('Write scope: `output.txt`.');

    // Second Run now: valid plan, no correction card, completes.
    const second = await runNow(window, s);
    expect(second).not.toBe(executionId);
    await expect.poll(async () => (await readExecution(window, s!.projectId, second))?.state, {
      timeout: 90_000, intervals: [1_000]
    }).toBe('COMPLETED');
    expect(await readExecution(window, s.projectId, second)).toMatchObject({ workTotal: 1 });
    await window.getByTestId('nav-inbox').or(window.getByTestId('project-nav-inbox')).click();
    await expect(window.locator('.inbox-question').filter({ hasText: 'No valid revised plan is ready to review' })).toHaveCount(0);
    expect(coordinatorLog(s.projectDir).match(/plan-correction wrote corrected plan/g)?.length).toBe(1);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${s ? coordinatorLog(s.projectDir) : ''}`);
  } finally {
    await teardown(window, s);
  }
});

test('scheduled run with a silent coordinator stalls, Cancel stops it, and the schedule prompt is unchanged', async ({ app }) => {
  const { window } = app;
  let s: Setup | null = null;
  try {
    s = await setup(window, 'plan-correction-silent');
    const executionId = await runNow(window, s);

    await openCorrectionCard(window, 'No valid revised plan is ready to review');
    await choose(window, 'Request changes');
    await openCorrectionCard(window, 'finished its turn without writing a corrected plan');
    expect(existsSync(join(s.projectDir, '.zana', `execution-plan-corrected-${executionId}.md`))).toBe(false);
    await choose(window, 'Cancel');

    await expect.poll(() => readExecution(window, s!.projectId, executionId), { timeout: 60_000, intervals: [1_000] })
      .toMatchObject({ state: 'STOPPED', timeoutReason: 'plan-correction-cancelled' });
    expect(coordinatorLog(s.projectDir)).not.toContain('assigned');
    expect(storedPrompt(s)).toBe(DEFECTIVE_PLAN);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${s ? coordinatorLog(s.projectDir) : ''}`);
  } finally {
    await teardown(window, s);
  }
});
