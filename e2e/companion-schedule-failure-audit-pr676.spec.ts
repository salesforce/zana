import { test, expect } from './fixtures/app.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test.skip(process.platform !== 'darwin', 'macOS companion audit');
test.use({ initialConfig: { companionEnabled: true } });

test('audit regression: actual schedule read failure must not be acknowledged as a successful launch', async ({ app, home }) => {
  const path = join(home, 'schedule-failure-audit'); mkdirSync(path);
  const projectId = await app.window.evaluate(async p => {
    const r = await window.cc.projects.add(p); if (!r.ok) throw new Error(r.message); return r.value.id;
  }, path);
  const result = await app.window.evaluate(projectId => window.cc.scheduler.create({ projectId, name: 'Audit failure',
    profile: 'shell', extraArgs: ['-c', 'cat'], every: '1h', enabled: false, inboxLevel: 'silent', autoCloseOnFinish: false }), projectId);
  if (!result.ok) throw new Error(result.message);
  const taskId = result.value.id;
  const file = [join(path, '.zcc', 'schedules', `${taskId}.json`), join(home, '.zcc', 'schedules', `${taskId}.json`)]
    .find(existsSync);
  expect(file).toBeTruthy();
  const original = readFileSync(file!, 'utf8');
  let sessionId: string | undefined;
  try {
    expect(await app.window.evaluate(() => window.cc.companion.enter())).toBe(true);
    let rail = app.electron.windows().find(p => p.url().includes('part=rail'));
    await expect.poll(() => {
      rail = app.electron.windows().find(p => p.url().includes('part=rail')); return !!rail;
    }).toBe(true);
    await rail!.waitForSelector('.cc-rail');
    await rail!.getByRole('button', { name: /^Scheduler:/ }).dispatchEvent('click');
    let panel = app.electron.windows().find(p => p.url().includes('part=panel'));
    await expect.poll(() => {
      panel = app.electron.windows().find(p => p.url().includes('part=panel')); return !!panel;
    }).toBe(true);
    const run = panel!.getByRole('button', { name: 'Run Audit failure now' });
    await expect(run).toBeVisible();

    // Fault only the disposable fixture after its row is visible. Restore each
    // fault promptly: the scheduler's directory watcher removes malformed files.
    writeFileSync(file!, '{invalid-json');
    const direct = await app.window.evaluate(id => window.cc.scheduler.runNow(id), taskId);
    expect(direct.ok).toBe(false);
    expect(await rail!.evaluate(id => window.cc.companion.runSchedule(id), taskId)).toBe(false);
    writeFileSync(file!, original);
    await expect(run).toBeVisible();
    writeFileSync(file!, '{invalid-json');
    await run.dispatchEvent('click');
    await expect(panel!.getByText("Couldn't start — open it in Zana")).toBeVisible();
    writeFileSync(file!, original);
    await expect(panel!.getByText(/Starting…/)).toHaveCount(0);
    await expect(run).toBeEnabled();

    // Repair only the fixture, then prove the same button can launch a real PTY.
    await run.dispatchEvent('click');
    await expect.poll(async () => {
      const tasks = await app.window.evaluate(() => window.cc.scheduler.list());
      sessionId = tasks.find(t => t.id === taskId)?.status.runs.find(r => r.sessionId)?.sessionId;
      return !!sessionId;
    }, { timeout: 20000 }).toBe(true);
    await expect(panel!.getByText(/Couldn't start/)).toHaveCount(0);
    await expect(run).toHaveCount(0);
    await expect(panel!.locator('.cc-row-meta')).toContainText('Running');
    expect((await rail!.evaluate(() => window.cc.companion.request())).counts.runningSchedules).toBe(1);
  } finally {
    writeFileSync(file!, original);
    if (sessionId) await app.window.evaluate(id => window.cc.terminals.close(id), sessionId);
    await app.window.evaluate(id => window.cc.scheduler.delete(id), taskId);
  }
});
