/**
 * Squad seat that starts on demand (#580), fail-closed (owner decision): a Squad launch through the real UI is
 * pre-authorized, so a Team with a `startOnDemand` worker row is refused with a plain message and nothing is
 * spawned. Follows job-team-launch-ui.spec.ts (same launcher flow, same fake binary).
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({
  e2e: true,
  launchEnv: { ANTHROPIC_API_KEY: 'on-demand-seat-e2e-key' },
  initialConfig: { teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, autoRenameTabs: false }
});

test.setTimeout(120_000);

test('a pre-authorized Squad launch with a start-on-demand seat is refused before anything is spawned', async ({ app }) => {
  const { window } = app;
  const agent = makeJobTeamCoordinatorBinary();
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-on-demand-seat-proj-'));
  const projectName = basename(projectDir);
  let projectId: string | null = null;
  try {
    await window.evaluate(({ bin }) => window.cc.config.set({
      teamJobLaunchEnabled: true, sponsorPromptDismissed: true, claudeBinary: bin, codexBinary: bin,
      trustZccToolsEnabled: false, tmuxScope: 'off', defaultHarness: 'claude'
    }), { bin: agent.path });
    for (const [id, name] of [['e2e-orchestrator', 'E2E Orchestrator'], ['e2e-worker', 'E2E Worker']]) {
      await window.evaluate(({ id, name }) => window.cc.personas.save({
        id, name, description: 'On-demand seat spec', baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
      }), { id, name });
    }
    await window.evaluate(() => window.cc.teams.save({
      id: 'e2e-on-demand-team', name: 'E2E On Demand Team', description: 'Worker starts when needed',
      slots: [{ personaId: 'e2e-worker', quantity: 2, startOnDemand: true }],
      orchestratorPersonaId: 'e2e-orchestrator'
    }));
    projectId = await window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      return ((res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string }).id;
    }, projectDir);

    await window.locator('[data-testid="nav-agents"]').click();
    await window.locator('[data-testid="agents-board-new-thread"]').first().click();
    const modal = window.locator('[data-testid="launch-modal"]');
    await expect(modal).toBeVisible();
    await modal.locator('.launch-segmented').getByRole('button', { name: 'Squad', exact: true }).click();
    const goal = modal.getByTestId('team-command-input');
    await goal.click();
    await goal.fill('coordinate smoke check and report back');
    const teamPicker = modal.getByLabel('Squad', { exact: true });
    await teamPicker.click();
    await window.getByRole('listbox', { name: 'Squad' }).getByRole('option', { name: 'E2E On Demand Team' }).click();
    const projectPicker = modal.getByRole('button', { name: 'Machine and project', exact: true });
    await projectPicker.click();
    await window.getByRole('listbox', { name: 'Machine and project' }).getByRole('option', { name: projectName, exact: false }).click();
    await modal.getByLabel('Squad planning').click();
    await window.getByRole('option', { name: 'Infer plan from goal', exact: true }).click();
    const send = modal.getByTestId('team-command-send');
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await send.click();
    // Engine launches are pre-authorized, and a seat that starts on demand would be authorized later, outside that
    // approval, so the launch is refused before anything is spawned and the reason names the seat.
    await expect(modal.getByText(/Start on demand can't be used with a pre-authorized plan/)).toBeVisible({ timeout: 30_000 });
    await expect(modal.getByText(/turn it off for: .*e2e-worker/)).toBeVisible();
    const sessions = await window.evaluate((pid) => window.cc.terminals.list(pid), projectId!);
    expect(sessions).toHaveLength(0);
  } finally {
    if (projectId) {
      await window.evaluate(async (pid) => {
        try {
          const sessions = (await window.cc.terminals.list?.(pid)) as Array<{ id: string }> | undefined;
          for (const s of sessions ?? []) { try { await window.cc.terminals.close(s.id); } catch { /* best-effort */ } }
        } catch { /* best-effort */ }
        try { await window.cc.projects.remove(pid); } catch { /* best-effort */ }
      }, projectId);
    }
    rmSync(projectDir, { recursive: true, force: true });
    agent.cleanup();
  }
});
