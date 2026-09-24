import { expect, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { type AppHandle } from '../fixtures/app.js';
import { makeJobTeamCoordinatorBinary, type FakeAgentBinary, type JobTeamScenario } from './harness.js';

/**
 * Shared setup/launch/teardown for the deterministic Job Team CLI-owner E2E specs
 * (churn / streaming / stalled / activity / wedge). Every one of them stands up the
 * same fake-coordinator binary, personas + team, harness re-verify, project, and CLI
 * Agent launch, then differs only in its assertions. The helpers below capture that
 * verbatim common workflow so each spec keeps ONLY its unique gate. Behavior is
 * byte-identical to the previously-inlined copies — do not change the drive sequence.
 */
export interface JobTeamContext {
  app: AppHandle;
  window: Page;
  agent: FakeAgentBinary;
  projectDir: string;
  projectName: string;
  /** `<projectDir>/.fake-coordinator.log` — the fake cohort's per-process progress log. */
  logPath: string;
  /** Renderer console + main stderr lines, attached at construction; dumped on failure. */
  diagnostics: string[];
  /** Set by {@link launchJobTeamCliOwner} once the project is registered. */
  projectId: string | null;
}

/**
 * Build a Job Team E2E context: create the fake coordinator binary, a throwaway
 * project dir, and wire renderer/main diagnostics capture. Call {@link launchJobTeamCliOwner}
 * next, and {@link teardownJobTeam} in the spec's `finally`.
 */
export function createJobTeamContext(app: AppHandle, opts: { tmpPrefix: string; scenario?: JobTeamScenario }): JobTeamContext {
  const { window } = app;
  const diagnostics: string[] = [];
  window.on('console', (message) => diagnostics.push(`[renderer:${message.type()}] ${message.text()}`));
  app.electron.process()?.stderr?.on('data', (chunk) => diagnostics.push(`[main] ${String(chunk)}`));
  const agent = makeJobTeamCoordinatorBinary(opts.scenario ? { scenario: opts.scenario } : {});
  const projectDir = mkdtempSync(join(tmpdir(), opts.tmpPrefix));
  const projectName = basename(projectDir);
  return {
    app,
    window,
    agent,
    projectDir,
    projectName,
    logPath: join(projectDir, '.fake-coordinator.log'),
    diagnostics,
    projectId: null
  };
}

/**
 * Drive the shared CLI-owner launch: point the Claude binary at the fake coordinator,
 * save the orchestrator + worker personas and a `workerQuantity`-slot team, refresh the
 * cached harness verification, register the project, and launch the CLI Agent through
 * the UI. Sets `ctx.projectId` and returns it. Throws (with diagnostics) if the launch
 * never surfaces a session.
 */
export async function launchJobTeamCliOwner(ctx: JobTeamContext, opts: { workerQuantity: number }): Promise<string> {
  const { window, agent, projectDir, projectName, diagnostics } = ctx;

  await window.evaluate((bin) => window.cc.config.set({
    teamJobLaunchEnabled: true,
    sponsorPromptDismissed: true,
    claudeBinary: bin,
    defaultHarness: 'claude'
  }), agent.path);
  await window.evaluate(() => window.cc.personas.save({
    id: 'e2e-orchestrator', name: 'E2E Orchestrator', description: 'Durable test coordinator',
    baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
  }));
  await window.evaluate(() => window.cc.personas.save({
    id: 'e2e-worker', name: 'E2E Worker', description: 'Durable test worker',
    baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
  }));
  await window.evaluate((quantity) => window.cc.teams.save({
    id: 'e2e-job-team', name: 'E2E Job Team', description: 'CLI owner durable team',
    slots: [{ personaId: 'e2e-worker', quantity }], orchestratorPersonaId: 'e2e-orchestrator'
  }), opts.workerQuantity);

  // Refresh cached harness verification after replacing the Claude binary.
  await window.getByRole('link', { name: 'Settings' }).click();
  await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
  const claudeSettings = window.locator('#settings-anchor-harness-claude');
  await expect(claudeSettings.locator('.opener-row-status')).toHaveClass(/opener-row-status--ok/);
  await window.locator('.settings-app-back').click();

  const projectId = await window.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message ?? 'projects.add failed');
    return result.value.id;
  }, projectDir);
  ctx.projectId = projectId;

  const projectRow = window.locator('.project-item').filter({ hasText: projectName }).first();
  await expect(projectRow).toBeVisible({ timeout: 15_000 });
  await projectRow.hover();
  await window.getByRole('button', { name: `New agent in ${projectName}` }).click();
  const modal = window.getByTestId('launch-modal');
  await modal.getByRole('button', { name: 'CLI Agent' }).click();
  const instruction = modal.getByTestId('legacy-agent-command-input');
  await instruction.click();
  await instruction.fill('E2E start Job Team');
  await expect(instruction).toContainText('E2E start Job Team');
  await expect(modal.getByRole('button', { name: 'Project', exact: true })).toContainText(projectName);
  const send = modal.getByTestId('legacy-agent-command-send');
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();
  const launched = await expect.poll(async () => window.evaluate(async (projectId) =>
    (await window.cc.terminals.list(projectId)).some((session) => session.title.includes('E2E start Job Team'))
  , projectId), { timeout: 15_000, intervals: [500] }).toBe(true).then(() => true, () => false);
  if (!launched) throw new Error(`CLI Agent did not launch\n${diagnostics.join('\n')}`);
  await expect(modal).toBeHidden();
  return projectId;
}

