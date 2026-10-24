import { test, expect } from './fixtures/app.js';

test('Squad retention round-trips through the built Electron Team editor', async ({ app }) => {
  const window = app.window;
  await window.evaluate(async () => {
    const result = await window.cc.teams.save({
      id: 'e2e-retention-squad', name: 'E2E Retention Squad',
      orchestratorPersonaId: 'builtin:orchestrator',
      slots: [{ personaId: 'builtin:orchestrator' }]
    });
    if (!result.ok) throw new Error(result.message);
  });
  await window.getByRole('link', { name: 'Settings', exact: true }).click();
  await window.getByTestId('settings-nav-squads').click();
  await window.getByRole('button', { name: 'Open E2E Retention Squad' }).click();
  const checkbox = window.getByRole('checkbox', { name: 'Keep orchestrator running after completion' });
  await expect(checkbox).not.toBeChecked();

  for (const retain of [true, false]) {
    await checkbox.setChecked(retain);
    await window.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(window.getByRole('dialog', { name: 'E2E Retention Squad' })).toBeHidden();
    await expect.poll(() => window.evaluate(async () => {
      const teams = await window.cc.teams.list();
      return teams.find((team) => team.id === 'e2e-retention-squad')?.retainOrchestrator;
    })).toBe(retain);
    await window.getByRole('button', { name: 'Open E2E Retention Squad' }).click();
    await expect(checkbox).toBeChecked({ checked: retain });
  }
});
