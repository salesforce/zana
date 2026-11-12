import { test, expect, dismissConsentOverlays } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true }, isolateBundledCatalog: true });
test.setTimeout(90_000);

test('one application tab bar orders, searches and closes threads and setup drafts together', async ({ app }, testInfo) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const roots = ['Navigation', 'Project creation'].map(name => join(app.home, name));
  roots.forEach(root => mkdirSync(root));
  const rows = await page.evaluate(async roots => {
    const rows: Array<{ id: string; title: string }> = [];
    for (const [index, title] of ['Inspect navigation', 'Review project creation'].entries()) {
      const added = await window.cc.projects.add(roots[index]!);
      if (!added.ok) throw new Error(added.message);
      const response = await fetch('/api/v1/threads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: added.value.id, providerId: 'fake', title, input: 'delay:60000 keep running' })
      });
      if (!response.ok) throw new Error(await response.text());
      rows.push((await response.json()).thread);
    }
    return rows;
  }, roots);
  const route = async (to: string) => page.evaluate(to => {
    history.pushState({}, '', to); dispatchEvent(new PopStateEvent('popstate'));
  }, to);
  await route(`/threads/${rows[0]!.id}`);
  const bar = page.getByTestId('application-tabs');
  await expect(bar.getByRole('tab')).toHaveCount(1);
  await page.getByRole('button', { name: 'Connect a machine', exact: true }).click();
  await expect(bar.getByRole('tab', { name: 'Connect a machine', exact: true })).toHaveAttribute('aria-selected', 'true');
  await route(`/threads/${rows[1]!.id}`);
  await expect(bar.getByRole('tab')).toHaveCount(3);
  expect(await bar.locator('[data-tab-kind]').evaluateAll(elements => elements.map(element => element.getAttribute('data-tab-kind')))).toEqual(['thread', 'setup', 'thread']);
  const local = page.locator('.machine-project-group').filter({ has: page.locator('.machine-project-name .lucide-laptop') });
  await local.getByRole('button', { name: /^Add project on / }).click();
  await page.getByRole('menuitem', { name: 'New folder', exact: true }).click();
  const draft = page.getByRole('region', { name: 'Create project folder', exact: true });
  await draft.getByRole('textbox', { name: 'Folder name' }).fill('application-tab-draft');
  await expect(bar.getByRole('tab')).toHaveCount(4);
  await bar.getByLabel('All open tabs').click();
  const search = bar.getByRole('textbox', { name: 'Find an open tab' });
  await search.fill('folder');
  const results = bar.locator('.titlebar-threads-results');
  await expect(results.getByRole('button')).toHaveCount(1);
  await results.getByRole('button').click();
  await expect(draft.getByRole('textbox', { name: 'Folder name' })).toHaveValue('application-tab-draft');
  const setup = bar.getByRole('tab', { name: 'Connect a machine', exact: true });
  await setup.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Tab actions', exact: true });
  await expect(menu.getByRole('menuitem', { name: 'Archive', exact: true })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Move tab right', exact: true }).click();
  expect(await bar.locator('[data-tab-kind]').evaluateAll(elements => elements.map(element => element.getAttribute('data-tab-kind')))).toEqual(['thread', 'thread', 'setup', 'setup']);
  await setup.click();
  await setup.press('End');
  await expect(draft).toBeVisible();
  await expect(draft.getByRole('textbox', { name: 'Folder name' })).toHaveValue('application-tab-draft');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('mixed-application-tabs.png'));
  // Closing an active setup chooses the neighboring setup to its right.
  await setup.click();
  await bar.getByRole('button', { name: 'Close tab: Connect a machine' }).click();
  await expect(draft).toBeVisible();
  await bar.getByRole('tab', { name: new RegExp(rows[1]!.title) }).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Close tabs to the right' }).click();
  await expect(draft).toHaveCount(0);
  await expect(bar.getByRole('tab')).toHaveCount(2);
  await expect(page).toHaveURL(new RegExp(`/threads/${rows[1]!.id}$`));
  await bar.getByRole('tab', { name: new RegExp(rows[1]!.title) }).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Close all tabs' }).click();
  await expect(bar.getByRole('tab')).toHaveCount(0);
  const archived = await page.evaluate(async ids => {
    return Promise.all(ids.map(async id => {
      const response = await fetch(`/api/v1/threads/${id}`); return (await response.json()).thread.archivedAt;
    }));
  }, rows.map(row => row.id));
  expect(archived.every(value => !value)).toBe(true);
  await bar.getByLabel('All open tabs').click();
  await bar.getByRole('button', { name: 'Reopen closed tab' }).click();
  await expect(bar.getByRole('tab')).toHaveCount(1);
  // Reload restores conversation shortcuts but cannot resurrect a discarded setup.
  await page.reload();
  await expect(bar.getByRole('tab')).toHaveCount(1);
  await expect(bar.locator('[data-tab-kind="setup"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
