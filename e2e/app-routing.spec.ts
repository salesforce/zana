/**
 * Path routing: the built app serves unknown GETs as index.html, and the
 * shell reflects `/inbox` (and friends) in the rail.
 */
import { isAppRendererUrl, test, expect } from './fixtures/app.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';

test('deep-linking /inbox selects the Inbox rail', async ({ app }) => {
  const { window } = app;
  const origin = new URL(window.url()).origin;
  await window.goto(`${origin}/inbox`);
  await expect(window.getByTestId('nav-inbox')).toHaveAttribute('aria-current', 'page', {
    timeout: 15_000
  });
  await expect(window).toHaveURL(/\/inbox$/);
});

test('deep-linking /settings lands on the Settings rail', async ({ app }) => {
  const { window } = app;
  const origin = new URL(window.url()).origin;
  await window.goto(`${origin}/settings`);
  await expect(window.locator('aside.settings-pane')).toBeVisible({ timeout: 15_000 });
  await expect(window).toHaveURL(/\/settings/);
});

test('/extensions redirects to the installed plugins catalogue', async ({ app }) => {
  const { window } = app;
  const origin = new URL(window.url()).origin;
  await window.goto(`${origin}/extensions`);
  await expect(window).toHaveURL(/\/extensions\/plugins$/, { timeout: 15_000 });
  await expect(window.locator('aside.extensions-pane')).toBeVisible();
});

test('a project-locked window cannot leave /projects/:id', async ({ app }) => {
  const { window, electron } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-route-lock-'));
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
    const projectsNav = window.locator('.nav-item').filter({ hasText: 'Projects' });
    await projectsNav.first().click();
    await window.locator('button[aria-label="Reload project list"]').click();
    const filter = window.locator('.list-filter input');
    if (await filter.count()) {
      await filter.fill(projectName);
    }
    await expect(
      window.locator('.project-item').filter({ hasText: projectName }).first()
    ).toBeVisible({ timeout: 15_000 });

    await window.evaluate((pid) => window.cc.windows.openProject(pid), projectId);
    let projectWindow: Page | undefined;
    await expect
      .poll(
        () => {
          projectWindow = electron
            .windows()
            .find((w) => w !== window && isAppRendererUrl(w.url()));
          return projectWindow ? 'opened' : 'waiting';
        },
        { timeout: 20_000 }
      )
      .toBe('opened');
    const pw = projectWindow!;
    await pw.waitForSelector('#root', { timeout: 30_000 });
    await expect(pw).toHaveURL(new RegExp(`/projects/${projectId}`), { timeout: 15_000 });
    await expect(pw).toHaveURL(/projectId=/);
    await expect(pw.locator('.project-scoped-nav')).toBeVisible({ timeout: 15_000 });

    const origin = new URL(pw.url()).origin;
    await pw.goto(`${origin}/inbox`);
    await expect(pw).toHaveURL(new RegExp(`/projects/${projectId}`), { timeout: 15_000 });
    await expect(pw).toHaveURL(/[?&]projectId=/);
    await expect(pw.locator('.project-scoped-nav')).toBeVisible();
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
