import { test, expect } from './fixtures/app.js';

test('Quick Agent command surface matches Home without Home picker controls', async ({ app }, testInfo) => {
  const { window } = app;

  await window.locator('[data-testid="nav-home"]').click();
  const homeComposer = window.locator('.home-agent-command');
  await expect(homeComposer).toBeVisible();
  await homeComposer.screenshot({ path: testInfo.outputPath('home-composer.png') });
  const homeSurfaceMetrics = await homeComposer.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderRadius: style.borderRadius,
      borderStyle: style.borderStyle,
      padding: style.padding,
      backgroundColor: style.backgroundColor
    };
  });
  const homeInputMetrics = await homeComposer.locator('.ui-command-composer-input').evaluate((element) => {
    const style = getComputedStyle(element);
    return { height: style.height, minHeight: style.minHeight, fontSize: style.fontSize, lineHeight: style.lineHeight };
  });

  await window.locator('[data-testid="nav-agents"]').click();
  const newQuickAgent = window.locator('[data-testid="agents-new"]');
  if (await newQuickAgent.count()) {
    await newQuickAgent.click();
  } else {
    await window.locator('[data-testid="agents-new-empty"]').click();
  }

  const modal = window.locator('[data-testid="launch-modal"]');
  const quickComposer = modal.locator('.prompt-composer--home');
  await expect(quickComposer).toBeVisible();
  await quickComposer.screenshot({ path: testInfo.outputPath('quick-agent-composer.png') });

  const quickSurfaceMetrics = await quickComposer.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderRadius: style.borderRadius,
      borderStyle: style.borderStyle,
      padding: style.padding,
      backgroundColor: style.backgroundColor
    };
  });
  const quickInput = quickComposer.locator('.ui-command-composer-input');
  const quickInputMetrics = await quickInput.evaluate((element) => {
    const style = getComputedStyle(element);
    return { height: style.height, minHeight: style.minHeight, fontSize: style.fontSize, lineHeight: style.lineHeight };
  });

  expect(quickSurfaceMetrics).toEqual(homeSurfaceMetrics);
  expect(quickInputMetrics).toEqual(homeInputMetrics);

  await expect(quickComposer.locator('.home-agent-select, .launch-model-picker-trigger')).toHaveCount(0);
  await expect(quickComposer.getByLabel('Attach files')).toBeVisible();
  await expect(quickComposer.getByLabel('Launch agent')).toBeVisible();
});

test('Autonomous Team reuses the Home command surface', async ({ app }) => {
  const { window } = app;

  await window.locator('[data-testid="nav-agents"]').click();
  const newQuickAgent = window.locator('[data-testid="agents-new"]');
  if (await newQuickAgent.count()) {
    await newQuickAgent.click();
  } else {
    await window.locator('[data-testid="agents-new-empty"]').click();
  }

  const modal = window.locator('[data-testid="launch-modal"]');
  const autonomousMode = modal.getByRole('button', { name: 'Autonomous team' });
  if (await autonomousMode.count() === 0) test.skip(true, 'No autonomous teams are configured');
  await autonomousMode.click();

  const teamComposer = modal.locator('.prompt-composer--home');
  await expect(teamComposer).toBeVisible();
  await expect(teamComposer.locator('.launch-instruction, .prompt-composer-actions')).toHaveCount(0);
  await expect(teamComposer.locator('.home-agent-select, .launch-model-picker-trigger')).toHaveCount(0);
  await expect(teamComposer.getByLabel('Attach files')).toBeVisible();
  await expect(teamComposer.getByLabel('Launch autonomous team')).toBeVisible();
  await expect(modal.locator('.launch-actions')).toHaveCount(0);
});
