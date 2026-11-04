import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('Tasks mobile uses full-width list, projects, filters and details with a preserved return path', async ({ app }, testInfo) => {
  test.setTimeout(120_000);
  const win = app.window;
  expect(await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'tasks' }))).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'tasks')?.status), { timeout: 30_000 }).toBe('running');
  await win.evaluate(async () => {
    const rpc = (method: string, args: unknown) => window.cc.pluginApps.callRpc('tasks', method, args);
    const { project } = await rpc('createProject', { name: 'Mobile experience and agent workflows', prefix: 'MOB', color: 'blue' }) as { project: { id: string } };
    const { project: website } = await rpc('createProject', { name: 'Website', prefix: 'WEB', color: 'green' }) as { project: { id: string } };
    for (let i = 1; i <= 30; i++) await rpc('createTask', {
      projectId: project.id, title: i === 1 ? 'Make task details readable and easy to navigate on a small phone' : `Mobile interaction ${i}: keep the controls comfortable`,
      description: '# A comfortable mobile workspace\n\nTask details should use the available screen width.\n\n' + 'Keep every action easy to reach and return to the same place in the list.\n\n'.repeat(10),
      status: i < 5 ? 'in_progress' : 'todo', priority: i === 1 ? 'urgent' : 'none',
    });
    await rpc('createTask', { projectId: website.id, title: 'Update the website', status: 'done' });
  });

  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const url = `http://127.0.0.1:${port}`;
  const gateway = await startMobileGateway({ upstream: new URL(win.url()).origin, publicUrl: url, port });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pair = await context.request.post(`${url}/_mobile/pair`, { data: { code: gateway.pair().code, label: 'Tasks mobile test' } });
    const credential = await pair.json();
    expect((await context.request.post(`${url}/_mobile/session`, { headers: { authorization: `Bearer ${credential.credential}` } })).ok()).toBe(true);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(url);
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
    await drawer.getByRole('button', { name: 'More', exact: true }).click();
    await drawer.getByText('Tasks', { exact: true }).click();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    const panel = page.locator('.tasks-panel');
    const rows = panel.locator('.tasks-mobile-row');
    await expect(rows).toHaveCount(31);
    for (const width of [320, 390, 820]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(panel.locator('.tasks-desktop-navigation')).toHaveCount(0);
      expect((await panel.boundingBox())!.width).toBeGreaterThanOrEqual(width - 2);
      await expect(page.getByRole('toolbar', { name: 'Side panel' })).toBeVisible();
      expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect((await panel.locator('.tasks-topbar').boundingBox())!.height).toBeLessThanOrEqual(64);
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${width}-tasks-list.png`) });
      const projectTrigger = page.getByRole('button', { name: 'Choose task project' });
      await projectTrigger.click();
      const projects = page.getByRole('dialog', { name: 'Projects', exact: true });
      await expect(projects.getByRole('searchbox', { name: 'Search task projects' })).toBeVisible();
      await expect.poll(async () => (await projects.boundingBox())!.y).toBe(0);
      expect((await projects.boundingBox())!.width).toBe(width);
      expect((await projects.boundingBox())!.height).toBe(844);
      await projects.getByRole('searchbox').fill('MOB');
      await expect(projects.getByText('Website', { exact: true })).toHaveCount(0);
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${width}-tasks-projects.png`) });
      await projects.getByRole('button', { name: /^All tasks/ }).click();
      await expect(projects).toBeHidden();
      await expect(projectTrigger).toBeFocused();
      const filtersTrigger = page.getByRole('button', { name: 'Filters', exact: true });
      await filtersTrigger.click();
      const filters = page.getByRole('dialog', { name: 'Task filters' });
      await filters.getByRole('checkbox', { name: 'In Progress', exact: true }).check();
      await filters.getByRole('checkbox', { name: 'Urgent', exact: true }).check();
      await filters.getByRole('combobox', { name: 'Sort tasks' }).selectOption('priority');
      await expect.poll(async () => (await filters.boundingBox())!.y).toBe(0);
      expect((await filters.boundingBox())!.width).toBe(width);
      expect((await filters.boundingBox())!.height).toBe(844);
      expect(await filters.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${width}-tasks-filters.png`) });
      await filters.getByRole('button', { name: 'Show tasks', exact: true }).click();
      await expect(filtersTrigger).toBeFocused();
      await expect(rows).toHaveCount(1);
      const task = rows.first();
      expect((await task.boundingBox())!.width).toBeGreaterThan(width - 20);
      await expect(task.getByText('Urgent', { exact: true })).toBeVisible();
      await task.click();
      await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toBeHidden();
      const detail = page.locator('.tasks-detail');
      await expect(detail.getByRole('textbox', { name: 'Task title' })).toBeVisible();
      await expect(detail.getByRole('textbox', { name: 'Task title' })).toHaveCSS('font-size', '24px');
      expect(await panel.locator('.tasks-topbar').getByText('MOB-1', { exact: true }).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect((await detail.boundingBox())!.width).toBeGreaterThan(width - 4);
      expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await expect(detail.locator('.tasks-detail-properties')).toBeHidden();
      await expect(detail.getByText('Task details should use the available screen width.')).toBeVisible();
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${width}-tasks-detail.png`) });
      await detail.getByRole('button', { name: 'Urgent', exact: true }).click();
      const priority = page.getByRole('dialog', { name: 'Set priority' });
      await expect(priority.getByRole('menuitem', { name: 'Urgent', exact: true })).toBeVisible();
      expect((await priority.boundingBox())!.width).toBe(width);
      await priority.getByRole('menuitem', { name: 'Urgent', exact: true }).click();
      await expect(priority).toBeHidden();
      await page.getByRole('button', { name: 'Back (Esc)' }).click();
      await expect(rows).toHaveCount(1);
      await expect(task).toBeFocused();
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
      await expect(rows).toHaveCount(31);
    }
    // Keep the searched, scrolled list alive while reading a task.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('searchbox', { name: 'Search tasks' }).fill('Mobile interaction');
    await expect(rows).toHaveCount(29);
    const scroll = page.locator('.tasks-list-scroll');
    const selected = rows.nth(12);
    const key = await selected.getAttribute('data-task-key');
    await selected.scrollIntoViewIfNeeded();
    const scrollTop = await scroll.evaluate(el => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(300);
    await selected.click();
    await expect(page.locator('.tasks-detail')).toBeVisible();
    await page.getByRole('button', { name: 'Back (Esc)' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('Mobile interaction');
    await expect(panel.locator(`.tasks-mobile-row[data-task-key="${key}"]`)).toBeFocused();
    expect(Math.abs(await scroll.evaluate(el => el.scrollTop) - scrollTop)).toBeLessThan(2);
    await page.getByRole('searchbox', { name: 'Search tasks' }).fill('no matching task');
    await expect(page.getByText('No tasks match these filters')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(rows).toHaveCount(31);
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    const create = page.getByRole('dialog', { name: /New task/ });
    await expect(create.getByRole('textbox', { name: 'Task title', exact: true })).toBeVisible();
    expect((await create.boundingBox())!.width).toBeGreaterThan(350);
    await page.keyboard.press('Escape');
    await expect(create).toBeHidden();
    // Mobile never overwrites the existing desktop board choice.
    await page.getByRole('button', { name: 'Choose task project' }).click();
    await page.getByRole('dialog', { name: 'Projects', exact: true }).getByText('Mobile experience and agent workflows', { exact: true }).click();
    await expect(rows).toHaveCount(30);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('390-tasks-dark.png') });
    await page.getByRole('button', { name: 'Choose task project' }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole('dialog', { name: 'Projects', exact: true })).toHaveCount(0);
    await expect(panel.locator('.tasks-desktop-navigation')).toBeVisible();
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(rows).toHaveCount(30);
    await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'Renderer crashed' })).toHaveCount(0);
  } finally { await browser.close(); await gateway.close(); }
});
