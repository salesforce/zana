import { test, expect } from './fixtures/app';
import type { Locator, Page } from '@playwright/test';
import { makeFakeAgentBinary } from './sdk/harness';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

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
  const openCode = makeFakeAgentBinary({ profile: 'generic', sequence: 'plain-exit' });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-routing-settings-'));
  const projectName = basename(projectDir);
  const project = await window.evaluate((path) => window.cc.projects.add(path), projectDir);
  expect(project.ok).toBe(true);
  if (!project.ok) return;
  const projectId = project.value.id;

  try {
    await window.evaluate(() => window.cc.config.set({
      harnessOpenCodeEnabled: true,
      defaultHarness: 'opencode',
      opencodeBinary: undefined
    }));
    await window.evaluate((bin) => window.cc.config.set({ opencodeBinary: bin }), openCode.path);
    await window.locator('[data-testid="nav-settings"]').click();
    await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
    await expect(window.locator('.settings-header')).toContainText('Code Harness');

    // Updating binary config does not retroactively change boot-time availability.
    // Re-open tab after its mount-time probe sees our deterministic fake binary.
    await window.locator('[data-testid="nav-agents"]').click();
    await window.locator('[data-testid="nav-settings"]').click();
    await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();

    const globalOpenCode = window.locator('.opener-row').filter({ hasText: 'OpenCode' });
    await globalOpenCode.locator('.opener-row-expand').click();
    const globalProvider = globalOpenCode.getByRole('button', { name: 'Default provider' });
    const globalModel = globalOpenCode.getByRole('button', { name: 'Default model level' });
    const globalExecution = globalOpenCode.getByRole('button', { name: 'Default execution state' });
    await selectPicklistOption(globalProvider, window, 'Default provider', 'Anthropic');
    await selectPicklistOption(globalModel, window, 'Default model level', 'Sonnet [Medium]', 'Sonnet');
    await selectPicklistOption(globalExecution, window, 'Default execution state', 'plan [Plan]');
    await expect(globalProvider).toContainText('Anthropic');
    await expect(globalModel).toContainText('Sonnet [Medium]');
    await expect(globalExecution).toContainText('plan [Plan]');
    await expect.poll(() => window.evaluate(() => window.cc.config.get())).toMatchObject({
      harnessRouting: {
        byAdapter: {
          opencode: {
            providerTargetId: 'anthropic',
            modelTargetId: 'aisuite/us.anthropic.claude-sonnet-5',
            executionState: 'plan'
          }
        }
      }
    });
    await selectPicklistOption(globalProvider, window, 'Default provider', 'Use harness default');
    await expect(globalProvider).toContainText('Use harness default');
    await expect(globalModel).toContainText('Use harness default');

    await window.locator('[data-testid="nav-projects"]').click();
    await window.locator('button[aria-label="Reload project list"]').click();
    await window.locator('[data-testid="nav-settings"]').click();
    await window.locator('.settings-section-item').filter({ hasText: 'Project settings' }).click();
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
    await selectPicklistOption(projectProvider, window, 'Default provider', 'Google');
    await selectPicklistOption(projectModel, window, 'Default model level', 'Gemini Flash [Low]', 'Gemini Flash');
    await selectPicklistOption(projectExecution, window, 'Default execution state', 'build + auto-approve [Autonomous]');
    await expect(projectProvider).toContainText('Google');
    await expect(projectModel).toContainText('Gemini Flash [Low]');
    await expect(projectExecution).toContainText('build + auto-approve [Autonomous]');
    await expect.poll(() => window.evaluate((id) => window.cc.projectSettings.get(id), projectId)).toMatchObject({
      harnessRouting: {
        byAdapter: {
          opencode: {
            providerTargetId: 'google',
            modelTargetId: 'aisuite/gemini-3.5-flash',
            executionState: 'autonomous'
          }
        }
      }
    });
    await selectPicklistOption(projectProvider, window, 'Default provider', 'Use global default');
    await expect(projectProvider).toContainText('Use global default');
    await expect(projectModel).toContainText('Use global default');
  } finally {
    await window.evaluate(async (id) => {
      await window.cc.projects.remove(id);
      await window.cc.config.set({ defaultHarness: undefined, harnessRouting: undefined, opencodeBinary: undefined });
    }, projectId);
    openCode.cleanup();
    rmSync(projectDir, { recursive: true, force: true });
  }
});
