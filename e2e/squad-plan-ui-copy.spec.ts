import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true } });

test('built Electron shows the Squad plans copy line and the roles hint on a roleless, unlabeled slot', async ({ app }) => {
  const { window } = app;
  await window.evaluate(async () => {
    const persona = await window.cc.personas.save({ id: 'e2e-roleless-persona', name: 'E2E Roleless', baseProfile: 'shell' });
    if (!persona.ok) throw new Error(persona.message ?? 'Could not save persona');
    const team = await window.cc.teams.save({
      id: 'e2e-roleless-squad',
      name: 'E2E Roleless Squad',
      orchestratorPersonaId: 'e2e-roleless-persona',
      slots: [{ personaId: 'e2e-roleless-persona', quantity: 1 }]
    });
    if (!team.ok) throw new Error(team.message ?? 'Could not save squad');
  });

  await window.getByRole('link', { name: 'Settings', exact: true }).click();
  await window.getByTestId('settings-nav-squads').click();

  await expect(window.getByText(/Writing a plan for this Squad\? Ask an agent to brainstorm it\./)).toBeVisible();
  const link = window.getByRole('link', { name: 'Squad plans' });
  await expect(link).toHaveAttribute('href', 'https://zana-ide.com/docs/squads-plans/');

  await window.getByRole('button', { name: 'Open E2E Roleless Squad' }).click();
  await expect(window.getByText(/No roles on this slot/).first()).toBeVisible();
  await expect(window.getByText(/register_teams/).first()).toBeVisible();
});
