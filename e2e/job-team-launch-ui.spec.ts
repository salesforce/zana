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
 *         → Team picklist (aria-label="Team") + Project picklist (aria-label="Project")
 *         → inferred canonical title / Summary optional field
 *         → Launch team (data-testid="team-command-send")
 *     → Agents board shows the titled durable job
 *
 * The orchestrator is a `shell`-based persona so the spawn is lightweight and
 * needs no model. The fixture snapshots/restores ~/.zcc config; we remove the
 * tmp project and stop the launched execution in `finally`.
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { answerJobBlockerThroughUi } from './sdk/job-team-scenario.js';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({ e2e: true, initialConfig: { teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, autoRenameTabs: false } });

test.setTimeout(120_000);

for (const {
  planningLabel,
  coordinationMode
} of [
  { planningLabel: 'Infer plan from goal', coordinationMode: 'freeform' },
  { planningLabel: 'Plan provided in goal', coordinationMode: 'structured' }
] as const) {
test(`launching a ${coordinationMode} Team through the real UI completes durable work`, async ({ app }) => {
  const { window } = app;

  // The orchestrator is a claude-family persona pointed at a fake stub: the job
  // team delivers the goal as an initial task bound at spawn (spawn-arg), which
  // the `shell` adapter cannot do — only claude/codex/cursor/pi/opencode can. The
  // stub emits the working spinner then settles to idle, so the durable job spawns
  // and surfaces on the board with no model call.
  const agent = makeJobTeamCoordinatorBinary();

  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-job-team-ui-proj-'));
  const projectName = basename(projectDir);
  let projectId: string | null = null;

  try {
    // Job Team mode is gated on `teamJobLaunchEnabled` (default true) AND a
    // configured team. Set the flag explicitly and seed an orchestrator-led team.
    await window.evaluate((bin) => window.cc.config.set({
      teamJobLaunchEnabled: true,
      sponsorPromptDismissed: true,
      claudeBinary: bin,
      defaultHarness: 'claude'
    }), agent.path);

    await window.evaluate(() => window.cc.personas.save({
      id: 'e2e-orchestrator',
      name: 'E2E Orchestrator',
      description: 'Claude orchestrator for the job-team launch spec',
      baseProfile: 'claude',
      permissionMode: 'default',
      systemPrompt: ''
    }));
    await window.evaluate(() => window.cc.personas.save({
      id: 'e2e-worker',
      name: 'E2E Worker',
      description: 'Claude worker for the job-team launch spec',
      baseProfile: 'claude',
      permissionMode: 'default',
      systemPrompt: ''
    }));

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
    await modal.locator('.launch-segmented').getByRole('button', { name: 'Team', exact: true }).click();

    // 3. Describe the goal in the real composer editor (TipTap).
    const goal = modal.getByTestId('team-command-input');
    await goal.click();
    await goal.fill('coordinate smoke check and report back');
    await expect(goal).toContainText('coordinate smoke check and report back');

    // 4. Pick the team through the composer's Team picklist.
    const teamPicker = modal.getByLabel('Team', { exact: true });
    await teamPicker.click();
    await window
      .getByRole('listbox', { name: 'Team' })
      .getByRole('option', { name: 'E2E Job Team' })
      .click();
    await expect(teamPicker).toContainText('E2E Job Team');

    // 5. Pick the target project through the composer's Project picklist.
    const projectPicker = modal.getByRole('button', { name: 'Project', exact: true });
    await projectPicker.click();
    await window
      .getByRole('listbox', { name: 'Project' })
      .getByRole('option', { name: projectName, exact: true })
      .click();
    await expect(projectPicker).toContainText(projectName);

    // 6. Leave Title empty so main resolves one canonical title from the goal.
    await modal.getByLabel('Summary Optional').fill('Durable job launch from the Agents board');

    // 7. Launch — this calls the intact `teams.startJob` durable path.
    await modal.getByLabel('Team planning').click();
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

    await answerJobBlockerThroughUi({
      window,
      projectId: projectId!,
      executionId,
      jobTitle: inferredTitle
    });
    await expect.poll(() => existsSync(join(projectDir, 'result.txt')), { timeout: 15_000 }).toBe(true);
    expect(readFileSync(join(projectDir, 'result.txt'), 'utf8')).toContain('LABEL: About Atlas');
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
