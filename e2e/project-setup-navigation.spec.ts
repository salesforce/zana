import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, isAppRendererUrl } from './fixtures/app.js';
import type { Page } from '@playwright/test';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ initialConfig: { sponsorPromptDismissed: true } });

test('a dedicated project window retains setup URLs and normalizes their scope', async ({ app, home }) => {
  const path = join(home, 'scoped-project');
  mkdirSync(path);
  const projectId = await app.window.evaluate(async path => {
    const added = await window.cc.projects.add(path);
    if (!added.ok) throw new Error(added.message);
    await window.cc.windows.openProject(added.value.id);
    return added.value.id;
  }, path);
  let scoped: Page | undefined;
  await expect.poll(() => {
    scoped = app.electron.windows().find(page => page !== app.window && isAppRendererUrl(page.url()));
    return Boolean(scoped);
  }).toBe(true);
  const page = scoped!;
  await expect(page.getByTestId('project-nav-agents')).toBeVisible();
  // Drafts are window-local; a directly opened URL renders the stale-draft
  // recovery page. The scope guard must retain it rather than bounce home.
  for (const search of ['', '?projectId=other']) {
    await page.evaluate(path => {
      history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, `/setup/project%3Alocal%3Aopen${search}`);
    await expect(page.getByRole('heading', { name: 'This setup is no longer open', exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/setup/[^?]+\\?projectId=${projectId}$`));
  }
  await page.locator('.setup-pages-breadcrumb').getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}(?:\\?[^#]*)?$`));
  await expect(page.getByTestId('project-nav-agents')).toBeVisible();
});

test('machine menus open nonmodal setup pages and retain drafts across navigation', async ({ app, home }, testInfo) => {
  const page = app.window;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const local = page.locator('.machine-project-group').filter({ has: page.locator('.machine-project-name .lucide-laptop') });
  await expect(local).toBeVisible();
  const add = local.getByRole('button', { name: /^Add project on / });
  await add.click();
  const menu = page.getByRole('menu', { name: /^Add project on / });
  await expect(menu.getByRole('menuitem')).toHaveText(['Add folder', 'New folder', 'Clone from Git']);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('machine-project-dropdown.png'));
  await menu.getByRole('menuitem', { name: 'New folder' }).click();
  const create = page.getByRole('region', { name: 'Create project folder', exact: true });
  await expect(create).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await create.getByRole('textbox', { name: 'Folder name' }).fill('new-api');
  await create.getByRole('textbox', { name: 'Parent folder', exact: true }).fill(home);
  await page.getByRole('button', { name: 'Connect a machine', exact: true }).click();
  const connect = page.getByRole('region', { name: 'Connect a machine', exact: true });
  await expect(connect).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(connect.getByTestId('add-machine-method-ssh')).toBeVisible();
  await expect(connect.getByTestId('add-machine-method-command')).toBeVisible();
  await connect.getByTestId('add-machine-method-command').click();
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('connect-machine-page.png'));
  await page.getByRole('tab', { name: /^New folder · / }).click();
  await expect(create.getByRole('textbox', { name: 'Folder name' })).toHaveValue('new-api');
  await expect(create.getByRole('textbox', { name: 'Parent folder', exact: true })).toHaveValue(home);
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('new-folder-page.png'));
  await create.getByRole('button', { name: 'Create & add' }).click();
  await expect(create).toHaveCount(0);
  expect(existsSync(join(home, 'new-api'))).toBe(true);
  await page.getByRole('button', { name: 'Back to all projects', exact: true }).click();
  await expect(page.getByText('This setup is no longer open', { exact: true })).toHaveCount(0);
  await expect(local.getByRole('button', { name: 'Open new-api', exact: true })).toBeVisible();
  // A setup tab can still be resumed after opening a registered project.
  await page.getByRole('tab', { name: 'Connect a machine', exact: true }).click();
  await expect(connect.getByTestId('add-machine-method-command')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Close tab: Connect a machine' }).click();
  await expect(connect).toHaveCount(0);
  const folder = join(home, 'existing-api'); mkdirSync(folder);
  await add.click(); await page.getByRole('menuitem', { name: 'Add folder', exact: true }).click();
  const open = page.getByRole('region', { name: /^Add project on / });
  await open.getByRole('textbox').fill(join(home, 'missing-folder'));
  await open.getByRole('button', { name: 'Add project', exact: true }).click();
  await expect(open.getByRole('alert')).toBeVisible();
  await open.getByRole('textbox').fill(folder);
  await open.getByRole('button', { name: 'Add project', exact: true }).click();
  await expect(open).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to all projects', exact: true }).click();
  await expect(page.getByText('This setup is no longer open', { exact: true })).toHaveCount(0);
  await expect(local.getByRole('button', { name: 'Open existing-api', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
