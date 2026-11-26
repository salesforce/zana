import { expect, type Locator, type Page } from '@playwright/test';

export type ComposerSettingGroup = 'mode' | 'reasoning' | 'permission' | 'send-mode';

const GROUP_LABEL: Record<ComposerSettingGroup, string> = {
  mode: 'Composer mode',
  reasoning: 'Thinking effort',
  permission: 'Permission mode',
  'send-mode': 'Send mode'
};

/** Desktop Modern composer: mode, thinking, permissions and send mode live in one pill. */
export function composerSettingsPill(scope: Locator | Page): Locator {
  return scope.getByTestId('composer-settings-pill');
}

async function openSettings(window: Page, scope: Locator | Page): Promise<Locator> {
  const menu = window.getByTestId('composer-settings-menu');
  if (!(await menu.isVisible())) {
    const pill = composerSettingsPill(scope);
    await expect(pill).toBeEnabled({ timeout: 30_000 });
    await pill.click();
  }
  await expect(menu).toBeVisible();
  return menu;
}

async function closeSettings(window: Page): Promise<void> {
  const menu = window.getByTestId('composer-settings-menu');
  if (await menu.isVisible()) await window.keyboard.press('Escape');
  await expect(menu).toBeHidden();
}

/** Pick a choice by its visible label (e.g. "Full", "Steer", "Plan"). */
export async function pickComposerSetting(
  window: Page,
  scope: Locator | Page,
  group: ComposerSettingGroup,
  label: string | RegExp
): Promise<void> {
  const menu = await openSettings(window, scope);
  const radio = menu.getByRole('radiogroup', { name: GROUP_LABEL[group] }).getByRole('radio', { name: label });
  await radio.click();
  // A provider with a single remaining choice hides the group once the pick is valid.
  await expect.poll(async () => (await radio.count()) === 0 || (await radio.getAttribute('aria-checked')) === 'true').toBe(true);
  await closeSettings(window);
}

/** Assert the selected choice of a settings group, leaving the menu closed. */
export async function expectComposerSetting(
  window: Page,
  scope: Locator | Page,
  group: ComposerSettingGroup,
  label: string | RegExp
): Promise<void> {
  const menu = await openSettings(window, scope);
  await expect(
    menu.getByRole('radiogroup', { name: GROUP_LABEL[group] }).getByRole('radio', { checked: true })
  ).toHaveText(label);
  await closeSettings(window);
}

/** Labels offered by a settings group, in order. */
export async function composerSettingChoices(
  window: Page,
  scope: Locator | Page,
  group: ComposerSettingGroup
): Promise<string[]> {
  const menu = await openSettings(window, scope);
  const labels = await menu.getByRole('radiogroup', { name: GROUP_LABEL[group] }).getByRole('radio').allInnerTexts();
  await closeSettings(window);
  return labels.map((label) => label.replace(/\s+/g, ''));
}
