import { test, expect } from './fixtures/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test('Named checks use compact visible editors, persist global and project scopes, and restore inheritance', async ({ app }) => {
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-named-checks-settings-'));
  const project = await window.evaluate((path) => window.cc.projects.add(path), projectDir);
  expect(project.ok).toBe(true);
  if (!project.ok) return;
  const projectId = project.value.id;
  const projectName = basename(projectDir);
  const globalCheck = { name: 'global_check', command: 'test-global-command --flag' };
  const projectCheck = { name: 'global_check', command: 'test-project-command --override' };

  try {
    await window.getByRole('link', { name: 'Settings', exact: true }).click();
    await window.getByTestId('settings-nav-global').click();
    const globalSection = window.locator('[data-settings-target="global.named-checks"]');
    await expect(globalSection).toBeVisible();
    await expect(globalSection.getByRole('heading', { name: 'Named checks', exact: true })).toBeVisible();
    await expect(globalSection.locator('.named-checks-list')).toHaveCount(0);

    await globalSection.getByRole('button', { name: 'Add check' }).click();
    const name = globalSection.getByLabel('Check name 1');
    const command = globalSection.getByLabel('Command 1');
    await expect(name).toBeFocused();
    await name.fill('2invalid');
    await command.fill(globalCheck.command);
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(globalSection).toContainText('Start with a letter or underscore; use letters, numbers, underscores or hyphens. Maximum 100 characters.');
    await expect(globalSection.getByRole('button', { name: 'Save checks' })).toBeDisabled();

    await name.fill(globalCheck.name);
    await expect(name).toHaveAttribute('aria-invalid', 'false');
    await globalSection.getByRole('button', { name: 'Done editing' }).click();
    await expect(globalSection.getByLabel('Check name 1')).toHaveCount(0);
    await expect(globalSection.getByLabel('Command 1')).toHaveCount(0);
    const globalRow = globalSection.locator('.named-checks-item').filter({ hasText: globalCheck.name });
    await expect(globalRow).toContainText('Global');
    await expect(globalRow.locator('.named-checks-row')).toHaveCSS('display', 'grid');
    await expect(globalSection.getByRole('button', { name: 'Save checks' })).toBeEnabled();
    await globalSection.getByRole('button', { name: 'Save checks' }).click();
    await expect(globalSection.getByText('Checks saved.', { exact: true })).toBeVisible();
    await expect.poll(() => window.evaluate(() => window.cc.namedChecks.get({ kind: 'global' }))).toEqual([globalCheck]);

    await window.getByRole('link', { name: 'Project settings', exact: true }).click();
    await expect(window.getByRole('heading', { name: 'Project settings', exact: true })).toBeVisible();
    const scope = window.getByRole('button', { name: 'Project', exact: true });
    await scope.click();
    await window.getByRole('listbox', { name: 'Project' }).getByRole('option', { name: projectName, exact: true }).click();
    await expect(scope).toContainText(projectName);

    const projectSection = window.locator('[data-settings-target="project.named-checks"]');
    await expect(projectSection).toBeVisible();
    const inherited = projectSection.locator('.named-checks-item').filter({ hasText: globalCheck.name });
    await expect(inherited).toContainText('Inherited');
    await inherited.getByRole('button', { name: `Override ${globalCheck.name}` }).click();
    await expect(projectSection.getByLabel('Check name 1')).toHaveValue(globalCheck.name);
    await projectSection.getByLabel('Command 1').fill(projectCheck.command);
    await projectSection.getByRole('button', { name: 'Done editing' }).click();
    const override = projectSection.locator('.named-checks-item').filter({ hasText: projectCheck.command });
    await expect(override).toContainText('Project override');
    await projectSection.getByRole('button', { name: 'Save checks' }).click();
    await expect(projectSection.getByText('Checks saved.', { exact: true })).toBeVisible();
    await expect.poll(() => window.evaluate((id) => window.cc.namedChecks.get({ kind: 'project', projectId: id }), projectId)).toEqual([projectCheck]);

    await override.getByRole('button', { name: 'Remove check 1' }).click();
    await expect(projectSection.locator('.named-checks-item').filter({ hasText: globalCheck.name })).toContainText('Inherited');
    await expect(projectSection.getByRole('button', { name: 'Save checks' })).toBeEnabled();
    await projectSection.getByRole('button', { name: 'Save checks' }).click();
    await expect.poll(() => window.evaluate((id) => window.cc.namedChecks.get({ kind: 'project', projectId: id }), projectId)).toEqual([]);
  } finally {
    await window.evaluate((id) => window.cc.projects.remove(id), projectId);
    rmSync(projectDir, { recursive: true, force: true });
  }
});
