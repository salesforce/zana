import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

async function route(page: Page, path: string): Promise<void> {
  await page.evaluate((next) => {
    history.pushState({}, '', next);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

test('Docs availability follows plugin enabled state', async ({ app, home }) => {
  const win = app.window;
  const projectPath = join(home, 'docs-availability-project');
  mkdirSync(projectPath);

  const projectId = await win.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, projectPath);

  await expect(win.getByTestId('nav-docs')).toBeVisible();
  await route(win, `/projects/${projectId}`);
  await expect(win.getByTestId('project-nav-docs')).toBeVisible();
  await route(win, '/plugins/docs/panel');
  await expect(win.locator('.library-panel')).toBeVisible();

  await win.getByTestId('nav-extensions').click();
  await win.getByTestId('extensions-nav-installed').click();
  await win
    .getByTestId('plugin-row-docs')
    .getByRole('switch', { name: /^Disable Docs/ })
    .click();

  await expect
    .poll(() =>
      win.evaluate(async () => {
        const plugins = await window.cc.pluginApps.list();
        return plugins.find((plugin) => plugin.id === 'docs')?.enabled;
      })
    )
    .toBe(false);
  await expect(win.getByTestId('nav-docs')).toHaveCount(0);

  await route(win, `/projects/${projectId}`);
  await expect(win.getByTestId('project-nav-docs')).toHaveCount(0);
  await route(win, '/plugins/docs/panel');
  await expect(win.locator('.library-panel')).toHaveCount(0);
  await expect(win.getByRole('group', { name: 'Agent composer' })).toBeVisible();

  await win.getByTestId('nav-extensions').click();
  await win.getByTestId('extensions-nav-installed').click();
  await win
    .getByTestId('plugin-row-docs')
    .getByRole('switch', { name: /^Enable Docs/ })
    .click();

  await expect
    .poll(() =>
      win.evaluate(async () => {
        const plugins = await window.cc.pluginApps.list();
        const docs = plugins.find((plugin) => plugin.id === 'docs');
        return `${docs?.enabled}:${docs?.status}:${Boolean(docs?.appUrl)}`;
      })
    )
    .toBe('true:running:true');
  await expect(
    win.getByTestId('plugin-row-docs').getByRole('switch', { name: /^Disable Docs/ })
  ).toBeEnabled();
  await route(win, '/plugins/docs/panel');
  await expect(win.locator('.library-panel')).toBeVisible();
  await expect(win.getByTestId('nav-docs')).toBeVisible();

  await route(win, `/projects/${projectId}`);
  await expect(win.getByTestId('project-nav-docs')).toBeVisible();
  await route(win, '/plugins/docs/panel');
  await expect(win.locator('.library-panel')).toBeVisible();
});
