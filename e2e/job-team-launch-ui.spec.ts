/**
 * REAL Job Team launch flow — driven through the DOM the way a user drives it.
 *
 * This is the regression net for the "Job Team launch option went missing when
 * the UI was ported to the monorepo layout" bug: the backend `teams.startJob`
 * path survived intact, but the renderer mode button + composer were dropped and
 * no rendering test observed it. This spec clicks the actual `Job Team` mode
 * button, fills an untitled goal / Summary in the real composer, picks a team +
 * project, hits `Launch job team`, and asserts the durable job surfaces on the
 * Agents board.
 *
 *   Agents nav (data-testid="nav-agents")
 *     → "New agent" (data-testid="agents-board-new-thread")
 *     → launcher modal (data-testid="launch-modal")
 *         → Job Team mode button
 *         → goal editor (data-testid="team-command-input")
 *         → Team picklist (aria-label="Team") + location picklist (aria-label="Machine and project")
 *         → inferred canonical title / Summary optional field
 *         → Launch team (data-testid="team-command-send")
 *     → Agents board shows the titled durable job
 *
 * Claude and Codex personas run deterministic fake binaries with no model spend.
 * App configuration is isolated by the Electron fixture; each test removes its
 * temporary project and stops the launched sessions in `finally`.
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { answerJobBlockerThroughUi } from './sdk/job-team-scenario.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import type { Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({
  e2e: true,
  launchEnv: { ANTHROPIC_API_KEY: 'job-team-launch-ui-e2e-key' },
  initialConfig: { teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, autoRenameTabs: false }
});

test.setTimeout(120_000);

for (const profile of ['claude', 'codex'] as const) {
for (const {
  planningLabel,
  coordinationMode
} of [
  // "Plan provided in goal" with prose and no plan steps now parks for Inbox plan
  // correction instead of letting the coordinator derive a DAG; that case is in
  // job-team-plan-correction.spec.ts and a valid provided plan is seeded by the
  // dedicated test below.
  { planningLabel: 'Infer plan from goal', coordinationMode: 'freeform' }
] as const) {
test(`launching a ${coordinationMode} Team with ${profile} through the real UI completes durable work`, async ({ app }) => {
  const { window } = app;

  // The same DAG runs through each provider's native launch and input dialect.
  // The Codex fixture requires exact approval entries and a bracketed assignment
  // followed by Return, with working/idle transitions between assignments.
  const agent = makeJobTeamCoordinatorBinary();

  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-job-team-ui-proj-'));
  const projectName = basename(projectDir);
  let projectId: string | null = null;

  try {
    // Job Team mode is gated on `teamJobLaunchEnabled` (default true) AND a
    // configured team. Set the flag explicitly and seed an orchestrator-led team.
    await window.evaluate(({ bin, profile }) => window.cc.config.set({
      teamJobLaunchEnabled: true,
      sponsorPromptDismissed: true,
      claudeBinary: bin,
      codexBinary: bin,
      trustZccToolsEnabled: false,
      defaultCodexSandbox: 'workspace-write',
      defaultCodexApproval: 'on-request',
      tmuxScope: 'off',
      defaultHarness: profile
    }), { bin: agent.path, profile });

    await window.evaluate((profile) => window.cc.personas.save({
      id: 'e2e-orchestrator',
      name: 'E2E Orchestrator',
      description: 'Orchestrator for the job-team launch spec',
      baseProfile: profile,
      permissionMode: 'default',
      systemPrompt: ''
    }), profile);
    await window.evaluate((profile) => window.cc.personas.save({
      id: 'e2e-worker',
      name: 'E2E Worker',
      description: 'Worker for the job-team launch spec',
      baseProfile: profile,
      permissionMode: 'default',
      systemPrompt: ''
    }), profile);

    await window.evaluate(() => window.cc.teams.save({
      id: 'e2e-job-team',
      name: 'E2E Job Team',
      description: 'Durable job team under test',
      slots: [{ personaId: 'e2e-worker', quantity: 2 }],
      orchestratorPersonaId: 'e2e-orchestrator'
    }));

    projectId = await window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
        id: string;
      };
      return proj.id;
    }, projectDir);
    expect(projectId).toBeTruthy();

    // 1. Agents rail → open the launcher.
    await window.locator('[data-testid="nav-agents"]').click();
    await window.locator('[data-testid="agents-board-new-thread"]').first().click();

    const modal = window.locator('[data-testid="launch-modal"]');
    await expect(modal).toBeVisible();

    // 2. Switch to the unified Team mode.
    await modal.locator('.launch-segmented').getByRole('button', { name: 'Squad', exact: true }).click();

    // 3. Describe the goal in the real composer editor (TipTap).
    const goal = modal.getByTestId('team-command-input');
    await goal.click();
    await goal.fill('coordinate smoke check and report back');
    await expect(goal).toContainText('coordinate smoke check and report back');

    // 4. Pick the team through the composer's Team picklist.
    const teamPicker = modal.getByLabel('Squad', { exact: true });
    await teamPicker.click();
    await window
      .getByRole('listbox', { name: 'Squad' })
      .getByRole('option', { name: 'E2E Job Team' })
      .click();
    await expect(teamPicker).toContainText('E2E Job Team');

    // 5. Pick the target project through the composer's Project picklist.
    const projectPicker = modal.getByRole('button', { name: 'Machine and project', exact: true });
    await projectPicker.click();
    await window
      .getByRole('listbox', { name: 'Machine and project' })
      .getByRole('option', { name: projectName, exact: false })
      .click();
    await expect(projectPicker).toContainText(projectName);

    // 6. Leave Title empty so main resolves one canonical title from the goal.
    await modal.getByLabel('Summary Optional').fill('Durable job launch from the Agents board');

    // 7. Launch — this calls the intact `teams.startJob` durable path.
    await modal.getByLabel('Squad planning').click();
    await window.getByRole('option', { name: planningLabel, exact: true }).click();
    const send = modal.getByTestId('team-command-send');
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await send.click();

    // 8. The launcher closes and the durable job surfaces with a bounded title
    //    inferred once by main. E2E disables the real naming provider, so this
    //    deterministically exercises the path-free objective fallback.
    await expect(modal).toBeHidden();
    const inferredTitle = 'coordinate smoke check and report back';
    await expect(window.locator('.agent-card-title').getByText(inferredTitle, { exact: true }))
      .toBeVisible({ timeout: 15_000 });

    await expect.poll(async () => window.evaluate(async ({ projectId }) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.jobTitle === 'coordinate smoke check and report back')?.executionId ?? '';
    }, { projectId: projectId! }), { timeout: 15_000, intervals: [500] }).not.toBe('');
    const executionId = await window.evaluate(async ({ projectId }) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.jobTitle === 'coordinate smoke check and report back')!.executionId;
    }, { projectId: projectId! });
    await expect.poll(async () => window.evaluate(async ({ projectId, executionId }) => {
      const snapshot = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return {
        coordinationMode: snapshot?.execution.coordinationMode,
        workTotal: snapshot?.execution.work?.total ?? 0
      };
    }, { projectId: projectId!, executionId }), { timeout: 15_000, intervals: [500] }).toEqual({
      coordinationMode,
      workTotal: 4
    });

    await expect.poll(async () => window.evaluate(async ({ projectId, executionId }) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.executionId === executionId)?.currentBlocker?.question ?? '';
    }, { projectId: projectId!, executionId }), { timeout: 15_000, intervals: [500] })
      .toBe('Which label should result.txt use?');
    await window.getByRole('button', { name: 'Flow view' }).click();
    await expect(window.locator('svg.squad-flow-edges path.squad-flow-edge').first())
      .toBeVisible({ timeout: 15_000 });
    await window.getByRole('button', { name: 'Board view' }).click();

    await answerJobBlockerThroughUi({
      window,
      projectId: projectId!,
      executionId,
      jobTitle: inferredTitle
    });
    await expect.poll(() => existsSync(join(projectDir, 'result.txt')), { timeout: 15_000 }).toBe(true);
    expect(readFileSync(join(projectDir, 'result.txt'), 'utf8')).toContain('LABEL: About Atlas');
  } catch (error) {
    const logPath = join(projectDir, '.fake-coordinator.log');
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(-16_384) : 'no fake coordinator log';
    const state = projectId ? await window.evaluate(async id => ({
      sessions: (await window.cc.terminals.list(id)).map(({ id, profile, status, exitCode, headless }) =>
        ({ id, profile, status, exitCode, headless })),
      executions: await window.cc.executionBoard.listProject(id)
    }), projectId).catch(() => null) : null;
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(state)}\n${log}`);
  } finally {
    if (projectId) {
      await window.evaluate(async (pid) => {
        try {
          const sessions = (await window.cc.terminals.list?.(pid)) as
            | Array<{ id: string }>
            | undefined;
          if (Array.isArray(sessions)) {
            for (const s of sessions) {
              try {
                await window.cc.terminals.close(s.id);
              } catch {
                /* best-effort */
              }
            }
          }
        } catch {
          /* best-effort */
        }
        try {
          await window.cc.projects.remove(pid);
        } catch {
          /* best-effort */
        }
      }, projectId);
    }
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    agent.cleanup();
  }
});
}
}

