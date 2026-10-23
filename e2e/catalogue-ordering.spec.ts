import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

test.use({
  initialConfig: {
    composerShowCliAgent: true,
    composerShowModern: true,
    composerShowAutonomousTeam: true,
    sponsorPromptDismissed: true
  }
});

const PERSONAS = ['E2E Accent 1', 'E2E alpha 2', 'E2E Alpha 10'];
const TEAMS = ['E2E Accent 1', 'E2E alpha 2', 'E2E Alpha 10'];

async function expectOrder(menu: Locator, expected: readonly string[]) {
  const labels = await menu.locator('[role="option"]').allTextContents();
  const indexes = expected.map((label) => labels.findIndex((value) => value.trim().startsWith(label)));
  expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
  expect(indexes.every((index) => index >= 0)).toBe(true);
}

async function seedCatalogue(window: Page) {
  await window.evaluate(async () => {
    for (const [id, name] of [
      ['e2e-persona-zebra', 'E2E Zebra 10'],
      ['e2e-persona-alpha-10', 'E2E Alpha 10'],
      ['e2e-persona-accent', 'E2E Accent 1'],
      ['e2e-persona-alpha-2', 'E2E alpha 2']
    ]) {
      const result = await window.cc.personas.save({ id, name, baseProfile: 'shell' });
      if (!result.ok) throw new Error(result.message ?? `Could not save ${id}`);
    }
    for (const [id, name] of [
      ['e2e-team-zebra', 'E2E Zebra 10'],
      ['e2e-team-alpha-10', 'E2E Alpha 10'],
      ['e2e-team-accent', 'E2E Accent 1'],
      ['e2e-team-alpha-2', 'E2E alpha 2']
    ]) {
      const result = await window.cc.teams.save({ id, name, slots: [] });
      if (!result.ok) throw new Error(result.message ?? `Could not save ${id}`);
    }
  });
}

test('built Electron orders catalogue display without changing raw defaults or launching', async ({ app, home }) => {
  const { window } = app;
  await seedCatalogue(window);

  await window.getByRole('link', { name: 'Settings', exact: true }).click();
  await window.getByTestId('settings-nav-personas').click();
  const personaRows = window.locator('.personas-panel .skills-row-name');
  await expect(personaRows.filter({ hasText: 'E2E Zebra 10' })).toBeVisible();
  expect((await personaRows.allTextContents()).filter((name) => name.startsWith('E2E'))).toEqual([
    ...PERSONAS, 'E2E Zebra 10'
  ]);
  await window.getByRole('textbox', { name: 'Search personas' }).fill('alpha');
  expect((await personaRows.allTextContents()).filter((name) => name.startsWith('E2E'))).toEqual([
    'E2E alpha 2', 'E2E Alpha 10'
  ]);
  await window.getByRole('textbox', { name: 'Search personas' }).fill('');
  await window.getByRole('tab', { name: /User/ }).click();
  expect((await personaRows.allTextContents()).filter((name) => name.startsWith('E2E'))).toEqual([
    ...PERSONAS, 'E2E Zebra 10'
  ]);

  await window.getByTestId('settings-nav-squads').click();
  const teamRows = window.locator('.squads-panel .skills-row-name');
  await expect(teamRows.filter({ hasText: 'E2E Zebra 10' })).toBeVisible();
  expect((await teamRows.allTextContents()).filter((name) => name.startsWith('E2E'))).toEqual([
    ...TEAMS, 'E2E Zebra 10'
  ]);
  await window.getByRole('textbox', { name: 'Search squads' }).fill('alpha');
  expect((await teamRows.allTextContents()).filter((name) => name.startsWith('E2E'))).toEqual([
    'E2E alpha 2', 'E2E Alpha 10'
  ]);

  // Home's squad picker displays alphabetically; with no flagged default the first squad alphabetically is preselected.
  await window.evaluate(() => {
    history.pushState({}, '', '/');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  const homeComposer = window.locator('.home-agent-composer');
  await homeComposer.getByRole('button', { name: 'Squad', exact: true }).click();
  const homePicker = homeComposer.getByTestId('team-picker');
  await homePicker.click();
  await expectOrder(window.getByRole('listbox', { name: 'Squad' }), [...TEAMS, 'E2E Zebra 10']);
  await window.getByRole('option', { name: /E2E Zebra 10/ }).click();
  await expect(homePicker).toContainText('E2E Zebra 10');
  await window.keyboard.press('Escape');

  // Rename the selected entry through the successful save IPC. Its selected ID
  // remains stable, even though its alphabetical position changes.
  await window.evaluate(async () => {
    const result = await window.cc.teams.save({ id: 'e2e-team-zebra', name: 'E2E Before Accent', slots: [] });
    if (!result.ok) throw new Error(result.message ?? 'Could not rename team');
  });
  await expect(homePicker).toContainText('E2E Before Accent');
  await homePicker.click();
  await expectOrder(window.getByRole('listbox', { name: 'Squad' }), ['E2E Accent 1', 'E2E alpha 2', 'E2E Alpha 10', 'E2E Before Accent']);
  await window.keyboard.press('Escape');

  const projectPath = join(home, 'catalogue-ordering-project');
  mkdirSync(projectPath);
  const projectId = await window.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message ?? 'Could not add project');
    return result.value.id;
  }, projectPath);
  const projectName = 'catalogue-ordering-project';
  const heading = window.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  const projectRow = window.locator('.sidebar-projects').getByRole('button', { name: `Open ${projectName}`, exact: true });
  await projectRow.click();
  // Modal uses same sorted squad picker; CLI advanced picker keeps None first.
  await window.getByRole('button', { name: 'Back to all projects' }).click();
  const launchProjectRow = window.locator('.sidebar-projects').getByRole('button', { name: `Open ${projectName}`, exact: true });
  await launchProjectRow.hover();
  await window.getByRole('button', { name: `New agent in ${projectName}` }).click();
  const modal = window.getByTestId('launch-modal');
  await modal.getByRole('group', { name: 'Launch mode' }).getByText('Squad', { exact: true }).click();
  const modalPicker = modal.getByTestId('team-picker');
  await modalPicker.click();
  await expectOrder(window.getByRole('listbox', { name: 'Squad' }), ['E2E Accent 1', 'E2E alpha 2', 'E2E Alpha 10', 'E2E Before Accent']);
  await window.keyboard.press('Escape');

  await modal.getByRole('button', { name: 'CLI Agent', exact: true }).click();
  await modal.getByTestId('legacy-agent-customize-launch').click();
  await modal.getByRole('button', { name: 'Persona' }).click();
  const personaMenu = window.getByRole('listbox', { name: 'Persona' });
  const personaOptions = await personaMenu.locator('[role="option"]').allTextContents();
  expect(personaOptions[0]?.trim()).toBe('None');
  await expectOrder(personaMenu, [...PERSONAS, 'E2E Zebra 10']);

  // No send/launch/menu action is clicked. Keep project ID reachable so this
  // test exercises a real persisted project without mutating its settings.
  expect(projectId).not.toBe('');
});
