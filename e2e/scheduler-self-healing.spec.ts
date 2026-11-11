/**
 * Scheduler self-healing at the Electron boundary: missed-run recovery, the
 * Problems workbench, the configurable limit with its queue, and Classic
 * compatibility for schedule files written by earlier Zana versions.
 *
 * Runs are real `shell` sessions. A shell does not take the schedule prompt as
 * argv, so each fixture passes its script as `-c <script>` and mirrors it in
 * `prompt`. Nothing here uses real data: every Project and schedule is synthetic.
 */
import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Handle = { window: Page; home: string; electron: Parameters<typeof captureElectronScreenshot>[0] };
type Task = { id: string; name: string; status: { runs: Array<Record<string, unknown>>; queuedAt?: string; nextRunAt?: string; runCount: number } };

const HOUR = 3_600_000;
const startOfUtcHour = (ms: number) => Math.floor(ms / HOUR) * HOUR;
const launchEnv = process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {};
// Fresh E2E config falls back to /bin/zsh when SHELL is absent. Ubuntu runners
// do not install zsh, so scheduler shell fixtures must pin portable /bin/sh.
test.use({ launchEnv, initialConfig: { shell: '/bin/sh' } });

async function addProject(app: Handle, name: string): Promise<string> {
  // Screenshots go into the PR: dismiss the first-run "Star on GitHub" nudge so it isn't in every image.
  const nudge = app.window.locator('.sponsor-nudge-close');
  if (await nudge.isVisible().catch(() => false)) await nudge.click();
  const dir = join(app.home, name);
  mkdirSync(dir, { recursive: true });
  return app.window.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, dir);
}

async function create(app: Handle, input: Record<string, unknown>): Promise<Task> {
  return app.window.evaluate(async input => {
    const result = await window.cc.scheduler.create(input as never);
    if (!result.ok) throw new Error(result.message);
    return result.value as never;
  }, input);
}

const scheduleFile = (app: Handle, id: string) => join(app.home, '.zcc', 'schedules', `${id}.json`);
const readTask = (app: Handle, id: string) => JSON.parse(readFileSync(scheduleFile(app, id), 'utf8'));
const listTasks = (app: Handle): Promise<Task[]> => app.window.evaluate(async () => {
  const result = await window.cc.scheduler.list() as unknown;
  const value = result && typeof result === 'object' && 'ok' in result ? (result as { ok: boolean; value: unknown }).value : result;
  return value as never;
});
const taskByName = async (app: Handle, name: string) => (await listTasks(app)).find(task => task.name === name);

/** A shell run: the script is both the prompt (documentation) and the real `-c` command. */
const shell = (script: string) => ({ profile: 'shell', prompt: script, extraArgs: ['-c', script], inboxLevel: 'silent' });

async function openScheduler(app: Handle) {
  const back = app.window.locator('.settings-app-back');
  if (await back.count()) await back.click();
  await app.window.locator('.nav-item').filter({ hasText: 'Scheduler' }).first().click();
  return app.window.getByTestId('scheduler-view');
}
/** Two animation frames: a native capture right after a DOM change grabs the previous frame. */
const settle = (app: Handle) => app.window.evaluate(() => new Promise<void>(done =>
  requestAnimationFrame(() => requestAnimationFrame(() => done()))));
/** Switch the theme the supported way and wait until it is painted. */
async function useTheme(app: Handle, theme: 'light' | 'dark') {
  await app.window.evaluate(value => window.cc.config.set({ theme: value }), theme);
  await expect(app.window.locator('html')).toHaveAttribute('data-theme', theme);
  // Buttons repaint after their colour transitions finish; a capture before that
  // shows them in the previous theme's colours.
  await app.window.waitForTimeout(600);
  await settle(app);
}
const subview = (app: Handle, name: 'Overview' | 'Schedules' | 'Problems') =>
  app.window.locator('.scheduler-subview-toggle button', { hasText: name }).click();