interface GoalLimitScenario {
  projectId: string;
  projectName: string;
  executions(): Promise<Array<{ executionId: string; objectiveLength: number }>>;
  cleanup(): Promise<void>;
}

/** A temporary Project plus an orchestrator-led Team that runs on the fake coordinator binary. */
async function provisionGoalLimitScenario(window: Page): Promise<GoalLimitScenario> {
  const agent = makeJobTeamCoordinatorBinary();
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-job-team-limit-'));
  let projectId: string | null = null;
  // Best-effort on every path: a closed page must not skip the folder and binary cleanup.
  const cleanup = async () => {
    if (projectId) {
      try {
        await window.evaluate(async (pid) => {
          try {
            const sessions = (await window.cc.terminals.list?.(pid)) as Array<{ id: string }> | undefined;
            for (const s of Array.isArray(sessions) ? sessions : []) {
              try { await window.cc.terminals.close(s.id); } catch { /* best-effort */ }
            }
          } catch { /* best-effort */ }
          try { await window.cc.projects.remove(pid); } catch { /* best-effort */ }
        }, projectId);
      } catch { /* best-effort */ }
    }
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    try { agent.cleanup(); } catch { /* best-effort */ }
  };
  try {
    await window.evaluate(({ bin }) => window.cc.config.set({
      teamJobLaunchEnabled: true, sponsorPromptDismissed: true, claudeBinary: bin, codexBinary: bin,
      trustZccToolsEnabled: false, tmuxScope: 'off', defaultHarness: 'claude'
    }), { bin: agent.path });
    for (const [id, name] of [['e2e-orchestrator', 'E2E Orchestrator'], ['e2e-worker', 'E2E Worker']] as const) {
      await window.evaluate(({ id, name }) => window.cc.personas.save({
        id, name, description: 'Persona for the goal-limit spec', baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
      }), { id, name });
    }
    await window.evaluate(() => window.cc.teams.save({
      id: 'e2e-job-team', name: 'E2E Job Team', description: 'Durable job team under test',
      slots: [{ personaId: 'e2e-worker', quantity: 2 }], orchestratorPersonaId: 'e2e-orchestrator'
    }));
    projectId = await window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      return ((res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string }).id;
    }, projectDir);
    expect(projectId).toBeTruthy();
  } catch (error) {
    await cleanup();
    throw error;
  }
  const id = projectId!;
  return {
    projectId: id,
    projectName: basename(projectDir),
    executions: () => window.evaluate(async (pid) => {
      const page = await window.cc.executionBoard.listProject(pid);
      return page.executions.map((execution) => ({ executionId: execution.executionId, objectiveLength: execution.objective?.length ?? 0 }));
    }, id),
    cleanup
  };
}

