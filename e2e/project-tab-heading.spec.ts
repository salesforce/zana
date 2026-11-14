import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, dismissConsentOverlays } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import { createDemoVideo } from './sdk/demo-video.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true }, isolateBundledCatalog: true });

test('project name precedes empty and populated tabs, updates live and preserves project actions', async ({ app }, testInfo) => {
  const { window: page } = app;
  await dismissConsentOverlays(page);
  const demo = process.env.ZCC_E2E_RECORD_VIDEO ? await createDemoVideo(page) : undefined;
  const showRecordingScene = async (caption: string) => {
    if (!demo) return;
    await demo.caption(caption);
    await page.waitForTimeout(2200);
  };
  if (demo) await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1120, 760));
  const root = join(app.home, 'Project heading');
  mkdirSync(root);
  const project = await page.evaluate(async root => {
    const added = await window.cc.projects.add(root);
    if (!added.ok) throw new Error(added.message);
    return added.value;
  }, root);
  const route = async (path: string) => page.evaluate(path => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await route(`/projects/${project.id}`);
  const bar = page.getByTestId('application-tabs');
  const heading = bar.getByTestId('titlebar-project');
  await expect(heading).toHaveText('Project heading');
  await expect(bar.locator('.titlebar-threads-empty')).toBeVisible();
  await expect(bar.getByRole('tab')).toHaveCount(0);
  if (demo) await demo.flash();
  await showRecordingScene('The project name appears before the tabs, even with no open tabs.');
  await heading.click();
  await expect(page.getByRole('group', { name: 'Project actions for Project heading' })).toBeVisible();
  await showRecordingScene('Click the project name to open its actions.');
  await page.keyboard.press('Escape');
  await expect(heading).toHaveAttribute('aria-expanded', 'false');

  const threadId = await page.evaluate(async projectId => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'fake', title: 'Review navigation', input: 'Hello' })
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  }, project.id);
  await route(`/projects/${project.id}/threads/${threadId}`);
  await expect(bar.getByRole('tab', { name: /Review navigation/ })).toBeVisible();
  const headingBox = await heading.boundingBox();
  const stripBox = await bar.getByRole('tablist').boundingBox();
  expect(headingBox!.x + headingBox!.width).toBeLessThan(stripBox!.x);
  await showRecordingScene('The project stays in place when you open a thread.');

  const longName = 'Customer Success Platform — Development and Integrations';
  await page.evaluate(({ id, name }) => window.cc.projects.update(id, { name }), { id: project.id, name: longName });
  await expect(heading).toHaveText(longName);
  await showRecordingScene('Renaming the project updates the heading immediately.');
  await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(840, 700));
  await expect.poll(() => heading.locator('.titlebar-project-name').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(bar.getByRole('button', { name: 'New thread', exact: true })).toBeVisible();
  await expect(bar.getByLabel('All open tabs')).toBeVisible();
  await showRecordingScene('Long names truncate cleanly in a narrow window.');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('project-name-before-tabs.png'));
  await route('/agents');
  await expect(heading).toHaveCount(0);
  await expect(bar.getByRole('tab')).toHaveCount(1);
  await showRecordingScene('Global pages hide the project heading.');
  await route(`/projects/${project.id}`);
  await expect(heading).toHaveText(longName);
  await showRecordingScene('Return to the project and its heading comes back.');
  await heading.click();
  await page.getByRole('button', { name: 'Project settings…', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/settings`));
  await showRecordingScene('Project settings remain one click away.');
});