async function openDetail(app: Handle, name: string) {
  await subview(app, 'Schedules');
  await app.window.locator('.scheduler-card').filter({ hasText: name }).locator('.scheduler-card-main').click();
  await expect(app.window.getByTestId('schedule-info-panel')).toBeVisible({ timeout: 15_000 });
}
const runRow = (app: Handle, text: string | RegExp) => app.window.locator('.scheduler-run-row').filter({ hasText: text });

test('Recovery: slots missed while closed give one marker and one catch-up run', async ({ app }, testInfo) => {
  const projectId = await addProject(app, 'Garden');
  const task = await create(app, { name: 'Hourly digest', projectId, every: undefined, cron: '0 * * * *', tz: 'UTC', enabled: true, ...shell('exit 0') });
  expect((readTask(app, task.id)).catchUp).toEqual({ mode: 'once' });

  // Edit through the supported file-watcher input once the create write settles.
  await app.window.waitForTimeout(1600);
  const lastRunAt = new Date(startOfUtcHour(Date.now()) - 5 * HOUR + 30_000).toISOString();
  const file = readTask(app, task.id);
  file.status = { runCount: 1, lastRunAt, runs: [{ id: 'seed-1', at: lastRunAt, result: 'success' }] };
  writeFileSync(scheduleFile(app, task.id), JSON.stringify(file));

  await openScheduler(app);
  await openDetail(app, 'Hourly digest');
  const missed = runRow(app, 'Missed');
  await expect(missed).toContainText('Zana closed', { timeout: 20_000 });
  await expect(missed).toContainText('4 slots');
  await expect(runRow(app, 'Success').filter({ hasText: 'Catch-up' })).toHaveCount(1, { timeout: 20_000 });
  // lastRunAt is moved only by the run, never by the marker.
  const saved = readTask(app, task.id);
  const real = saved.status.runs.find((run: { marker?: boolean; trigger?: string }) => !run.marker && run.trigger === 'catch-up');
  expect(saved.status.lastRunAt).toBe(real.at);
  expect(saved.status.runCount).toBe(2);
  expect(saved.status.runs.find((run: { marker?: boolean }) => run.marker)).toMatchObject({ result: 'skipped', reasonCode: 'missed-app-closed', missed: { count: 4 } });

  await settle(app);
  await captureElectronScreenshot(app.electron, app.window, testInfo.outputPath('detail-chips.png'));
  const editor = app.window.getByTestId('schedule-editor');
  // Both policies are cards with a title and a plain description, like Inbox notifications.
  const missedRuns = editor.getByRole('radiogroup', { name: 'Missed runs' });
  await expect(missedRuns.locator('input[value="once"]')).toBeChecked();
  await expect(editor.getByRole('radiogroup', { name: 'Auto-retry' }).locator('input[value="off"]')).toBeChecked();
  await missedRuns.scrollIntoViewIfNeeded();
  await settle(app);
  await captureElectronScreenshot(app.electron, app.window, testInfo.outputPath('editor-policies.png'));
});