/**
 * Open the Squad composer with `goal`, the scenario's Team and Project, and "Infer plan
 * from goal". "Plan provided in goal" would park a prose goal for plan correction, so a
 * disabled Launch afterwards can only come from the goal limit.
 */
async function openSquadComposerWithGoal(window: Page, scenario: GoalLimitScenario, goal: string) {
  await window.locator('[data-testid="nav-agents"]').click();
  await window.locator('[data-testid="agents-board-new-thread"]').first().click();
  const modal = window.locator('[data-testid="launch-modal"]');
  await expect(modal).toBeVisible();
  await modal.locator('.launch-segmented').getByRole('button', { name: 'Squad', exact: true }).click();
  const goalField = modal.getByTestId('team-command-input');
  await goalField.click();
  await goalField.fill(goal);
  const teamPicker = modal.getByLabel('Squad', { exact: true });
  await teamPicker.click();
  await window.getByRole('listbox', { name: 'Squad' }).getByRole('option', { name: 'E2E Job Team' }).click();
  await expect(teamPicker).toContainText('E2E Job Team');
  const projectPicker = modal.getByRole('button', { name: 'Machine and project', exact: true });
  await projectPicker.click();
  await window.getByRole('listbox', { name: 'Machine and project' }).getByRole('option', { name: scenario.projectName, exact: false }).click();
  await expect(projectPicker).toContainText(scenario.projectName);
  await modal.getByLabel('Squad planning').click();
  await window.getByRole('option', { name: 'Infer plan from goal', exact: true }).click();
  return { modal, goalField, send: modal.getByTestId('team-command-send') };
}

