import { fileURLToPath } from 'node:url';
import { delimiter, dirname, join } from 'node:path';
import { test, expect } from './fixtures/app.js';

const repoRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const fixtureBin = join(repoRoot, 'e2e', 'fixtures', 'bin');

test.use({
  launchEnv: {
    PATH: `${fixtureBin}${delimiter}${process.env.PATH ?? ''}`,
    FAKE_ACP_MODEL_CONFIG: '1',
    FAKE_ACP_MODE_CONFIG: '1'
  }
});

test('Modern Native role applies a session-advertised ACP mode', async ({ app }) => {
  const { window } = app;
  await window.getByTestId('nav-home').click();

  const composer = window.locator('.thread-command-composer').first();
  await expect(composer).toBeVisible();
  const executionOptions = await window.evaluate(async () => {
    const response = await fetch('/api/v1/system/execution-options?providerId=acp-cursor');
    return response.json();
  }) as { acpMode?: { currentValue?: string; options: Array<{ value: string; name?: string }> }; modelLoadError?: unknown };
  expect(executionOptions.acpMode, JSON.stringify(executionOptions)).toEqual({
    currentValue: 'build',
    options: [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }]
  });
  const modelTrigger = composer.getByTestId('model-reasoning-picker-trigger');
  await modelTrigger.click();
  await window.getByTestId('model-reasoning-provider-acp-cursor').click();
  await modelTrigger.click(); // switching harness leaves the popover open; close it

  // The native role is a popover chip (shared NativeRolePicker) — the resting
  // selection is the session-advertised currentValue ('build' → labelled 'Build').
  const roleTrigger = composer.getByTestId('native-role-picker-trigger');
  await expect(roleTrigger).toBeVisible({ timeout: 30_000 });
  await expect(roleTrigger).toContainText('Build');
  await roleTrigger.click();
  const roleMenu = window.getByTestId('native-role-picker-menu');
  await expect(roleMenu.getByRole('option')).toHaveText(['Build', 'Plan']);
  await window.getByTestId('native-role-plan').click();
  await expect(roleTrigger).toContainText('Plan');

  const input = composer.getByTestId('thread-command-input');
  await input.fill('echo-selected-mode');
  await composer.getByTestId('thread-command-send').click();

  await expect(window.getByText('selected-mode:plan', { exact: false })).toBeVisible({ timeout: 30_000 });
});
