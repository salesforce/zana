import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.skip(process.platform !== 'darwin', 'macOS companion surface');
test.use({ initialConfig: { companionEnabled: true } });

test('running and finished Squad records produce the correct rail count and actions', async ({ app, home }) => {
  const { window, electron } = app;
  const projectId = await window.evaluate(async () => (await window.cc.projects.list())[0].id);
  const created = await window.evaluate(projectId => window.cc.scheduler.create({
    projectId, name: 'Squad status fixture', profile: 'shell', every: '1h', enabled: false, inboxLevel: 'silent'
  }), projectId);
  if (!created.ok) throw new Error(created.message);
  const completed = await window.evaluate(projectId => window.cc.scheduler.create({
    projectId, name: 'Completed Squad fixture', profile: 'shell', every: '1h', enabled: false, inboxLevel: 'silent'
  }), projectId);
  if (!completed.ok) throw new Error(completed.message);
  const taskId = created.value.id;
  const project = await window.evaluate(async id => (await window.cc.projects.list()).find(p => p.id === id)!, projectId);
  const candidates = [join(project.path, '.zcc', 'schedules', `${taskId}.json`), join(home, '.zcc', 'schedules', `${taskId}.json`)];
  const file = candidates.find(existsSync)!;
  const completedFile = [join(project.path, '.zcc', 'schedules', `${completed.value.id}.json`), join(home, '.zcc', 'schedules', `${completed.value.id}.json`)].find(existsSync)!;
  const task = JSON.parse(readFileSync(file, 'utf8'));
  // This fixture exercises persisted state and presentation; it launches no Squad.
  task.kind = 'team';
  task.teamId = 'fixture-team';
  task.planSource = 'infer';
  task.status.runs = [{ id: 'fixture-run', at: new Date().toISOString(), result: 'success', launchState: 'running', launchKind: 'team', executionId: 'fixture-execution' }];
  try {
    writeFileSync(file, JSON.stringify(task));
    writeFileSync(completedFile, JSON.stringify({ ...task, id: completed.value.id, name: 'Completed Squad fixture', status: { ...task.status,
      runs: [{ ...task.status.runs[0], id: 'finished-run', finishedAt: new Date().toISOString() }] } }));
    await expect.poll(async () => (await window.evaluate(() => window.cc.scheduler.list())).find(t => t.id === taskId)?.kind).toBe('team');
    await expect.poll(async () => (await window.evaluate(() => window.cc.scheduler.list())).find(t => t.id === completed.value.id)?.status.runs[0]?.finishedAt).not.toBeUndefined();
    await window.evaluate(() => window.cc.companion.enter());
    let rail = electron.windows().find(p => p.url().includes('part=rail'));
    await expect.poll(() => !!(rail = electron.windows().find(p => p.url().includes('part=rail')))).toBe(true);
    await expect(rail!.getByRole('button', { name: /^Scheduler:/ })).toHaveAttribute('aria-label', /1 running/);
    await rail!.getByRole('button', { name: /^Scheduler:/ }).dispatchEvent('click');
    let panel = electron.windows().find(p => p.url().includes('part=panel'));
    await expect.poll(() => !!(panel = electron.windows().find(p => p.url().includes('part=panel')))).toBe(true);
    await expect(panel!.locator('.cc-row').filter({ hasText: 'Squad status fixture' })).toContainText('Running');
    await expect(panel!.getByRole('button', { name: 'Run Squad status fixture now' })).toHaveCount(0);
    await expect(panel!.getByRole('button', { name: 'Run Completed Squad fixture now' })).toBeVisible();
    const snapshot = await rail!.evaluate(() => window.cc.companion.request());
    expect(snapshot.counts.runningSchedules).toBe(1);
    expect(snapshot.schedules.find(t => t.id === completed.value.id)?.running).toBe(false);
  } finally {
    await window.evaluate(id => window.cc.scheduler.delete(id), taskId);
    await window.evaluate(id => window.cc.scheduler.delete(id), completed.value.id);
  }
});