/**
 * The Squad composer enforces the 2,048-character goal limit before anything is
 * sent: it names the limit, shows the count, disables Launch, ignores the launch
 * shortcut, and launches exactly at the limit (#441).
 */
test('the Squad composer blocks a 2,049-character goal and launches at 2,048', async ({ app }, testInfo) => {
  const { window } = app;
  const scenario = await provisionGoalLimitScenario(window);
  try {
    const { modal, goalField, send } = await openSquadComposerWithGoal(window, scenario, 'x'.repeat(2049));
    await expect(modal.getByTestId('team-goal-limit-message')).toHaveText(
      'The goal is too long for a Squad (2,049 of 2,048 characters). Move details into an attached plan or source.'
    );
    await expect(modal.getByTestId('team-goal-count')).toHaveText('2,049 / 2,048');
    await expect(send).toBeDisabled();

    // The refused shortcut launches nothing and leaves the goal as it was. The
    // editor's hard-break shortcut used to add a hidden line break here, which a
    // later Backspace then removed instead of a character.
    await goalField.press('ControlOrMeta+Enter');
    await expect(modal).toBeVisible();
    await expect(goalField.locator('br')).toHaveCount(0);
    expect(await scenario.executions()).toEqual([]);

    const shot = testInfo.outputPath('goal-limit.png');
    await captureElectronScreenshot(app.electron, window, shot);
    await testInfo.attach('goal-limit', { path: shot, contentType: 'image/png' });

    // Set a goal exactly at the limit through the input pipeline. A scripted
    // Backspace is unreliable here: sent straight after a click, it can reach
    // ProseMirror before the click's selection does and edit nothing.
    await goalField.fill('x'.repeat(2048));
    await expect(modal.getByTestId('team-goal-count')).toHaveText('2,048 / 2,048');
    await expect(modal.getByTestId('team-goal-limit-message')).toHaveCount(0);
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await send.click();

    await expect(modal).toBeHidden();
    await expect.poll(async () => (await scenario.executions()).length, { timeout: 15_000, intervals: [500] }).toBe(1);
    expect((await scenario.executions())[0].objectiveLength).toBe(2048);
  } finally {
    await scenario.cleanup();
  }
});

/**
 * "Plan provided in goal" FAST PATH (ramp a): a structured launch whose goal
 * references a valid portable-executable Markdown plan file must parse + seed the
 * DAG into `execution.start` BEFORE the run reaches RUNNING — so the coordinator
 * hits its "plan already valid → dispatch" branch and never spends a model call
 * deriving the DAG (the stall this feature fixes). The referenced plan carries
 * the SAME four unit ids the fake workers know how to execute, so once seeded the
 * cohort completes the identical durable flow. Proof the seed (not the runtime
 * coordinator) supplied the plan: the fake orchestrator logs `plan present` and
 * NEVER `plan registered`.
 */