/** Poll the board for the durable execution named `jobTitle` and return its id. */
export async function findJobExecutionId(window: Page, projectId: string, jobTitle: string): Promise<string> {
  await expect.poll(async () => window.evaluate(async ({ projectId, jobTitle }) => {
    const page = await window.cc.executionBoard.listProject(projectId);
    return page.executions.find((execution) => execution.jobTitle === jobTitle)?.executionId ?? '';
  }, { projectId, jobTitle }), { timeout: 30_000, intervals: [500] }).not.toBe('');
  return window.evaluate(async ({ projectId, jobTitle }) => {
    const page = await window.cc.executionBoard.listProject(projectId);
    return page.executions.find((execution) => execution.jobTitle === jobTitle)!.executionId;
  }, { projectId, jobTitle });
}

/** Read the fake coordinator's log (or a placeholder if it never wrote). */
export function readCoordinatorLog(ctx: JobTeamContext): string {
  return existsSync(ctx.logPath) ? readFileSync(ctx.logPath, 'utf8') : 'no fake coordinator log';
}

/** Wrap a spec failure with the coordinator log + captured diagnostics (the common outer catch). */
export function jobTeamFailure(ctx: JobTeamContext, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${message}\n${readCoordinatorLog(ctx)}\n${ctx.diagnostics.join('\n')}`);
}

/** Best-effort teardown: close the project's terminals, remove the project, drop temp dirs. */
export async function teardownJobTeam(ctx: JobTeamContext): Promise<void> {
  if (ctx.projectId) {
    await ctx.window.evaluate(async (projectId) => {
      for (const session of await window.cc.terminals.list(projectId)) {
        try { await window.cc.terminals.close(session.id); } catch { /* best-effort */ }
      }
      try { await window.cc.projects.remove(projectId); } catch { /* best-effort */ }
    }, ctx.projectId).catch(() => undefined);
  }
  rmSync(ctx.projectDir, { recursive: true, force: true });
  ctx.agent.cleanup();
}

export interface JobBlockerView {
  id: string;
  question: string;
  options?: string[];
}

interface ExecutionView {
  state: string;
  currentBlocker?: JobBlockerView | null;
}

async function readExecution(window: Page, projectId: string, executionId: string): Promise<ExecutionView | null> {
  return window.evaluate(async ({ projectId, executionId }) => {
    const snapshot = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
    if (!snapshot) return null;
    return {
      state: snapshot.execution.state,
      currentBlocker: snapshot.execution.currentBlocker
        ? {
            id: snapshot.execution.currentBlocker.id,
            question: snapshot.execution.currentBlocker.question,
            options: snapshot.execution.currentBlocker.options
          }
        : null
    };
  }, { projectId, executionId });
}

export async function answerJobBlockerThroughUi(args: {
  window: Page;
  projectId: string;
  executionId: string;
  jobTitle: string;
  answer?: string;
}): Promise<void> {
  const { window, projectId, executionId, jobTitle } = args;
  const answer = args.answer ?? 'About Atlas';

  await expect.poll(async () => {
    const execution = await readExecution(window, projectId, executionId);
    if (execution && ['FAILED', 'STOPPED'].includes(execution.state)) {
      throw new Error(`execution ${execution.state} before blocker appeared`);
    }
    return execution?.currentBlocker?.question ?? '';
  }, { timeout: 60_000, intervals: [1_000] }).toContain('label');

  // A CLI Agent owner launch opens the owner's foreground terminal modal
  // (launcher → navigate to the session route → AgentTerminalModal). It
  // legitimately lingers over the board until the exited owner's tombstone
  // clears (~60s), and its `.modal-backdrop` intercepts pointer events, so
  // dismiss it before driving the board. Escape is deliberately NOT a close
  // here (it reaches the embedded terminal as an interrupt) — use the X. The
  // UI / Modern owner paths never open this modal, so this is a no-op there.
  const ownerModal = window.getByRole('dialog', { name: /^Agent / }).first();
  if (await ownerModal.count()) {
    await ownerModal.getByRole('button', { name: 'Close' }).click();
    await expect(ownerModal).toBeHidden();
  }

  const agentsNav = window.getByTestId('nav-agents').or(window.getByTestId('project-nav-agents'));
  await agentsNav.click();
  const card = window.locator('.agent-card').filter({ hasText: jobTitle }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click();

  const details = window.getByLabel('Squad details');
  await expect(details).toBeVisible();
  await expect(details.getByText('Current blocker', { exact: true })).toBeVisible();
  await expect(details.getByText('Which label should result.txt use?', { exact: true })).toBeVisible();
  await expect(details.getByText('About · About Atlas', { exact: true })).toBeVisible();

  await window.getByTestId('nav-inbox').or(window.getByTestId('project-nav-inbox')).click();
  const pinned = window.locator('.inbox-questions-pinned');
  await expect(pinned.getByText('Needs your answer', { exact: true })).toBeVisible({ timeout: 15_000 });
  await pinned.getByText(jobTitle, { exact: true }).click();

  const question = window.locator('.inbox-question');
  await expect(question).toContainText('Which label should result.txt use?');
  await question.getByRole('radio', { name: new RegExp(answer, 'i') }).click();
  await question.getByRole('button', { name: /^(Continue|Reopen & answer)$/ }).click();

  await expect.poll(async () => (await readExecution(window, projectId, executionId))?.state ?? 'missing', {
    timeout: 60_000,
    intervals: [1_000]
  }).toBe('COMPLETED');

  await window.getByTestId('nav-agents').or(window.getByTestId('project-nav-agents')).click();
  await window.locator('.agent-card').filter({ hasText: jobTitle }).first().click();
  const completed = window.getByLabel('Squad details');
  await expect(completed.getByText(/COMPLETED · attempt/)).toBeVisible({ timeout: 15_000 });
  await expect(completed.getByText('4/4 complete', { exact: false })).toBeVisible();
}
