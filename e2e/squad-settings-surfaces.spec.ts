/**
 * Settings surfaces through the built app: Personas shows files the loader ignored (name and fixed
 * reason, never contents), Squads > Launch opens a pre-filled New Squad dialog without creating any
 * session itself, and main refuses session / run ids it does not own.
 */
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { dropPersonaFile } from './sdk/harness.js';

test('persona load warnings, Squad Launch prefill, and foreign ids refused', async ({ home }) => {
  test.setTimeout(120_000);
  const app = await launchApp(home, { e2e: true, initialConfig: { sponsorPromptDismissed: true, teamJobLaunchEnabled: true } });
  try {
    const win = app.window;
    const saved = await win.evaluate(async () => {
      try {
        return JSON.stringify(await window.cc.personas.save({
          id: 'launch-worker', name: 'Launch Worker', description: 'w', baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
        })).slice(0, 400);
      } catch (e) { return `THROW ${String(e)}`; }
    });
    expect(saved).not.toMatch(/THROW|"ok":false/);
    await win.evaluate(() => window.cc.teams.save({
      id: 'launch-team', name: 'Launch Prefill Team', description: 'd', slots: [{ personaId: 'launch-worker', quantity: 1 }]
    }));

    dropPersonaFile(home, { id: 'broken-persona' }, '{ this is not json');
    await win.reload();
    // Ignored persona file is reported by name with a fixed reason, never its contents.
    await win.getByRole('link', { name: 'Settings', exact: true }).click();
    await win.getByTestId('settings-nav-personas').click();
    const warnings = win.getByTestId('persona-load-warnings');
    await expect(warnings).toBeVisible({ timeout: 15_000 });
    await expect(warnings).toContainText('broken-persona.json');
    await expect(warnings).not.toContainText('this is not json');
    expect(join(home, '.zcc', 'personas', 'broken-persona.json')).toBeTruthy();

    // Squads > Launch opens the New Squad dialog on that Squad and creates no session by itself.
    await win.getByTestId('settings-nav-squads').click();
    const before = await win.evaluate(async () => (await window.cc.terminals.list()).length);
    const projects = await win.evaluate(async () => (await window.cc.projects.list()).length);
    await win.getByRole('button', { name: 'Launch Launch Prefill Team', exact: true }).click();
    if (projects > 1) await win.getByRole('menuitem').first().click();
    const dialog = win.getByRole('dialog', { name: 'New squad' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText('Launch Prefill Team');
    expect(await win.evaluate(async () => (await window.cc.terminals.list()).length)).toBe(before);

    // Main refuses ids it does not own.
    const refusal = await win.evaluate(async () => {
      const restart = await window.cc.terminals.restartSquadWorker('not-a-real-session');
      const projectId = (await window.cc.projects.list())[0].id;
      const stop = await window.cc.executionBoard.stop(projectId, 'not-a-real-execution', 1);
      const snap = await window.cc.executionBoard.snapshot(projectId, 'not-a-real-execution', 0);
      return { restart, stop, snap };
    });
    expect(refusal.restart.ok).toBe(false);
    expect(refusal.stop.ok).toBe(false);
    expect(refusal.snap ?? null).toBeNull();
  } finally {
    await closeApp(app.electron);
  }
});
