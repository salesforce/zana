import { test, expect } from './fixtures/app';

test('persona editor shows Claude options in personal edit and builtin override modes', async ({ app }) => {
  const { window } = app;

  const saved = await window.evaluate(() =>
    window.cc.personas.save({
      id: 'e2e-personal-edit',
      name: 'E2E Personal Edit',
      description: 'Persona editor interaction fixture'
    })
  );
  expect(saved.ok).toBe(true);

  try {
    await window.locator('button.nav-item').filter({ hasText: 'Personas' }).first().click();

    const personalRow = window.locator('.skills-row').filter({ hasText: 'E2E Personal Edit' });
    await expect(personalRow).toBeVisible();
    await personalRow.locator('.skills-row-open').click();

    await expect(window.locator('.persona-editor-modal')).toContainText('Edit E2E Personal Edit');
    const personalOptions = window.getByTestId('persona-claude-options');
    await expect(personalOptions).toBeVisible();
    await expect(personalOptions.locator('.opener-row-advanced')).toHaveCount(0);
    await personalOptions.locator('.opener-row-expand').click();
    await expect(personalOptions.locator('label')).toContainText([
      'Allowed tools',
      'Denied tools',
      'Extra dirs'
    ]);

    const harnessProfile = window.locator('#persona-profile');
    await harnessProfile.selectOption('claude');
    const nativeRouting = window.getByTestId('persona-harness-routing');
    await expect(nativeRouting).toBeVisible();
    await expect(window.getByTestId('persona-portable-routing')).toHaveCount(0);
    await expect(nativeRouting.locator('#persona-provider-target')).toHaveValue('anthropic');
    await expect(nativeRouting.locator('#persona-model-target')).toBeVisible();
    await expect(nativeRouting.locator('#persona-execution-target')).toBeVisible();
    await expect(personalOptions.locator('.opener-row-expand')).toBeEnabled();

    await nativeRouting.locator('#persona-model-target').selectOption('sonnet');
    await nativeRouting.locator('#persona-execution-target').selectOption('accept-edits');

    await harnessProfile.selectOption('opencode');
    const openCodeRouting = window.getByTestId('persona-harness-routing');
    await expect(openCodeRouting).toBeVisible();
    await expect(openCodeRouting.locator('#persona-provider-target')).toBeEnabled();
    await expect(openCodeRouting.locator('#persona-model-target')).toBeEnabled();
    await expect(openCodeRouting.locator('#persona-execution-target')).toBeEnabled();
    await expect(openCodeRouting.locator('#persona-role-target')).toHaveCount(0);
    const routingGrid = window.locator('.persona-routing-grid');
    await expect(routingGrid.locator('#persona-profile')).toHaveCount(1);
    await expect(routingGrid.locator('#persona-provider-target')).toHaveCount(1);
    await expect(routingGrid.locator('#persona-model-target')).toHaveCount(1);
    await expect(routingGrid.locator('#persona-execution-target')).toHaveCount(1);
    await expect(personalOptions.locator('.opener-row-expand')).toBeDisabled();
    await expect(personalOptions).toContainText('Unavailable');

    await harnessProfile.selectOption('');
    await expect(window.getByTestId('persona-portable-routing')).toBeVisible();
    await expect(window.getByTestId('persona-harness-routing')).toHaveCount(0);
    await expect(personalOptions.locator('.opener-row-expand')).toBeEnabled();
    await window.locator('.persona-editor-modal button', { hasText: /^Save$/ }).click();
    await expect(window.locator('.persona-editor-modal')).toHaveCount(0);

    const neutralSaved = await window.evaluate(async () => {
      const personas = await window.cc.personas.list();
      return personas.find((persona) => persona.id === 'e2e-personal-edit');
    });
    expect(neutralSaved).toMatchObject({
      id: 'e2e-personal-edit',
      baseProfile: undefined,
      permissionMode: undefined
    });
    expect(neutralSaved?.harnessRouting?.byAdapter?.claude?.modelTargetId).toBe('sonnet');
    expect(neutralSaved?.model).toBe('sonnet'); // compatibility projection; neutral runtime ignores exact adapter target

    const builtinRow = window.locator('.skills-row').filter({
      has: window.locator('.skills-row-name', { hasText: /^Code Reviewer$/ })
    });
    await expect(builtinRow).toBeVisible();
    await expect(builtinRow.locator('.scheduler-pill')).toContainText([
      'Builtin',
      'claude',
      'opus',
      'plan'
    ]);
    await builtinRow.locator('.skills-row-open').click();
    await window.locator('.persona-editor-modal button', { hasText: 'Edit override' }).click();

    const overrideOptions = window.getByTestId('persona-claude-options');
    await expect(overrideOptions).toBeVisible();
    const overrideRouting = window.getByTestId('persona-harness-routing');
    await expect(window.locator('#persona-profile')).toHaveValue('claude');
    await expect(overrideRouting.locator('#persona-provider-target')).toHaveValue('anthropic');
    await expect(overrideRouting.locator('#persona-model-target')).toHaveValue('opus');
    await expect(overrideRouting.locator('#persona-execution-target')).toHaveValue('plan');
    await expect(overrideOptions.locator('.opener-row-expand')).toHaveAttribute(
      'aria-expanded',
      /true|false/
    );
  } finally {
    await window.evaluate(() => window.cc.personas.delete('e2e-personal-edit'));
  }
});
