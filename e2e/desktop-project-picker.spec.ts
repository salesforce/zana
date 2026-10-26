import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true, initialConfig: { sponsorPromptDismissed: true } });

test.beforeEach(async ({ home }) => {
  const projects = Array.from({ length: 26 }, (_, index) => {
    const name = `Project ${String(index).padStart(2, '0')}`;
    const path = join(home, 'a-long-parent-folder-for-testing-single-line-project-paths', name);
    mkdirSync(path, { recursive: true });
    return { id: `split-picker-${index}`, name, path, createdAt: Date.now(), lastActiveAt: Date.now() };
  });
  mkdirSync(join(home, '.zcc'), { recursive: true });
  writeFileSync(join(home, '.zcc', 'projects.json'), JSON.stringify({ version: 1, projects }));
});

test('split picker browses machines, searches globally and preserves the launcher draft', async ({ app }, testInfo) => {
  const page = app.window;
  const hosts = await page.evaluate(async () => (await fetch('/api/v1/hosts')).json());
  // Offline roster data exercises the renderer without enrolling another daemon.
  await page.route('**/api/v1/hosts', route => route.fulfill({ json: [...hosts, {
    id: 'split-picker-offline', name: 'Preview devbox', isPrimary: false, status: 'disconnected',
    type: 'persistent', homeDir: '/home/dev', maxPermissionMode: 'full'
  }] }));
  await page.reload();
  await page.evaluate(() => {
    window.history.pushState({}, '', '/agents');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  if (await page.getByTestId('agents-new-empty').count()) await page.getByTestId('agents-new-empty').click();
  else await page.getByTestId('agents-board-new-thread').first().click();
  const launcher = page.getByTestId('launch-modal');
  await launcher.getByRole('button', { name: 'Modern', exact: true }).click();
  const input = launcher.getByTestId('thread-command-input');
  await input.fill('Keep this draft while I browse machines and projects');
  const trigger = launcher.getByRole('button', { name: 'Machine and project', exact: true });
  await trigger.click();
  const picker = page.getByRole('dialog', { name: 'Choose project', exact: true });
  const rail = picker.getByRole('navigation', { name: 'Machines' });
  const list = picker.getByRole('listbox', { name: 'Machine and project' });
  const search = picker.getByRole('combobox');
  await expect(search).toBeFocused();
  await expect(list.getByRole('option')).toHaveCount(27);
  const selected = await trigger.textContent();

  await rail.getByTitle('Preview devbox', { exact: true }).click();
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list).not.toContainText('Project 00');
  await expect(trigger).toHaveText(selected!);
  await picker.getByRole('button', { name: 'Add project on Preview devbox', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add project on Preview devbox', exact: true });
  await expect(add).toBeVisible();
  await add.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(launcher).toBeVisible();

  await trigger.click();
  await search.fill('Preview devbox');
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list).toContainText('General tasks on Preview devbox');
  await search.fill('nothing matches this query');
  await expect(picker.getByRole('status')).toHaveText('No matching machines or projects');
  await expect(picker.getByRole('button', { name: /^Add project on / })).toBeVisible();
  await search.fill('Project 25');
  await expect(list.getByRole('option')).toHaveCount(1);
  await search.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(trigger).toContainText('Project 25');
  await expect(trigger).toBeFocused();
  await expect(input).toContainText('Keep this draft while I browse machines and projects');

  await trigger.click();
  await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  const footer = picker.getByRole('button', { name: /^Add project on / });
  const bounds = await picker.boundingBox(), footerBounds = await footer.boundingBox(), railBounds = await rail.boundingBox(), listBounds = await list.boundingBox();
  expect(railBounds!.x).toBeLessThan(listBounds!.x);
  expect(footerBounds!.y + footerBounds!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
  expect(await list.locator('.desktop-project-picker-project-copy small').first().evaluate(node => getComputedStyle(node).whiteSpace)).toBe('nowrap');
  await page.screenshot({ path: testInfo.outputPath('split-project-picker.png') });
  await search.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(launcher).toBeVisible();
  await expect(trigger).toBeFocused();

  // A click in the launch modal must dismiss the portalled picker, even though
  // the modal itself stops mousedown bubbling to its backdrop.
  await trigger.click();
  await input.click();
  await expect(picker).toHaveCount(0);
  await expect(launcher).toBeVisible();
});
