/**
 * Clicking a schedule opens the dedicated workbench (editor + secondary panel).
 * "Open in split" from the catalogue seeds the catalogue beside the detail.
 */
import { test, expect } from './fixtures/app.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test('scheduler: clicking a row opens the schedule workbench', async ({ app }) => {
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-sched-detail-'));
  const projectName = basename(projectDir);
  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    const proj = (res && 'ok' in res ? (res as { value?: { id: string } }).value : res) as { id: string };
    return proj.id;
  }, projectDir);
  expect(projectId).toBeTruthy();

  try {
    await window.locator('.nav-item').filter({ hasText: 'Projects' }).first().click();
    await window.locator('button[aria-label="Reload project list"]').click();
    await window.locator('.list-filter input').fill(projectName);
    await expect(
      window.locator('.project-item').filter({ hasText: projectName }).first()
    ).toBeVisible({ timeout: 15_000 });

    await window.evaluate(async (pid) => {
      await window.cc.scheduler.create({
        name: 'E2E detail-me',
        projectId: pid,
        profile: 'shell',
        every: '1h',
        enabled: false,
        inboxLevel: 'silent'
      });
    }, projectId);

    await window.locator('.nav-item').filter({ hasText: 'Scheduler' }).first().click();
    await window.locator('.scheduler-subview-toggle button', { hasText: 'Schedules' }).click();
    const row = window.locator('.scheduler-card').filter({ hasText: 'E2E detail-me' });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.locator('.scheduler-card-main').click();

    await expect(window.locator('[data-testid="schedule-detail"]')).toBeVisible({ timeout: 15_000 });
    await expect(window.locator('[data-testid="schedule-editor"]')).toBeVisible();
    await expect(window.locator('[data-testid="thread-secondary-panel"]')).toBeVisible();
    await expect(window.locator('#sched-name')).toHaveValue('E2E detail-me');
  } finally {
    await window.evaluate(async (pid) => {
      try {
        const list = await window.cc.scheduler.list();
        const tasks = (list && 'ok' in (list as object) ? (list as { value: Array<{ id: string; name?: string; projectId?: string }> }).value : list) as Array<{
          id: string;
          name?: string;
          projectId?: string;
        }>;
        for (const t of tasks) {
          if (t.name === 'E2E detail-me' && t.projectId === pid) {
            await window.cc.scheduler.delete(t.id);
          }
        }
      } catch {
        /* best-effort */
      }
      try {
        await window.cc.projects.remove(pid);
      } catch {
        /* best-effort */
      }
    }, projectId);
  }
});

test('scheduler: Open in split seeds the catalogue beside the schedule', async ({ app }) => {
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-sched-split-'));
  const projectName = basename(projectDir);
  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    const proj = (res && 'ok' in res ? (res as { value?: { id: string } }).value : res) as { id: string };
    return proj.id;
  }, projectDir);
  expect(projectId).toBeTruthy();

  try {
    await window.locator('.nav-item').filter({ hasText: 'Projects' }).first().click();
    await window.locator('button[aria-label="Reload project list"]').click();
    await window.locator('.list-filter input').fill(projectName);
    await expect(
      window.locator('.project-item').filter({ hasText: projectName }).first()
    ).toBeVisible({ timeout: 15_000 });

    await window.evaluate(async (pid) => {
      await window.cc.scheduler.create({
        name: 'E2E split-me',
        projectId: pid,
        profile: 'shell',
        every: '1h',
        enabled: false,
        inboxLevel: 'silent'
      });
    }, projectId);

    await window.locator('.nav-item').filter({ hasText: 'Scheduler' }).first().click();
    await window.locator('.scheduler-subview-toggle button', { hasText: 'Schedules' }).click();
    const row = window.locator('.scheduler-card').filter({ hasText: 'E2E split-me' });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.locator('.scheduler-card-main').click({ button: 'right' });
    await window.locator('[role="menuitem"]', { hasText: 'Open in split' }).click();

    await expect(window.locator('.split-workspace')).toBeVisible({ timeout: 15_000 });
    await expect(window.locator('[data-testid="schedule-detail"]')).toBeVisible();
    await expect(window.locator('.scheduler-page')).toBeVisible();
    await expect(window.locator('.split-pane')).toHaveCount(2);
  } finally {
    await window.evaluate(async (pid) => {
      try {
        const list = await window.cc.scheduler.list();
        const tasks = (list && 'ok' in (list as object) ? (list as { value: Array<{ id: string; name?: string; projectId?: string }> }).value : list) as Array<{
          id: string;
          name?: string;
          projectId?: string;
        }>;
        for (const t of tasks) {
          if (t.name === 'E2E split-me' && t.projectId === pid) {
            await window.cc.scheduler.delete(t.id);
          }
        }
      } catch {
        /* best-effort */
      }
      try {
        await window.cc.projects.remove(pid);
      } catch {
        /* best-effort */
      }
    }, projectId);
  }
});
