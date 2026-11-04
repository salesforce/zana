import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, dismissConsentOverlays, isAppRendererUrl } from './fixtures/app.js';

test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { sponsorPromptDismissed: true, composerShowModern: true, composerShowCliAgent: true }
});

test('a project chat icon overrides another project selection and retained launcher picks', async ({ app }) => {
  const { window: page, home } = app;
  await dismissConsentOverlays(page);
  const names = ['Previously selected project', 'Clicked chat project'];
  for (const name of names) {
    const path = join(home, name);
    mkdirSync(path);
    await page.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
    }, path);
  }
  const heading = page.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await page.locator('.sidebar-projects').getByRole('button', { name: `Open ${names[0]}`, exact: true }).click();
  // Home has the global project tree even after a different project was focused.
  await page.evaluate(() => {
    history.pushState({}, '', '/');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/$/);
  const previousUrl = page.url();
  const launcher = page.getByTestId('launch-modal');
  const project = launcher.getByRole('button', { name: 'Machine and project', exact: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    const icon = page.getByRole('button', { name: `New agent in ${names[1]}`, exact: true });
    await icon.locator('..').hover();
    await icon.click();
    await expect(launcher).toHaveCount(1);
    for (const mode of ['Modern', 'CLI Agent']) {
      await launcher.getByRole('button', { name: mode, exact: true }).click();
      await expect(project).toContainText(names[1]);
      await expect(project).toBeEnabled();
    }
    await expect(page).toHaveURL(previousUrl);
    // A deliberate picker change must not become the default next time this
    // project's icon is clicked, even when its draft is retained.
    await project.click();
    await page.getByRole('option', { name: names[0], exact: false }).click();
    await expect(project).toContainText(names[0]);
    await page.keyboard.press('Escape');
    await expect(launcher).toBeHidden();
  }
});

test('project New Chat navigates to the full-page composer across views and project windows', async ({ app }, testInfo) => {
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
    const composer = page.getByTestId('new-thread-view');
    await expect(composer).toBeVisible();
    await expect(page.getByTestId('launch-modal')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/threads/new`));
    await expect(rail.getByTestId('project-nav-home')).toHaveClass(/active/);
    await expect(rail.getByTestId('project-nav-agents')).not.toHaveClass(/\bactive\b/);
    for (const mode of ['Modern', 'CLI Agent']) {
      await composer.getByRole('button', { name: mode, exact: true }).click();
      const project = composer.getByRole('button', { name: 'Machine and project', exact: true });
      await expect(project).toContainText(projectName);
      await expect(project).toBeDisabled();
    }
    await page.getByRole('button', { name: 'Go back', exact: true }).click();
    await expect(page).toHaveURL(previousUrl);
  }

  const rail = window.locator('.project-scoped-nav');
  for (const destination of ['terminals', 'inbox']) {
    await rail.getByTestId(`project-nav-${destination}`).click();
    await checkNewChat(window);
  }
  await rail.getByRole('link', { name: 'Settings', exact: true }).click();
  await checkNewChat(window);

  // The collapsed action and keyboard shortcut keep the same project context.
  await window.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await window.getByTestId('sidebar-collapsed-new-chat').click();
  await expect(window.getByTestId('new-thread-view')).toBeVisible();
  await expect(window).toHaveURL(new RegExp(`/projects/${projectId}/threads/new`));
  await window.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await rail.getByTestId('project-nav-terminals').click();
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+n' : 'Control+n');
  await expect(window).toHaveURL(new RegExp(`/projects/${projectId}/threads/new`));
  await expect(window.getByTestId('launch-modal')).toHaveCount(0);
  await window.screenshot({ path: testInfo.outputPath('project-new-chat.png') });

  // Navigation retains this project's draft and keeps it separate from Home.
  const editor = window.getByTestId('new-thread-view').getByTestId('legacy-agent-command-input');
  await editor.fill('Project draft survives navigation');
  await rail.getByTestId('project-nav-terminals').click();
  await rail.getByTestId('project-nav-home').click();
  await expect(editor).toHaveText('Project draft survives navigation');

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