test('Problems: retry a failed run and dismiss another', async ({ app }, testInfo) => {
  const projectId = await addProject(app, 'Garden');
  const flaky = await create(app, { name: 'Flaky job', projectId, every: '1d', enabled: false, ...shell('test -f .flaky-ok && exit 0 || { touch .flaky-ok; exit 3; }') });
  const failing = await create(app, { name: 'Always fails', projectId, every: '1d', enabled: false, ...shell('exit 4') });
  for (const id of [flaky.id, failing.id]) {
    expect(await app.window.evaluate(id => window.cc.scheduler.runNow(id), id)).toMatchObject({ ok: true });
  }
  await expect.poll(async () => (await listTasks(app)).filter(t => t.status.runs[0]?.result === 'error').length, { timeout: 30_000 }).toBe(2);

  await openScheduler(app);
  await subview(app, 'Problems');
  const problems = app.window.getByRole('region', { name: 'Problems' });
  const row = (name: string) => problems.locator('tbody tr').filter({ hasText: name });
  await expect(row('Flaky job')).toContainText('Exited with an error');
  await expect(row('Always fails')).toContainText('Exited with an error');
  await app.window.setViewportSize({ width: 1440, height: 1000 });
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(app, theme);
    await captureElectronScreenshot(app.electron, app.window, testInfo.outputPath(`problems-${theme}.png`));
  }

  await problems.getByRole('button', { name: 'Retry Flaky job run' }).click();
  await expect(row('Flaky job')).toHaveCount(0, { timeout: 30_000 });
  await openDetail(app, 'Flaky job');
  const retried = runRow(app, 'Success').filter({ hasText: 'Attempt 2' });
  await expect(retried).toHaveCount(1, { timeout: 30_000 });
  expect(readTask(app, flaky.id).status.runs.find((run: { attempt?: number }) => run.attempt === 2)).toMatchObject({ trigger: 'retry', retryOf: expect.any(String) });

  await openScheduler(app);
  await subview(app, 'Problems');
  await problems.getByRole('button', { name: 'Dismiss Always fails run' }).click();
  await expect(problems.getByText('No open problems. Self-healing handled everything.')).toBeVisible();
  await problems.getByLabel('Show').selectOption('problems');
  await expect(row('Always fails')).toContainText('Exited with an error');
  expect(readTask(app, failing.id).status.runs[0].dismissedAt).toBeTruthy();
});

test('Limit 1 queues the second due run instead of skipping it', async ({ app }, testInfo) => {
  const projectId = await addProject(app, 'Garden');
  await app.window.getByRole('link', { name: 'Settings', exact: true }).click();
  await app.window.getByTestId('settings-nav-agents').click();
  const limit = app.window.getByRole('spinbutton', { name: 'Max scheduled runs at once' });
  await limit.fill('1');
  await limit.blur();
  await expect.poll(() => app.window.evaluate(() => window.cc.config.get())).toMatchObject({ scheduledRunConcurrency: 1 });
  await expect(app.window.getByRole('button', { name: 'When the limit is reached' })).toContainText('Automatic');
  // Centre the new controls so the whole "Scheduled" group is in the screenshot.
  await limit.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await settle(app);
  await captureElectronScreenshot(app.electron, app.window, testInfo.outputPath('settings-scheduled.png'));

  const cron = { every: undefined, cron: '0 * * * *', tz: 'UTC', enabled: true };
  const a = await create(app, { name: 'Queue A', projectId, ...cron, ...shell('sleep 8; exit 0') });
  const b = await create(app, { name: 'Queue B', projectId, ...cron, ...shell('sleep 8; exit 0') });
  await app.window.waitForTimeout(1600);
  const twoHoursAgo = new Date(Date.now() - 2 * HOUR).toISOString();
  for (const id of [a.id, b.id]) {
    const file = readTask(app, id);
    file.status = { runCount: 1, lastRunAt: twoHoursAgo, runs: [{ id: `seed-${id}`, at: twoHoursAgo, result: 'success' }] };
    writeFileSync(scheduleFile(app, id), JSON.stringify(file));
  }

  await openScheduler(app);
  let queuedName = '';
  await expect.poll(async () => {
    const queued = (await listTasks(app)).find(task => task.status.queuedAt && [a.id, b.id].includes(task.id));
    queuedName = queued?.name ?? '';
    return queuedName;
  }, { timeout: 30_000, intervals: [100] }).not.toBe('');
  await openDetail(app, queuedName);
  await expect(app.window.locator('.schedule-chips').getByText('Queued')).toBeVisible({ timeout: 5_000 });

  await expect.poll(async () => {
    const tasks = (await listTasks(app)).filter(task => [a.id, b.id].includes(task.id));
    return tasks.every(task => task.status.runs.some(run => run.result === 'success' && run.trigger !== undefined && !run.marker && run.id !== `seed-${task.id}`));
  }, { timeout: 60_000 }).toBe(true);
  for (const task of (await listTasks(app)).filter(task => [a.id, b.id].includes(task.id))) {
    expect(task.status.runs.some(run => run.reasonCode === 'concurrency-cap')).toBe(false);
    expect(task.status.queuedAt).toBeUndefined();
  }
});

