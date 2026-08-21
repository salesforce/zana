/**
 * Opening a project in the main window puts workspace modes (Agents, Terminals,
 * Scheduler, …) on the left ProjectScopedNav rail — not a horizontal tab strip
 * above the content.
 */
import { test, expect } from './fixtures/app.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test('selecting a project puts workspace modes in the side panel', async ({ app }) => {
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-proj-rail-'));
  const projectName = basename(projectDir);
  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
      id: string;
    };
    return proj.id;
  }, projectDir);
  expect(projectId).toBeTruthy();

  try {
    const projectsNav = window.locator('button.nav-item').filter({ hasText: 'Projects' });
    await projectsNav.first().click();
    await window.locator('button[aria-label="Reload project list"]').click();
    const filter = window.locator('.list-filter input');
    if (await filter.count()) {
      await filter.fill(projectName);
    }
    const row = window.locator('.project-item').filter({ hasText: projectName }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    const rail = window.locator('.project-scoped-nav.project-focused-nav');
    await expect(rail).toBeVisible({ timeout: 15_000 });
    await expect(rail.getByRole('button', { name: /Agents section/ })).toBeVisible();
    await expect(rail.getByRole('button', { name: 'Open Agents dashboard' })).toBeVisible();
    await expect(rail.getByRole('button', { name: 'New quick agent' })).toBeVisible();
    await expect(rail.getByRole('status', { name: 'No active agents' })).toBeVisible();
    await expect(rail.getByRole('button', { name: /^Terminals/ })).toBeVisible();
    await expect(rail.getByRole('button', { name: /^Scheduler/ })).toBeVisible();
    await expect(window.locator('.workspace-mode-segmented')).toHaveCount(0);

    await rail.getByRole('button', { name: /^Scheduler/ }).click();
    await expect(window.locator('.scheduler-panel--embedded')).toBeVisible({ timeout: 15_000 });
    await expect(window.getByRole('heading', { name: 'Project schedules' })).toBeVisible();
  } finally {
    await window.evaluate(async (pid) => {
      try {
        await window.cc.projects.remove(pid);
      } catch {
        /* best-effort cleanup */
      }
    }, projectId);
  }
});
