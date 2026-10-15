import { test, expect } from './fixtures/app.js';

test('Squad routing enforcement persists through the built Electron editor', async ({ app }) => {
  const window = app.window;

  await window.evaluate(async () => {
    await window.cc.personas.save({ id: 'e2e-routing-orchestrator', name: 'E2E Routing Orchestrator', baseProfile: 'claude' });
    await window.cc.personas.save({ id: 'e2e-routing-worker', name: 'E2E Routing Worker', baseProfile: 'claude' });
    await window.cc.teams.save({
      id: 'e2e-routing-squad',
      name: 'E2E Routing Squad',
      orchestratorPersonaId: 'e2e-routing-orchestrator',
      slots: [
        { personaId: 'e2e-routing-orchestrator', quantity: 1 },
        { personaId: 'e2e-routing-worker', quantity: 1 }
      ]
    });
  });

  await window.getByRole('link', { name: 'Settings', exact: true }).click();
  await window.getByTestId('settings-nav-squads').click();
  await window.getByRole('button', { name: 'Open E2E Routing Squad' }).click();

  const routing = window.getByLabel('Squad routing');
  await expect(routing).toContainText('Use default');
  await routing.click();
  await window.getByRole('listbox', { name: 'Squad routing' }).getByRole('option', { name: 'On', exact: true }).click();
  await window.getByRole('button', { name: 'Save', exact: true }).click();

  await expect.poll(() => window.evaluate(async () => {
    const teams = await window.cc.teams.list();
    return teams.find((team) => team.id === 'e2e-routing-squad')?.routingEnforced;
  })).toBe(true);

  await window.getByRole('button', { name: 'Open E2E Routing Squad' }).click();
  await expect(window.getByLabel('Squad routing')).toContainText('On');
});
