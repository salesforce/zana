import { test, expect } from './fixtures/app';
import { makeFakeAgentBinary } from './sdk/harness';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

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
    await globalProvider.click();
    await window.getByRole('listbox', { name: 'Default provider' }).getByRole('option', { name: 'Anthropic', exact: true }).click();
    await globalModel.click();
    await window.getByRole('listbox', { name: 'Default model level' }).getByRole('option', { name: 'Sonnet [Medium]', exact: true }).click();
    await globalExecution.click();
    await window.getByRole('listbox', { name: 'Default execution state' }).getByRole('option', { name: 'plan [Plan]', exact: true }).click();
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
    await globalProvider.click();
    await window.getByRole('listbox', { name: 'Default provider' }).getByRole('option', { name: 'Use harness default', exact: true }).click();
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
    const projectOpenCode = window.locator('.opener-row').filter({ hasText: 'OpenCode' });
    await projectOpenCode.locator('.opener-row-expand').click();
    const projectProvider = projectOpenCode.getByRole('button', { name: 'Default provider' });
    const projectModel = projectOpenCode.getByRole('button', { name: 'Default model level' });
    const projectExecution = projectOpenCode.getByRole('button', { name: 'Default execution state' });
    await projectProvider.click();
    await window.getByRole('listbox', { name: 'Default provider' }).getByRole('option', { name: 'Google', exact: true }).click();
    await projectModel.click();
    await window.getByRole('listbox', { name: 'Default model level' }).getByRole('option', { name: 'Gemini Flash [Low]', exact: true }).click();
    await projectExecution.click();
    await window.getByRole('listbox', { name: 'Default execution state' }).getByRole('option', { name: 'build + auto-approve [Autonomous]', exact: true }).click();
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
    await projectProvider.click();
    await window.getByRole('listbox', { name: 'Default provider' }).getByRole('option', { name: 'Use global default', exact: true }).click();
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