test('An existing (2.3-format) schedule keeps Classic behaviour until recovery is turned on', async ({ app }, testInfo) => {
  const projectId = await addProject(app, 'Garden');
  const dir = join(app.home, '.zcc', 'schedules');
  mkdirSync(dir, { recursive: true });
  const now = Date.now();
  // Exactly the field set the 2.3 loader reads: no catchUp, retry or new status fields.
  const legacy = (id: string, name: string, lastRunMs: number) => ({
    id, name, enabled: true, projectId, profile: 'shell', extraArgs: ['-c', 'exit 0'], prompt: 'exit 0',
    schedule: { every: '2h' }, overlap: 'skip', history: { retain: 10 },
    status: {
      runCount: 1, lastRunAt: new Date(lastRunMs).toISOString(), lastRunResult: 'success',
      runs: [{ id: `${id}-run`, at: new Date(lastRunMs).toISOString(), result: 'success' }]
    },
    createdAt: new Date(now - 48 * HOUR).toISOString(), updatedAt: new Date(now - 48 * HOUR).toISOString(),
    inboxLevel: 'silent', autoCloseOnFinish: true
  });
  const files = { stale: join(dir, 'legacy-stale.json'), fresh: join(dir, 'legacy-fresh.json') };
  writeFileSync(files.stale, JSON.stringify(legacy('legacy-stale', 'Legacy stale', now - 7 * HOUR), null, 2));
  writeFileSync(files.fresh, JSON.stringify(legacy('legacy-fresh', 'Legacy fresh', now - 10 * 60_000), null, 2));
  const before = { stale: readFileSync(files.stale), fresh: readFileSync(files.fresh) };

  await expect.poll(async () => (await listTasks(app)).length, { timeout: 15_000 }).toBe(2);
  // Boot catch-up rules for a Classic interval: a schedule more than two intervals
  // overdue starts nothing and waits a full interval.
  await app.window.waitForTimeout(8_000);
  const stale = (await taskByName(app, 'Legacy stale'))!;
  expect(stale.status.runs.filter(run => !run.marker)).toHaveLength(1);
  expect(Math.abs(Date.parse(stale.status.nextRunAt!) - (Date.now() + 2 * HOUR))).toBeLessThan(2 * 60_000);
  // Loading must not rewrite either file.
  expect(readFileSync(files.stale).equals(before.stale)).toBe(true);
  expect(readFileSync(files.fresh).equals(before.fresh)).toBe(true);

  await openScheduler(app);
  await openDetail(app, 'Legacy stale');
  await expect(app.window.locator('.schedule-chips').getByText('Recovery off')).toBeVisible();
  await settle(app);
  await captureElectronScreenshot(app.electron, app.window, testInfo.outputPath('classic-detail.png'));

  await openScheduler(app);
  await subview(app, 'Overview');
  const card = app.window.getByRole('region', { name: 'Run recovery' });
  await expect(card).toContainText('Your schedules still run exactly as before');
  await settle(app);
  await captureElectronScreenshot(app.electron, app.window, testInfo.outputPath('recovery-card.png'));
  await card.getByRole('button', { name: 'Review' }).click();
  const dialog = app.window.locator('.recovery-dialog');
  await expect(dialog.getByText('Legacy stale')).toBeVisible();
  await expect(dialog.getByText('Legacy fresh')).toBeVisible();
  await settle(app);
  await captureElectronScreenshot(app.electron, app.window, testInfo.outputPath('recovery-dialog.png'));
  await dialog.getByRole('button', { name: 'Turn on for 2 schedules' }).click();
  await expect(dialog.getByText('2 turned on')).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();

  expect(JSON.parse(readFileSync(files.stale, 'utf8')).catchUp).toEqual({ mode: 'once' });
  expect(JSON.parse(readFileSync(files.fresh, 'utf8')).catchUp).toEqual({ mode: 'once' });
  await expect(card).toHaveCount(0);
  await expect.poll(() => app.window.evaluate(() => window.cc.config.get())).toMatchObject({ schedulerRecoveryIntro: 'applied' });
});
