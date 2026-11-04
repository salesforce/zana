import { test, expect } from './fixtures/app.js';
import type { Locator, Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({
  initialConfig: async ({ home }, use) => {
    const binary = join(home, 'opencode-settings-fixture');
    const fixture = new URL('./fixtures/bin/opencode', import.meta.url).href;
    // Pin both the runtime and executable before the host's boot-time probe.
    // A developer's native install must not make missing CI setup pass locally.
    writeFileSync(binary, `#!${process.execPath}\nawait import(${JSON.stringify(fixture)});\n`, { mode: 0o700 });
    await use({
      sponsorPromptDismissed: true,
      defaultHarness: 'opencode',
      harnesses: { byId: { opencode: { binary, enabled: true } } },
    });
  },
});

async function selectPicklistOption(
  trigger: Locator,
  window: Page,
  ariaLabel: string,
  optionName: string,
  search?: string
) {
  await trigger.click();
  const listbox = window.getByRole('listbox', { name: ariaLabel });
  if (search) await listbox.getByRole('textbox', { name: 'Search…' }).fill(search);
  await listbox.getByRole('option', { name: optionName, exact: true }).click();
}

test('Global and Project harness settings persist provider, model, execution, and reset flows', async ({ app }) => {
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-routing-settings-'));
  const project = await window.evaluate((path) => window.cc.projects.add(path), projectDir);
  expect(project.ok).toBe(true);
  if (!project.ok) return;
  const projectId = project.value.id;
  const projectName = basename(projectDir);

  try {
    await window.getByRole('link', { name: 'Settings' }).click();
    await window.locator('.settings-section-item').filter({ hasText: 'AI Harness' }).click();
    await expect(window.locator('.settings-header')).toContainText('AI Harness');

    await window.getByRole('tab', { name: 'CLI Agent' }).click();
    const globalOpenCode = window.getByTestId('harness-legacy-list').locator('.opener-row').filter({ hasText: 'OpenCode' });
    await globalOpenCode.locator('.opener-row-expand').click();
    const globalProvider = globalOpenCode.getByRole('button', { name: 'Default provider' });
    const globalModel = globalOpenCode.getByRole('button', { name: 'Default model level' });
    const globalExecution = globalOpenCode.getByRole('button', { name: 'Default execution state' });
    await expect(globalProvider).toBeEnabled();
    await selectPicklistOption(globalProvider, window, 'Default provider', 'fixture-provider');
    await selectPicklistOption(globalModel, window, 'Default model level', 'fixture-provider/fixture-model', 'fixture-model');
    await selectPicklistOption(globalExecution, window, 'Default execution state', 'plan [Plan]');
    await expect(globalProvider).toContainText('fixture-provider');
    await expect(globalModel).toContainText('fixture-provider/fixture-model');
    await expect(globalExecution).toContainText('plan [Plan]');
    await expect.poll(() => window.evaluate(() => window.cc.config.get())).toMatchObject({
      harnessRouting: {
        byAdapter: {
          opencode: {
            providerTargetId: 'fixture-provider',
            modelTargetId: 'fixture-provider/fixture-model',
            executionState: 'plan'
          }
        }
      }
    });
    await selectPicklistOption(globalProvider, window, 'Default provider', 'Use harness default');
    await expect(globalProvider).toContainText('Use harness default');
    await expect(globalModel).toContainText('Use harness default');

    // Project-scoped harness settings live in the Project settings section. Its
    // nav link resolves to the global route until a project is scoped, so open
    // the section's alias route directly; it renders the project-only scope
    // dropdown ("Select a project…") that we then point at our tmp project.
    await window.evaluate(() => {
      window.history.pushState({}, '', '/settings/project');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    const scope = window.getByRole('button', { name: 'Project', exact: true });
    await scope.click();
    await window.getByRole('listbox', { name: 'Project' }).getByRole('option', { name: projectName, exact: true }).click();
    await expect(scope).toContainText(projectName);
    const projectClaude = window.locator('.opener-row').filter({ hasText: 'Claude Code' });
    await projectClaude.locator('.opener-row-expand').click();
    await expect(projectClaude.locator('.harness-settings-group')).toHaveCount(1);
    await expect(projectClaude).toContainText('Zana Settings');
    await expect(projectClaude).toContainText('Harness Settings');
    await expect(projectClaude).toContainText('Harness Files');
    await projectClaude.getByRole('tab', { name: 'Harness Settings' }).click();
    await expect(projectClaude).toContainText('Shared');
    await expect(projectClaude).toContainText('Local');
    const projectOpenCode = window.locator('.opener-row').filter({ hasText: 'OpenCode' });
    await projectOpenCode.locator('.opener-row-expand').click();
    await expect(projectOpenCode).toContainText('Harness Settings');
    const projectProvider = projectOpenCode.getByRole('button', { name: 'Default provider' });
    const projectModel = projectOpenCode.getByRole('button', { name: 'Default model level' });
    const projectExecution = projectOpenCode.getByRole('button', { name: 'Default execution state' });
    await selectPicklistOption(projectProvider, window, 'Default provider', 'other-provider');
    await selectPicklistOption(projectModel, window, 'Default model level', 'other-provider/fixture-model-two', 'fixture-model-two');
    await selectPicklistOption(projectExecution, window, 'Default execution state', 'build + auto-approve [Autonomous]');
    await expect(projectProvider).toContainText('other-provider');
    await expect(projectModel).toContainText('other-provider/fixture-model-two');
    await expect(projectExecution).toContainText('build + auto-approve [Autonomous]');
    await expect.poll(() => window.evaluate((id) => window.cc.projectSettings.get(id), projectId)).toMatchObject({
      harnessRouting: {
        byAdapter: {
          opencode: {
            providerTargetId: 'other-provider',
            modelTargetId: 'other-provider/fixture-model-two',
            executionState: 'autonomous'
          }
        }
      }
    });
    await selectPicklistOption(projectProvider, window, 'Default provider', 'Use global default');
    await expect(projectProvider).toContainText('Use global default');
    await expect(projectModel).toContainText('Use global default');
  } finally {
    await window.evaluate((id) => window.cc.projects.remove(id), projectId);
    rmSync(projectDir, { recursive: true, force: true });
  }
});
