/**
 * Squad source picker and the retry after a failed launch (#411), driven through the
 * real composer in the built app.
 *
 *   A. The native chooser opens in the Project, shows dot folders, and then in the
 *      folder of the last pick.
 *   B. A launch that fails after consuming its attachments hands back fresh ones: the
 *      surviving chip still works, the lost one is explained, and a second Launch
 *      succeeds without touching the picker.
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { openDialogCalls, stubRecordedOpenDialog } from './sdk/native-dialog.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({ e2e: true, initialConfig: { teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, autoRenameTabs: false } });
test.setTimeout(120_000);

const GOAL = 'coordinate smoke check and report back';

async function setup(window: import('@playwright/test').Page, agentPath: string, projectDir: string) {
  await window.evaluate(({ bin }) => window.cc.config.set({
    teamJobLaunchEnabled: true, sponsorPromptDismissed: true, claudeBinary: bin, codexBinary: bin,
    trustZccToolsEnabled: false, tmuxScope: 'off', defaultHarness: 'claude'
  }), { bin: agentPath });
  for (const [id, name] of [['e2e-orchestrator', 'E2E Orchestrator'], ['e2e-worker', 'E2E Worker']]) {
    await window.evaluate(({ id, name }) => window.cc.personas.save({
      id, name, description: name, baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
    }), { id, name });
  }
  await window.evaluate(() => window.cc.teams.save({
    id: 'e2e-job-team', name: 'E2E Job Team', description: 'Source retry team',
    slots: [{ personaId: 'e2e-worker', quantity: 2 }], orchestratorPersonaId: 'e2e-orchestrator'
  }));
  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    return ((res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string }).id;
  }, projectDir);
  expect(projectId).toBeTruthy();
  return projectId;
}

async function openComposer(window: import('@playwright/test').Page, projectName: string) {
  await window.locator('[data-testid="nav-agents"]').click();
  await window.locator('[data-testid="agents-board-new-thread"]').first().click();
  const modal = window.locator('[data-testid="launch-modal"]');
  await expect(modal).toBeVisible();
  await modal.locator('.launch-segmented').getByRole('button', { name: 'Squad', exact: true }).click();
  const goal = modal.getByTestId('team-command-input');
  await goal.click();
  await goal.fill(GOAL);
  const teamPicker = modal.getByLabel('Squad', { exact: true });
  await teamPicker.click();
  await window.getByRole('listbox', { name: 'Squad' }).getByRole('option', { name: 'E2E Job Team' }).click();
  const projectPicker = modal.getByRole('button', { name: 'Machine and project', exact: true });
  await projectPicker.click();
  await window.getByRole('listbox', { name: 'Machine and project' }).getByRole('option', { name: projectName, exact: false }).click();
  await expect(projectPicker).toContainText(projectName);
  await modal.getByLabel('Squad planning').click();
  await window.getByRole('option', { name: 'Infer plan from goal', exact: true }).click();
  return modal;
}

async function withProject(
  window: import('@playwright/test').Page,
  run: (ctx: { projectDir: string; projectId: string; projectName: string }) => Promise<void>
) {
  const agent = makeJobTeamCoordinatorBinary();
  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-squad-src-')));
  mkdirSync(join(projectDir, '.zcc', 'plans'), { recursive: true });
  writeFileSync(join(projectDir, '.zcc', 'plans', 'keep.md'), '# keep\n');
  writeFileSync(join(projectDir, '.zcc', 'plans', 'gone.md'), '# gone\n');
  let projectId: string | null = null;
  try {
    projectId = await setup(window, agent.path, projectDir);
    await run({ projectDir, projectId, projectName: basename(projectDir) });
  } finally {
    if (projectId) {
      await window.evaluate(async (pid) => {
        try {
          for (const s of ((await window.cc.terminals.list?.(pid)) as Array<{ id: string }> | undefined) ?? []) {
            try { await window.cc.terminals.close(s.id); } catch { /* best-effort */ }
          }
        } catch { /* best-effort */ }
        try { await window.cc.projects.remove(pid); } catch { /* best-effort */ }
      }, projectId);
    }
    rmSync(projectDir, { recursive: true, force: true });
    agent.cleanup();
  }
}

test('the source picker opens in the Project, shows dot folders and remembers the last folder', async ({ app }) => {
  const { window, electron } = app;
  await withProject(window, async ({ projectDir, projectName }) => {
    const keep = join(projectDir, '.zcc', 'plans', 'keep.md');
    await stubRecordedOpenDialog(electron, [[keep], [keep]]);
    const modal = await openComposer(window, projectName);

    await modal.getByRole('button', { name: 'Attach sources' }).click();
    await expect(modal.getByLabel('Attached sources').getByText('keep.md')).toBeVisible();
    const [first] = await openDialogCalls(electron);
    expect(first.defaultPath).toBe(projectDir);
    expect(first.properties).toContain('showHiddenFiles');

    await modal.getByRole('button', { name: 'Remove keep.md' }).click();
    await modal.getByRole('button', { name: 'Attach sources' }).click();
    await expect(modal.getByLabel('Attached sources').getByText('keep.md')).toBeVisible();
    const calls = await openDialogCalls(electron);
    expect(calls).toHaveLength(2);
    expect(calls[1].defaultPath).toBe(join(projectDir, '.zcc', 'plans'));
  });
});

test('a Squad launch that fails after consuming its sources can be launched again without re-attaching', async ({ app }, testInfo) => {
  const { window, electron } = app;
  await withProject(window, async ({ projectDir, projectId, projectName }) => {
    const plans = join(projectDir, '.zcc', 'plans');
    await stubRecordedOpenDialog(electron, [[join(plans, 'keep.md'), join(plans, 'gone.md')]]);
    const modal = await openComposer(window, projectName);

    await modal.getByRole('button', { name: 'Attach sources' }).click();
    const chips = modal.getByLabel('Attached sources');
    await expect(chips.getByText('gone.md')).toBeVisible();
    unlinkSync(join(plans, 'gone.md'));

    await modal.getByTestId('team-command-send').click();
    const error = modal.getByTestId('team-command-error');
    await expect(error).toContainText('moved');
    await expect(error).toContainText('Attach gone.md again');
    await expect(chips.getByText('keep.md')).toBeVisible();
    await expect(chips.getByText('gone.md')).toHaveCount(0);
    const shot = testInfo.outputPath('failed-launch-chips.png');
    await captureElectronScreenshot(electron, window, shot, modal);
    await testInfo.attach('failed-launch-chips', { path: shot, contentType: 'image/png' });

    // No picker interaction: the renewed chip must be enough.
    await modal.getByTestId('team-command-send').click();
    await expect(modal).toBeHidden({ timeout: 15_000 });
    await expect.poll(async () => window.evaluate(async (pid) => {
      const page = await window.cc.executionBoard.listProject(pid);
      return page.executions[0]?.sources?.map(({ name }) => name) ?? [];
    }, projectId), { timeout: 15_000, intervals: [500] }).toContain('keep.md');
    expect((await openDialogCalls(electron))).toHaveLength(1);
  });
});
