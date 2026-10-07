import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, dismissConsentOverlays, isAppRendererUrl } from './fixtures/app.js';

test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { sponsorPromptDismissed: true, composerShowModern: true, composerShowCliAgent: true }
});

test('project New Chat keeps the current project selected across views and project windows', async ({ app }) => {
  const { window, home, electron } = app;
  await dismissConsentOverlays(window);
  const projectName = 'Project Chat Target';
  const path = join(home, projectName);
  mkdirSync(path);
  const projectId = await window.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, path);
  const heading = window.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await window.locator('.sidebar-projects').getByRole('button', { name: `Open ${projectName}`, exact: true }).click();

  async function checkNewChat(page: Page) {
    const rail = page.locator('.project-scoped-nav');
    const previousUrl = page.url();
    await rail.getByRole('link', { name: 'New Chat', exact: true }).click();
    const launcher = page.getByTestId('launch-modal');
    await expect(launcher).toHaveCount(1);
    await expect(launcher).toBeVisible();
    for (const mode of ['Modern', 'CLI Agent']) {
      await launcher.getByRole('button', { name: mode, exact: true }).click();
      const project = launcher.getByRole('button', { name: 'Project', exact: true });
      await expect(project).toContainText(projectName);
      await expect(project).toBeDisabled();
    }
    await expect(page).toHaveURL(previousUrl);
    await page.keyboard.press('Escape');
    await expect(launcher).toHaveCount(0);
  }

  const rail = window.locator('.project-scoped-nav');
  for (const destination of ['terminals', 'inbox']) {
    await rail.getByTestId(`project-nav-${destination}`).click();
    await checkNewChat(window);
  }
  await rail.getByRole('link', { name: 'Settings', exact: true }).click();
  await checkNewChat(window);

  await window.evaluate((id) => window.cc.windows.openProject(id), projectId);
  let projectWindow: Page | undefined;
  await expect.poll(() => {
    projectWindow = electron.windows().find((page) => page !== window && isAppRendererUrl(page.url()));
    return Boolean(projectWindow);
  }).toBe(true);
  const scoped = projectWindow!;
  await expect(scoped.locator('.project-scoped-nav')).toBeVisible();
  await checkNewChat(scoped);
});
