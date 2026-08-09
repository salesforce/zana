/**
 * Verifies the cross-window config-sync fix: toggling a feature flag in ONE
 * window must flip the mirrored gate in EVERY other window live (no reload).
 *
 * Regression under test: `config:set` used to update main's store + the
 * toggling window only — it broadcast nothing — so a per-project window kept a
 * stale `followUpsEnabled` and went on rendering the Follow-ups tab until it
 * reloaded. The fix adds a `config:onChanged` broadcast that each window's
 * store re-applies.
 *
 * We drive the REAL two-window flow: register a project, open a second window
 * locked to it, enable Follow-ups from the main window, assert the tab appears
 * in the project window, then DISABLE it and assert the tab disappears there
 * live. Both toggles cross the window boundary, so we cover show + hide.
 */
import { test, expect } from './fixtures/app';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';

test('config: toggling Follow-ups in one window flips the tab in another live', async ({
  app,
}) => {
  const { window, electron } = app;

  // A real, registered project the second window can lock to. NOTE (as in
  // scheduler-open.spec): on macOS the app resolves ~/.zcc via
  // app.getPath('home'), ignoring the sandbox HOME — so this lands in the real
  // projects.json. Removed in the finally block to leave no trace.
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-cfgsync-proj-'));
  const projectName = basename(projectDir);
  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    const proj = (res && 'ok' in res ? (res as any).value : res) as { id: string };
    return proj.id;
  }, projectDir);
  expect(projectId).toBeTruthy();

  // Start from a known state: Follow-ups OFF everywhere.
  await window.evaluate(() => window.cc.config.set({ followUpsEnabled: false }));

  try {
    // Teach the main window's renderer store about the project (raw projects.add
    // persists in main but doesn't broadcast projects:onChanged).
    const projectsNav = window.locator('button.nav-item').filter({ hasText: 'Projects' });
    await projectsNav.first().click();
    await window.locator('button[aria-label="Reload project list"]').click();
    const filter = window.locator('.list-filter input');
    await filter.fill(projectName);
    await expect(
      window.locator('.project-item').filter({ hasText: projectName }).first()
    ).toBeVisible({ timeout: 15_000 });

    // Open a SECOND window, locked to the project (the "Open in New Window"
    // gesture). Grab its Page handle: it's the app window whose URL carries the
    // scoped projectId and isn't the main window we already hold.
    await window.evaluate((pid) => window.cc.windows.openProject(pid), projectId);
    let projectWindow: Page | undefined;
    await expect
      .poll(
        () => {
          projectWindow = electron
            .windows()
            .find((w) => w !== window && w.url().includes('index.html'));
          return projectWindow ? 'opened' : 'waiting';
        },
        { timeout: 20_000 }
      )
      .toBe('opened');
    const pw = projectWindow!;
    await pw.waitForSelector('#root', { timeout: 30_000 });

    // The project window's rail shows the built-in project modes. With
    // Follow-ups OFF, there is no Follow-ups tab.
    const followupsTab = pw
      .locator('.project-scoped-nav .nav-item-label', { hasText: 'Follow-ups' });
    await expect(followupsTab).toHaveCount(0);

    // ── ENABLE from the MAIN window ──────────────────────────────────────────
    // This is the cross-window path: the toggle happens in `window`, but the
    // gate must flip in `pw` with no reload.
    await window.evaluate(() => window.cc.config.set({ followUpsEnabled: true }));
    await expect(followupsTab).toHaveCount(1, { timeout: 10_000 });
    await expect(followupsTab.first()).toBeVisible({ timeout: 10_000 });
    await pw
      .locator('.project-scoped-nav')
      .screenshot({ path: 'e2e-artifacts/rail-followups-enabled.png' });

    // ── DISABLE from the MAIN window (the reported bug) ─────────────────────
    // "When disabling the follow up, I still see them in the menu." The tab must
    // now vanish from the project window live.
    await window.evaluate(() => window.cc.config.set({ followUpsEnabled: false }));
    await expect(followupsTab).toHaveCount(0, { timeout: 10_000 });
    await pw
      .locator('.project-scoped-nav')
      .screenshot({ path: 'e2e-artifacts/rail-followups-disabled.png' });
  } finally {
    await window.evaluate(async (pid) => {
      try {
        await window.cc.config.set({ followUpsEnabled: false });
      } catch {
        /* best-effort */
      }
      try {
        await window.cc.projects.remove(pid);
      } catch {
        /* best-effort cleanup */
      }
    }, projectId);
  }
});
