import { test, expect, dismissConsentOverlays } from './fixtures/app.js';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expectComposerSetting } from './fixtures/composer-settings.js';

test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { sponsorPromptDismissed: true }
});

for (const surface of ['home', 'dialog'] as const) {
  test(`${surface} keeps the latest draft through CLI Agent, Modern, and Squad switches`, async ({ app }) => {
    const { window } = app;
    await dismissConsentOverlays(window);
    await window.getByTestId('nav-home').click();
    if (surface === 'dialog') {
      await window.getByTestId('nav-agents').click();
      await window.getByTestId('agents-board-new-thread').click();
    }
    const composer = surface === 'dialog' ? window.getByTestId('launch-modal') : window.locator('.home-agent-composer');
    const modes = composer.getByRole('group', { name: 'Launch mode' });
    await modes.getByRole('button', { name: 'CLI Agent', exact: true }).click();
    const cli = composer.getByTestId('legacy-agent-command-input');
    await cli.fill('Keep this draft');
    await cli.press('Shift+Enter');
    await cli.pressSequentially('and this second line');
    const original = await cli.innerText();
    await modes.getByRole('button', { name: 'Modern', exact: true }).click();
    const modern = composer.getByTestId('thread-command-input');
    await expect.poll(() => modern.innerText()).toBe(original);
    await modern.fill('Edited in Modern');
    await modes.getByRole('button', { name: 'Squad', exact: true }).click();
    const squad = composer.getByTestId('team-command-input');
    await expect(squad).toHaveText('Edited in Modern');
    await squad.fill('Edited in Squad');
    await modes.getByRole('button', { name: 'CLI Agent', exact: true }).click();
    await expect(cli).toHaveText('Edited in Squad');
    // Exercise the editor's deletion transaction; an empty fill can bypass it on Linux.
    await cli.press('ControlOrMeta+A');
    await cli.press('Backspace');
    await expect(cli).toHaveText('');
    await modes.getByRole('button', { name: 'Modern', exact: true }).click();
    await expect(modern).toHaveText('');
  });
}

async function expectPermissionFor(window: Page, mode: string, label: string) {
  if (mode === 'Modern') {
    await expectComposerSetting(window, window, 'permission', label);
  } else {
    await expect(window.getByRole('button', { name: 'Permission mode', exact: true })).toContainText(label);
  }
}

test('Composer settings default to Auto and persist a Full access opt-in for both agent composers', async ({ app }) => {
  const { window, home } = app;
  const binary = join(home, 'composer-claude');
  writeFileSync(binary, '#!/bin/sh\nprintf "2.1.220 (Claude Code)\\n"\n');
  chmodSync(binary, 0o755);
  await window.evaluate(async (claudeBinary) => {
    await window.cc.config.set({ claudeBinary, defaultHarness: 'claude', defaultThreadProviderId: 'claude-code' });
    await window.cc.harness.verify();
  }, binary);
  await dismissConsentOverlays(window);
  await window.getByTestId('nav-home').click();
  const modes = window.getByRole('group', { name: 'Launch mode' });
  const expectPermission = (mode: string, label: string) => expectPermissionFor(window, mode, label);
  for (const mode of ['Modern', 'CLI Agent']) {
    await modes.getByRole('button', { name: mode, exact: true }).click();
    await window.getByTestId('model-reasoning-picker-trigger').click();
    await window.getByTestId('model-reasoning-provider-claude-code').click();
    await window.getByTestId('model-reasoning-picker-trigger').click();
    await expectPermission(mode, 'Auto');
  }
  await window.getByRole('link', { name: 'Settings', exact: true }).click();
  await window.getByTestId('settings-nav-composer').click();
  const toggle = window.getByRole('switch', { name: 'Full access by default' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await window.reload();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await window.getByRole('link', { name: 'Back to app' }).click();
  await window.getByTestId('nav-home').click();
  for (const mode of ['CLI Agent', 'Modern']) {
    await modes.getByRole('button', { name: mode, exact: true }).click();
    await expectPermission(mode, 'Full');
  }
  await window.getByRole('link', { name: 'Settings', exact: true }).click();
  await window.getByTestId('settings-nav-composer').click();
  await toggle.click();
  await window.reload();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await window.getByRole('link', { name: 'Back to app' }).click();
  await window.getByTestId('nav-home').click();
  for (const mode of ['Modern', 'CLI Agent']) {
    await modes.getByRole('button', { name: mode, exact: true }).click();
    await expectPermission(mode, 'Auto');
  }
});
