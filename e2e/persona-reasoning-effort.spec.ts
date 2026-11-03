import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import type { Page } from '@playwright/test';

// #584: a persona can carry a Claude reasoning effort. Drives the real editor
// in the built app: set it, save, reopen, see it, then reset it to the default.

test.use({
  initialConfig: async ({}, use) => {
    await use({ sponsorPromptDismissed: true });
  },
});

async function openPersonas(window: Page) {
  await window.getByRole('link', { name: 'Settings' }).click();
  await window.locator('.settings-section-item').filter({ hasText: 'Personas' }).click();
}

async function savedLevel(window: Page, name: string) {
  return window.evaluate(async (personaName) => {
    const all = await window.cc.personas.list();
    return all.find((p) => p.name === personaName)?.reasoningLevel ?? null;
  }, name);
}

test('persona editor sets, shows and clears Reasoning effort', async ({ app, electron }, testInfo) => {
  const { window } = app;
  const name = 'Effort Persona';
  await openPersonas(window);

  await window.getByRole('button', { name: 'New persona' }).click();
  await window.locator('#persona-name').fill(name);
  const picker = window.getByRole('button', { name: 'Reasoning effort' });
  await expect(picker).toBeVisible();
  await expect(picker).toContainText('Use harness default (unset)');
  await expect(window.getByText('Sets how hard Claude thinks for this persona. Other agents ignore it.')).toBeVisible();

  await picker.click();
  await window.getByRole('listbox', { name: 'Reasoning effort' }).getByRole('option', { name: /^High/ }).click();
  await expect(picker).toContainText('High');
  await captureElectronScreenshot(electron, window, testInfo.outputPath('01-effort-selected.png'));
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => savedLevel(window, name)).toBe('high');

  // Reopen: the saved value is shown.
  await window.locator('.skills-row-open').filter({ hasText: name }).click();
  const reopened = window.getByRole('button', { name: 'Reasoning effort' });
  await expect(reopened).toContainText('High');
  await captureElectronScreenshot(electron, window, testInfo.outputPath('02-effort-reopened.png'));

  // Reset to the default: the stored value is cleared.
  await reopened.click();
  await window.getByRole('listbox', { name: 'Reasoning effort' })
    .getByRole('option', { name: 'Use harness default (unset)' }).click();
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => savedLevel(window, name)).toBeNull();

  await window.locator('.skills-row-open').filter({ hasText: name }).click();
  await expect(window.getByRole('button', { name: 'Reasoning effort' })).toContainText('Use harness default (unset)');
});
