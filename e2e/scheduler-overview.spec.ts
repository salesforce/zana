import { test, expect } from './fixtures/app.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test('scheduler overview: triage, filters, pagination and responsive layout', async ({ app }, testInfo) => {
  const win = app.window;
  const projectDir = join(app.home, 'Garden');
  mkdirSync(projectDir, { recursive: true });
  const projectId = await win.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, projectDir);
  const names = ['Dependency audit', 'Inbox watcher', 'QA review', 'Morning digest', 'Repo health check', 'Weekly report', 'Release notes', 'Documentation review', 'Test coverage', 'Design review'];
  const tasks = await win.evaluate(async ({ projectId, names }) => {
    const tasks: Array<{ id: string; name: string }> = [];
    for (const name of names) {
      const result = await window.cc.scheduler.create({ name, projectId, profile: 'shell', every: '1d', enabled: false, inboxLevel: 'silent' });
      if (!result.ok) throw new Error(result.message);
      tasks.push(result.value);
    }
    return tasks;
  }, { projectId, names });

  // Exercise the supported file-watcher input in the isolated data directory.
  // Enabled fixtures are due tomorrow; this test never launches agents.
  await win.waitForTimeout(1600);
  for (let i = 0; i < tasks.length; i++) {
    const path = join(app.home, '.zcc', 'schedules', `${tasks[i].id}.json`);
    const task = JSON.parse(readFileSync(path, 'utf8'));
    const at = new Date(Date.now() - (i + 1) * 60000).toISOString();
    task.enabled = i >= 3 && i <= 5;
    if (i === 2) task.projectId = 'missing-fixture-project';
    task.status = { runCount: 1, lastRunAt: at, runs: [{ at, result: i === 0 ? 'error' : i === 1 ? 'incomplete' : 'success',
      ...(i < 2 ? { message: i === 0 ? 'Dependency audit could not read the package manifest. Check the project path and file permissions before retrying.' : 'The run ended without a completion report. Open the schedule to inspect the previous run.' } : {}) }] };
    // An overlap skip is not a problem, so the attention counts below still hold.
    if (i === 4) task.status.runs = [{ at, result: 'skipped', reasonCode: 'overlap', message: 'previous run still active' }];
    writeFileSync(path, JSON.stringify(task));
  }

  await win.locator('.nav-item').filter({ hasText: 'Scheduler' }).first().click();
  const page = win.getByTestId('scheduler-view');
  const inventory = page.getByRole('region', { name: 'All schedules' });
  await expect(page.getByText('3 schedules need attention')).toBeVisible();
  await expect(inventory.getByRole('checkbox')).toHaveCount(8);
  await inventory.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(inventory.getByRole('status')).toHaveText('9–10 of 10 schedules');
  // Open problems are triaged in the Problems workbench; the inventory keeps its attention filter.
  await page.getByRole('button', { name: 'Review problems' }).click();
  const problems = win.getByRole('region', { name: 'Problems' });
  await expect(problems.locator('tbody tr')).toHaveCount(2);
  await win.locator('.scheduler-subview-toggle button', { hasText: 'Overview' }).click();
  await inventory.getByRole('combobox').selectOption('attention');
  await expect(inventory.getByRole('combobox')).toHaveValue('attention');
  await expect(inventory.getByRole('checkbox')).toHaveCount(3);
  await inventory.getByRole('searchbox').fill('dependency');
  await expect(inventory.getByRole('checkbox')).toHaveCount(1);
  await inventory.getByRole('searchbox').fill('no such schedule');
  await expect(inventory.getByText('No schedules match these filters.')).toBeVisible();
  await inventory.getByRole('button', { name: 'Clear filters' }).click();
  await expect(inventory.getByRole('checkbox')).toHaveCount(8);
  await inventory.getByRole('combobox').selectOption('skipped');
  await expect(inventory.getByRole('checkbox'), 'Skipped last run keeps only the schedule whose last run was skipped').toHaveCount(1);
  await expect(inventory.getByText('Repo health check', { exact: true }), 'the skipped schedule is listed').toBeVisible();
  await expect(inventory.locator('.schedule-issue-label--skipped'), 'the Overview row says why it was skipped').toContainText('Previous run still active');
  await inventory.getByRole('combobox').selectOption('all');
  await expect(inventory.getByRole('checkbox'), 'All schedules shows every enabled and off schedule again').toHaveCount(8);

  await win.setViewportSize({ width: 1440, height: 1100 });
  await win.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.locator('.settings-inner').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath('scheduler-desktop.png') });
  for (const size of [{ width: 820, height: 1000 }, { width: 430, height: 932 }]) {
    if (size.width < 600) await win.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await win.setViewportSize(size);
    await page.locator('.settings-inner').evaluate(el => { el.scrollTop = 0; });
    await expect.poll(() => page.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect.poll(() => page.locator('.settings-inner').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect.poll(() => page.locator('.overview-columns').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
    await page.screenshot({ path: testInfo.outputPath(`scheduler-${size.width}.png`) });
    await inventory.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`scheduler-inventory-${size.width}.png`) });
  }
  await win.setViewportSize({ width: 1440, height: 1100 });
  await win.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.locator('.settings-inner').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath('scheduler-dark.png') });
  await page.getByRole('button', { name: 'View schedules', exact: true }).click();
  await page.getByRole('combobox').selectOption('skipped');
  await expect(page.locator('.scheduler-card'), 'the Schedules list keeps only the skipped schedule').toHaveCount(1);
  await expect(page.getByTestId('schedule-skipped-last'), 'the row pill gives the time').toContainText('skipped');
  await expect(page.getByTestId('schedule-skipped-last'), 'the row pill gives the reason').toContainText('Previous run still active');
  await page.screenshot({ path: testInfo.outputPath('scheduler-skipped-last-run.png') });
  // The pill must not squeeze the schedule name out of a narrow row.
  await win.setViewportSize({ width: 430, height: 932 });
  const skippedCard = page.locator('.scheduler-card').first();
  await expect.poll(() => skippedCard.evaluate(el => el.scrollWidth <= el.clientWidth + 1), { message: 'the skipped row fits a narrow window' }).toBe(true);
  await expect.poll(() => skippedCard.locator('.scheduler-card-title').evaluate(el => Math.round(el.getBoundingClientRect().width)),
    { message: 'the schedule name keeps room beside the pill' }).toBeGreaterThan(90);
  await page.screenshot({ path: testInfo.outputPath('scheduler-skipped-last-run-430.png') });
  await win.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('combobox').selectOption('all');
  await page.getByRole('searchbox').fill('dependency');
  await page.getByRole('combobox').selectOption('attention');
  await expect(page.locator('.scheduler-card')).toHaveCount(1);
  await page.locator('.scheduler-card-main').click();
  await expect(win.getByTestId('schedule-detail')).toBeVisible();
  await expect(win.locator('#sched-name')).toHaveValue('Dependency audit');
});
