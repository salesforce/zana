/**
 * Verifies the restored CRON authoring UI end-to-end, through the real renderer
 * DOM (not IPC): open the "New schedule" modal, switch the cadence toggle to
 * Cron, type an expression, and assert the live-validation + next-fires preview
 * react as the user types. Then save through the real Create button and confirm
 * the persisted schedule carries a `cron` cadence (not `every`) — i.e. the form
 * actually round-trips a cron expression into main, which the earlier UI-drop
 * regression made impossible.
 *
 * The cron BACKEND (parse-cron / schedule-spec / scheduler fire logic) is unit
 * tested; this spec's job is the UI seam that was dropped: the toggle, the cron
 * input, its validation, the preview, and the save-path cadence branch.
 */
import { test, expect } from './fixtures/app';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test('scheduler: the Cron cadence UI validates, previews, and saves a cron schedule', async ({
  app,
}) => {
  const { window } = app;

  // A real, registered project the schedule can target. Removed in `finally`.
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-cron-proj-'));
  const projectName = basename(projectDir);
  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    const proj = (res && 'ok' in res ? (res as any).value : res) as { id: string };
    return proj.id;
  }, projectDir);
  expect(projectId).toBeTruthy();

  try {
    // Teach the renderer store about the project (see scheduler-open.spec.ts).
    const projectsNav = window.locator('button.nav-item').filter({ hasText: 'Projects' });
    await projectsNav.first().click();
    await window.locator('button[aria-label="Reload project list"]').click();
    const filter = window.locator('.list-filter input');
    await filter.fill(projectName);
    await expect(
      window.locator('.project-item').filter({ hasText: projectName }).first()
    ).toBeVisible({ timeout: 15_000 });

    // Open the Scheduler and its "New schedule" modal.
    const schedNav = window.locator('button.nav-item').filter({ hasText: 'Scheduler' });
    await schedNav.first().click();
    await window.locator('button', { hasText: 'New schedule' }).first().click();

    const modal = window.locator('[aria-label="New schedule"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    // Name + project so the form can eventually save.
    await modal.locator('#sched-name').fill('E2E cron schedule');
    // Pick our project through the portal-rendered project list.
    const projectPicker = modal.getByRole('button', { name: 'Project' });
    await projectPicker.click();
    await window
      .getByRole('listbox', { name: 'Project' })
      .getByRole('option', { name: projectName, exact: true })
      .click();
    await expect(projectPicker).toContainText(projectName);

    // The cadence toggle starts on Interval → no cron input yet.
    await expect(modal.locator('#sched-cron')).toHaveCount(0);

    // Switch to Cron. The toggle is a tablist with Interval / Cron buttons.
    await modal.locator('[role="tab"]', { hasText: 'Cron' }).click();
    const cronInput = modal.locator('#sched-cron');
    await expect(cronInput).toBeVisible({ timeout: 5_000 });

    // It seeds with a valid default ("0 9 * * 1-5") → live preview shows next fires.
    await expect(modal.locator('.scheduler-interval-feedback--ok')).toContainText('Next:', {
      timeout: 5_000,
    });

    // Type an INVALID expression → validation flips to the error state and the
    // input gets the is-invalid class; the Create button disables.
    await cronInput.fill('not a cron');
    await expect(cronInput).toHaveClass(/is-invalid/, { timeout: 5_000 });
    await expect(modal.locator('.scheduler-interval-feedback--err')).toBeVisible();
    const createBtn = modal.locator('button', { hasText: 'Create schedule' });
    await expect(createBtn).toBeDisabled();

    // Type a VALID expression (every 15 min) → error clears, preview returns.
    await cronInput.fill('*/15 * * * *');
    await expect(cronInput).not.toHaveClass(/is-invalid/, { timeout: 5_000 });
    await expect(modal.locator('.scheduler-interval-feedback--ok')).toContainText('Next:');
    await expect(createBtn).toBeEnabled();

    // Save through the real button.
    await createBtn.click();
    await expect(modal).toHaveCount(0, { timeout: 15_000 });

    // Assert the PERSISTED schedule carries a cron cadence, not an interval —
    // proving the form's save-path cadence branch routed the cron through main.
    await expect
      .poll(
        async () =>
          window.evaluate(async (pid) => {
            const list = await window.cc.scheduler.list();
            const tasks = (list && 'ok' in (list as any) ? (list as any).value : list) as Array<{
              name?: string;
              projectId?: string;
              schedule?: { every?: string; cron?: string };
            }>;
            const mine = tasks.find(
              (t) => t.name === 'E2E cron schedule' && t.projectId === pid
            );
            if (!mine) return 'missing';
            if (mine.schedule?.cron) return `cron:${mine.schedule.cron}`;
            if (mine.schedule?.every) return `every:${mine.schedule.every}`;
            return 'no-cadence';
          }, projectId),
        { timeout: 15_000 }
      )
      .toBe('cron:*/15 * * * *');
  } finally {
    await window.evaluate(async (pid) => {
      try {
        const list = await window.cc.scheduler.list();
        const tasks = (list && 'ok' in (list as any) ? (list as any).value : list) as Array<{
          id: string;
          name?: string;
          projectId?: string;
        }>;
        for (const t of tasks) {
          if (t.name === 'E2E cron schedule' && t.projectId === pid) {
            await window.cc.scheduler.delete(t.id);
          }
        }
      } catch {
        /* best-effort cleanup */
      }
      try {
        await window.cc.projects.remove(pid);
      } catch {
        /* best-effort cleanup */
      }
    }, projectId);
  }
});
