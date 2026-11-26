/**
 * Squad launch mode UX through the built app: the All Squads launch mode picker in Settings > Squads
 * persists, the Squad editor's "Use default (X)" follows it, and the launch composer shows a launch mode
 * picker that is disabled when the Squad pins its own mode.
 */
import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true, teamJobLaunchEnabled: true } });
test.setTimeout(120_000);

test('global Squad launch mode persists, drives Use default, and composer picker respects pins', async ({ app }) => {
  const win = app.window;
  await win.evaluate(async () => {
    for (const team of [
      { id: 'lm-default', name: 'LM Default Squad' },
      { id: 'lm-pinned', name: 'LM Pinned Squad', transport: 'CLI' as const }
    ]) {
      const result = await window.cc.teams.save({
        ...team, description: 'd', orchestratorPersonaId: 'builtin:orchestrator', slots: [{ personaId: 'builtin:orchestrator' }]
      } as never);
      if (!result.ok) throw new Error(result.message);
    }
  });
  await win.getByRole('link', { name: 'Settings', exact: true }).click();
  await win.getByTestId('settings-nav-squads').click();

  // (1) Global picker exists and persists.
  const picker = win.getByLabel('All Squads launch mode');
  await expect(picker).toBeVisible({ timeout: 15_000 });
  const setGlobal = async (option: RegExp, stored: string, summary: string) => {
    await picker.click();
    await win.getByRole('option', { name: option }).click();
    await expect.poll(() => win.evaluate(() => window.cc.config.get().then(c => c.squadDefaultTransport))).toBe(stored);
    await expect(win.getByTestId('squads-defaults-summary')).toHaveText(summary);
  };
  await setGlobal(/^Modern/, 'MODERN', 'Launch mode: Modern');

  // (2) Squad editor reflects the global default.
  const editorSelect = () => win.getByRole('dialog', { name: 'LM Default Squad' }).getByLabel('Squad launch mode');
  await win.getByRole('button', { name: 'Open LM Default Squad' }).click();
  await expect(editorSelect().locator('option[value="DEFAULT"]')).toHaveText('Use default (Modern)');
  await win.getByRole('button', { name: 'Cancel', exact: true }).click();

  await setGlobal(/^CLI Agent/, 'CLI', 'Launch mode: CLI Agent');
  await win.getByRole('button', { name: 'Open LM Default Squad' }).click();
  await expect(editorSelect().locator('option[value="DEFAULT"]')).toHaveText('Use default (CLI Agent)');
  await win.getByRole('button', { name: 'Cancel', exact: true }).click();

  // (3) Composer: picker enabled for a Use default Squad, disabled for a pinned one.
  const projects = await win.evaluate(async () => (await window.cc.projects.list()).length);
  const openComposer = async (name: string) => {
    await win.getByRole('button', { name: `Launch ${name}`, exact: true }).click();
    if (projects > 1) await win.getByRole('menuitem').first().click();
    const dialog = win.getByRole('dialog', { name: 'New squad' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    return dialog;
  };
  let dialog = await openComposer('LM Default Squad');
  const chip = dialog.locator('[data-testid="team-launch-mode-chip"]');
  await expect(chip).toBeVisible();
  await expect(chip.getByRole('button', { name: 'Squad launch mode' })).toBeEnabled();
  await expect(chip).toContainText('Default: CLI Agent');
  await win.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  dialog = await openComposer('LM Pinned Squad');
  const pinnedChip = dialog.locator('[data-testid="team-launch-mode-chip"]');
  await expect(pinnedChip.getByRole('button', { name: 'Squad launch mode' })).toBeDisabled();
  await expect(pinnedChip).toContainText('Pinned: CLI Agent');
});
