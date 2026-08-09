import { test, expect } from './fixtures/app';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Global and Project harness settings persist provider, model, execution, and reset flows', async ({ app }) => {
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-routing-settings-'));
  const project = await window.evaluate((path) => window.cc.projects.add(path), projectDir);
  expect(project.ok).toBe(true);
  if (!project.ok) return;
  const projectId = project.value.id;

  try {
    await window.evaluate(() => window.cc.config.set({
      harnessOpenCodeEnabled: true,
      defaultHarness: 'opencode'
    }));
    await window.locator('[data-testid="nav-settings"]').click();
    await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
    await expect(window.locator('.settings-header')).toContainText('Code Harness');

    const globalOpenCode = window.locator('.opener-row').filter({ hasText: 'OpenCode' });
    await globalOpenCode.locator('.opener-row-expand').click();
    const globalSelects = globalOpenCode.locator('.settings-field select');
    await expect(globalSelects).toHaveCount(3);
    await globalSelects.nth(0).selectOption('anthropic');
    await globalSelects.nth(1).selectOption('aisuite/us.anthropic.claude-sonnet-5');
    await globalSelects.nth(2).selectOption('plan');
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
    await globalSelects.nth(0).selectOption('');
    await expect(globalSelects.nth(1)).toHaveValue('');

    await window.locator('[data-testid="nav-projects"]').click();
    await window.locator('button[aria-label="Reload project list"]').click();
    await window.locator('[data-testid="nav-settings"]').click();
    await window.locator('.settings-section-item').filter({ hasText: 'Project settings' }).click();
    const scope = window.locator('.settings-scope-select');
    if (await scope.count()) await scope.selectOption(projectId);
    const projectOpenCode = window.locator('.opener-row').filter({ hasText: 'OpenCode' });
    await projectOpenCode.locator('.opener-row-expand').click();
    const projectSelects = projectOpenCode.locator('.settings-field select');
    await projectSelects.nth(0).selectOption('google');
    await projectSelects.nth(1).selectOption('aisuite/gemini-3.5-flash');
    await projectSelects.nth(2).selectOption('autonomous');
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
    await projectSelects.nth(0).selectOption('');
    await expect(projectSelects.nth(1)).toHaveValue('');
  } finally {
    await window.evaluate(async (id) => {
      await window.cc.projects.remove(id);
      await window.cc.config.set({ defaultHarness: undefined, harnessRouting: undefined });
    }, projectId);
    rmSync(projectDir, { recursive: true, force: true });
  }
});