for (const profile of ['claude', 'codex'] as const) {
test(`a structured Team seeds a provided portable plan pre-launch with ${profile} and dispatches without a coordinator register`, async ({ app }) => {
  const { window } = app;
  const agent = makeJobTeamCoordinatorBinary();

  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-job-team-plan-'));
  const projectName = basename(projectDir);
  // Portable-executable plan whose step ids match the fake cohort's SUCCESS_PLAN
  // (home / about / navigation-label / assemble), so a seeded DAG runs end-to-end.
  const planPath = join(projectDir, 'plan.md');
  writeFileSync(planPath, [
    '# UI Automation Plan',
    '',
    '### home: Write Home <!-- executable-step -->',
    '- **Work:** Create home.txt containing HOME: ready',
    '- **Depends on:** None',
    '- **Write scope:** `home.txt`',
    '- **Verification:** home.txt present',
    '',
    '### about: Write About <!-- executable-step -->',
    '- **Work:** Create about.txt containing ABOUT: ready',
    '- **Depends on:** None',
    '- **Write scope:** `about.txt`',
    '- **Verification:** about.txt present',
    '',
    '### navigation-label: Ask Navigation Label <!-- executable-step -->',
    '- **Work:** Raise a durable human question with two label choices',
    '- **Depends on:** home, about',
    '- **Mode:** read-only',
    '- **Verification:** durable question answered',
    '',
    '### assemble: Assemble Result <!-- executable-step -->',
    '- **Work:** Write result.txt from both worker outputs and the chosen label',
    '- **Depends on:** navigation-label',
    '- **Write scope:** `result.txt`',
    '- **Verification:** cat result.txt',
    ''
  ].join('\n'));
  let projectId: string | null = null;

  try {
    await window.evaluate(({ bin, profile }) => window.cc.config.set({
      teamJobLaunchEnabled: true,
      sponsorPromptDismissed: true,
      claudeBinary: bin,
      codexBinary: bin,
      trustZccToolsEnabled: false,
      defaultCodexSandbox: 'workspace-write',
      defaultCodexApproval: 'on-request',
      tmuxScope: 'off',
      defaultHarness: profile
    }), { bin: agent.path, profile });

    await window.evaluate((profile) => window.cc.personas.save({
      id: 'e2e-orchestrator',
      name: 'E2E Orchestrator',
      description: 'Orchestrator for the job-team launch spec',
      baseProfile: profile,
      permissionMode: 'default',
      systemPrompt: ''
    }), profile);
    await window.evaluate((profile) => window.cc.personas.save({
      id: 'e2e-worker',
      name: 'E2E Worker',
      description: 'Worker for the job-team launch spec',
      baseProfile: profile,
      permissionMode: 'default',
      systemPrompt: ''
    }), profile);
    await window.evaluate(() => window.cc.teams.save({
      id: 'e2e-job-team',
      name: 'E2E Job Team',
      description: 'Durable job team under test',
      slots: [{ personaId: 'e2e-worker', quantity: 2 }],
      orchestratorPersonaId: 'e2e-orchestrator'
    }));

    projectId = await window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string };
      return proj.id;
    }, projectDir);
    expect(projectId).toBeTruthy();

    await window.locator('[data-testid="nav-agents"]').click();
    await window.locator('[data-testid="agents-board-new-thread"]').first().click();
    const modal = window.locator('[data-testid="launch-modal"]');
    await expect(modal).toBeVisible();
    await modal.locator('.launch-segmented').getByRole('button', { name: 'Squad', exact: true }).click();

    // Goal REFERENCES the plan file — main snapshots it as an execution source and
    // the launch path parses its content into the seeded DAG.
    const goal = modal.getByTestId('team-command-input');
    await goal.click();
    await goal.fill(`implement ${planPath}`);

    const teamPicker = modal.getByLabel('Squad', { exact: true });
    await teamPicker.click();
    await window.getByRole('listbox', { name: 'Squad' }).getByRole('option', { name: 'E2E Job Team' }).click();
    await expect(teamPicker).toContainText('E2E Job Team');

    const projectPicker = modal.getByRole('button', { name: 'Machine and project', exact: true });
    await projectPicker.click();
    await window.getByRole('listbox', { name: 'Machine and project' }).getByRole('option', { name: projectName, exact: false }).click();
    await expect(projectPicker).toContainText(projectName);

    await modal.getByLabel('Squad planning').click();
    await window.getByRole('option', { name: 'Plan provided in goal', exact: true }).click();
    const send = modal.getByTestId('team-command-send');
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await send.click();
    await expect(modal).toBeHidden();

    // The single durable job in this fresh project — look it up by project, not title
    // (a referenced-path goal yields a redacted, non-deterministic inferred title).
    await expect.poll(async () => window.evaluate(async ({ projectId }) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions[0]?.executionId ?? '';
    }, { projectId: projectId! }), { timeout: 15_000, intervals: [500] }).not.toBe('');
    const { executionId, jobTitle } = await window.evaluate(async ({ projectId }) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      const execution = page.executions[0]!;
      return { executionId: execution.executionId, jobTitle: execution.jobTitle };
    }, { projectId: projectId! });

    // Seeded pre-RUNNING: the structured run carries all four units immediately.
    await expect.poll(async () => window.evaluate(async ({ projectId, executionId }) => {
      const snapshot = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return {
        coordinationMode: snapshot?.execution.coordinationMode,
        workTotal: snapshot?.execution.work?.total ?? 0
      };
    }, { projectId: projectId!, executionId }), { timeout: 15_000, intervals: [500] }).toEqual({
      coordinationMode: 'structured',
      workTotal: 4
    });

    await expect.poll(async () => window.evaluate(async ({ projectId, executionId }) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.executionId === executionId)?.currentBlocker?.question ?? '';
    }, { projectId: projectId!, executionId }), { timeout: 15_000, intervals: [500] })
      .toBe('Which label should result.txt use?');

    await answerJobBlockerThroughUi({ window, projectId: projectId!, executionId, jobTitle });
    await expect.poll(() => existsSync(join(projectDir, 'result.txt')), { timeout: 15_000 }).toBe(true);
    expect(readFileSync(join(projectDir, 'result.txt'), 'utf8')).toContain('LABEL: About Atlas');

    // The SEED — not a runtime coordinator register — supplied the DAG. The proof
    // is the pre-RUNNING snapshot above (structured + workTotal:4 the instant the
    // job appeared) plus host-side dispatch driving it to result.txt, all WITHOUT
    // the coordinator on the kickoff critical path. Under host-managed kickoff the
    // coordinator makes ZERO kickoff calls (the host owns the READ and the seeded
    // dispatch), so it is NOT required to run before the seeded DAG completes —
    // asserting it observed the plan would test removed behavior. The load-bearing
    // negative still holds on the shared cohort log: neither host nor a
    // correctly-behaving coordinator registers a plan when one is seeded, so a
    // fallback `execution.plan.register` (logged as 'plan registered') must never
    // appear. Workers never log that token, so this fires only on a real coordinator
    // regression and is immune to the local fake-cohort spawn flake.
    const coordinatorLog = readFileSync(join(projectDir, '.fake-coordinator.log'), 'utf8');
    expect(coordinatorLog).not.toContain('plan registered');
  } finally {
    if (projectId) {
      await window.evaluate(async (pid) => {
        try {
          const sessions = (await window.cc.terminals.list?.(pid)) as Array<{ id: string }> | undefined;
          if (Array.isArray(sessions)) {
            for (const s of sessions) {
              try { await window.cc.terminals.close(s.id); } catch { /* best-effort */ }
            }
          }
        } catch { /* best-effort */ }
        try { await window.cc.projects.remove(pid); } catch { /* best-effort */ }
      }, projectId);
    }
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    agent.cleanup();
  }
});
}
