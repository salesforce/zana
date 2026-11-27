import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('the expanded desktop sidebar fits more rows and keeps both lines of each thread', async ({ app }) => {
  const win = app.window;
  const directory = join(app.home, 'sidebar-density-project');
  mkdirSync(directory);
  const threadId = await win.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', title: 'Sidebar density sample', input: 'Hello' })
    });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    return (result.thread ?? result.value).id as string;
  }, directory);

  await win.getByTestId('nav-inbox').click();
  const sidebar = win.locator('.sidebar--global');
  const filter = sidebar.getByRole('textbox', { name: 'Filter machines, projects or chats' });
  const project = sidebar.locator('.project-item').filter({ has: win.getByRole('button', { name: 'Open sidebar-density-project', exact: true }) });
  const thread = sidebar.getByRole('button', { name: 'Sidebar density sample', exact: true });
  await expect(win.locator('.app-shell')).toHaveAttribute('data-mobile', 'false');
  await expect(filter).toBeInViewport();
  await expect(thread).toBeInViewport();
  await expect(sidebar.getByTestId('nav-inbox')).toHaveCSS('min-height', '26px');
  await expect(sidebar.locator('.machine-project-heading').first()).toHaveCSS('min-height', '28px');
  await expect(project).toHaveCSS('min-height', '26px');

  const [projectBox, threadBox] = await Promise.all([project.boundingBox(), thread.boundingBox()]);
  expect(projectBox!.height).toBeLessThan(30);
  expect(Math.round(threadBox!.height)).toBe(31);
  await expect(thread.locator('.project-terminal-name')).toHaveText('Sidebar density sample');
  await expect(thread.locator('.project-terminal-detail')).toContainText('· Thread');
  expect(await thread.evaluate((row) => {
    const bounds = row.getBoundingClientRect();
    const title = row.querySelector('.project-terminal-name')!.getBoundingClientRect();
    const detail = row.querySelector('.project-terminal-detail')!.getBoundingClientRect();
    return bounds.top <= title.top && title.bottom <= detail.top && detail.bottom <= bounds.bottom;
  })).toBe(true);
  await thread.click();
  await expect(win).toHaveURL(new RegExp('/threads/' + threadId + '$'));
});
