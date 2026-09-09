import { fileURLToPath } from 'node:url';
import { delimiter, dirname, join } from 'node:path';
import { test, expect } from './fixtures/app.js';

const repoRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const fixtureBin = join(repoRoot, 'e2e', 'fixtures', 'bin');

test.use({
  initialConfig: { nativeAgentDiscoveryEnabled: true },
  launchEnv: {
    PATH: `${fixtureBin}${delimiter}${process.env.PATH ?? ''}`,
    FAKE_ACP_MODEL_CONFIG: '1',
    FAKE_ACP_MODE_CONFIG: '1',
    FAKE_ACP_MODE_OPTIONS: 'build:Build,plan:Plan,reviewer:Reviewer'
  }
});

test('Modern Native role picker preserves semantic modes and custom roles', async ({ app }) => {
  const { window } = app;
  await window.getByTestId('nav-home').click();
  const config = await window.evaluate(async () => {
    const response = await fetch('/api/v1/config');
    return response.json();
  }) as { config: { nativeAgentDiscoveryEnabled?: boolean } };
  expect(config.config.nativeAgentDiscoveryEnabled).toBe(true);

  const composer = window.locator('.thread-command-composer').first();
  await expect(composer).toBeVisible();
  const executionOptions = await window.evaluate(async () => {
    const response = await fetch('/api/v1/system/execution-options?providerId=acp-opencode');
    return response.json();
  }) as { acpMode?: { currentValue?: string; options: Array<{ value: string; name?: string }> }; modelLoadError?: unknown };
  expect(executionOptions.acpMode, JSON.stringify(executionOptions)).toEqual({
    currentValue: 'build',
    options: [
      { value: 'build', name: 'Build' },
      { value: 'plan', name: 'Plan' },
      { value: 'reviewer', name: 'Reviewer' }
    ]
  });
  const modelTrigger = composer.getByTestId('model-reasoning-picker-trigger');
  await modelTrigger.click();
  await window.getByTestId('model-reasoning-provider-acp-opencode').click();
  await modelTrigger.click(); // switching harness leaves the popover open; close it

  // Semantic entries precede custom native roles; execute/plan ACP modes do not duplicate.
  const roleTrigger = composer.getByTestId('composer-mode-picker-trigger');
  await expect(roleTrigger).toBeVisible({ timeout: 30_000 });
  await expect(roleTrigger).toContainText('Agent');
  await roleTrigger.click();
  const roleMenu = window.getByTestId('composer-mode-picker-menu');
  await expect(roleMenu.getByRole('option')).toHaveText(['∞Agent', 'Plan', '∞Reviewer']);
  await window.getByTestId('composer-mode-reviewer').click();
  await expect(roleTrigger).toContainText('Reviewer');

  const input = composer.getByTestId('thread-command-input');
  await input.fill('echo-selected-mode');
  await composer.getByTestId('thread-command-send').click();

  await expect(window.getByText('selected-mode:reviewer', { exact: false })).toBeVisible({ timeout: 30_000 });
});
