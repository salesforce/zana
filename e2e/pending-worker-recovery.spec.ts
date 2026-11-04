import { test, expect, launchApp } from './fixtures/app.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectIdentityDigest } from '../apps/server/src/services/launch/commit-revalidation.js';

test('desktop and browser can check unknown workers without repeating a reserved launch', async ({ home }) => {
  test.setTimeout(180_000);
  const projectId = 'recovery-project', root = join(home, projectId), data = join(home, '.zcc');
  mkdirSync(root, { recursive: true }); mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'projects.json'), JSON.stringify({ version: 1, projects: [{ id: projectId, name: 'Recovery project', path: root, createdAt: 1, lastActiveAt: 1 }] }));
  const goalId = randomUUID(), scheduleId = randomUUID(), goalWorker = randomUUID(), scheduleWorker = randomUUID(), at = new Date().toISOString();
  const goalPath = join(data, 'goals', `${goalId}.json`), schedulePath = join(data, 'schedules', `${scheduleId}.json`);
  mkdirSync(join(data, 'goals')); mkdirSync(join(data, 'schedules'));
  writeFileSync(goalPath, JSON.stringify({ id: goalId, projectId, title: 'Goal needs recovery', statement: 'Do not replay this launch', status: 'paused', assignment: { kind: 'profile', profile: 'shell' }, iteration: 0,
    history: { retain: 10, iterations: [{ id: randomUUID(), at, sessionId: goalWorker, launchState: 'pending' }] }, createdAt: at, updatedAt: at }));
  writeFileSync(schedulePath, JSON.stringify({ id: scheduleId, projectId, name: 'Schedule needs recovery', enabled: false, profile: 'shell', schedule: { every: '1d' }, inboxLevel: 'silent',
    status: { runCount: 0, runs: [{ id: randomUUID(), at, sessionId: scheduleWorker, launchState: 'pending', result: 'skipped' }] }, createdAt: at, updatedAt: at }));
  const app = await launchApp(home);
  try {
    const opened = app.electron.waitForEvent('window');
    await app.electron.evaluate(({ BrowserWindow }, url) => {
      const client = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      void client.loadURL(url);
    }, app.window.url());
    const browser = await opened, errors: string[] = [], requests: string[] = [];
    browser.on('pageerror', error => { if (errors.length < 20) errors.push(error.message); });
    browser.on('console', message => { if (message.type() === 'error' && errors.length < 20) errors.push(message.text().slice(0, 500)); });
    browser.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/')) {
        let method = '';
        if (path === '/api/v1/shared-product') {
          try { method = request.postDataJSON()?.method ?? ''; } catch { /* diagnostic only */ }
        }
        requests.push(`${request.method()} ${path} ${method}`); if (requests.length > 60) requests.shift();
      }
    });
    await browser.waitForLoadState('domcontentloaded');
    expect(await browser.evaluate(() => typeof window.cc)).toBe('undefined');
    for (const page of [app.window, browser]) {
      for (const [path, worker] of [['/goals', goalWorker], [`/schedules/${scheduleId}`, scheduleWorker]]) {
        await page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
        const recovery = page.getByTestId('pending-worker-recovery');
        await expect(recovery).toBeVisible().catch(error => { throw new Error(`${error}\nBrowser errors: ${errors.join('\n')}\nRequests: ${requests.join('\n')}`); });
        await recovery.getByText('Worker details').click(); await expect(recovery.getByText(worker, { exact: true })).toBeVisible();
        await recovery.getByRole('button', { name: 'Check worker' }).click();
        await expect(recovery).toContainText('worker is still unconfirmed');
        const controls = path === '/goals' ? page.locator('.scheduler-card').filter({ hasText: 'Goal needs recovery' }) : page.getByTestId('schedule-info-panel');
        // Goals keep Resume; a schedule's on/off toggle is Enable (Resume there means reopening a conversation).
        await expect(controls.getByRole('button', { name: path === '/goals' ? 'Resume' : 'Enable', exact: true })).toBeDisabled();
        await expect(controls.getByRole('button', { name: 'Run now', exact: true })).toBeDisabled();
      }
    }
    expect(await app.window.evaluate(id => window.cc.terminals.list(id), projectId)).toEqual([]);
    expect(JSON.parse(readFileSync(goalPath, 'utf8'))).toMatchObject({ status: 'paused', iteration: 0, history: { iterations: [expect.objectContaining({ sessionId: goalWorker, launchState: 'pending' })] } });
    expect(JSON.parse(readFileSync(schedulePath, 'utf8'))).toMatchObject({ enabled: false, status: { runCount: 0, runs: [expect.objectContaining({ sessionId: scheduleWorker, launchState: 'pending' })] } });
    expect(await app.window.evaluate(() => window.cc.goals.reconcile('missing'))).toMatchObject({ ok: false, code: 'RECOVERY_FAILED' });
    const invalid = await browser.evaluate(async () => (await fetch('/api/v1/shared-product', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'scheduler.reconcile', args: [{ forged: 'id' }] }) })).json());
    expect(invalid.value).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    await browser.close();
  } finally { await app.electron.close(); }
});

test('desktop and browser resolve durable no-spawn and exit evidence without launching replacement workers', async ({ home }) => {
  test.setTimeout(180_000);
  const projectId = 'evidence-project', root = join(home, projectId), data = join(home, '.zcc'), at = new Date().toISOString();
  mkdirSync(root, { recursive: true }); mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'projects.json'), JSON.stringify({ version: 1, projects: [{ id: projectId, name: 'Evidence project', path: root, createdAt: 1, lastActiveAt: 1 }] }));
  const records = ['goal', 'schedule', 'goal', 'schedule'].map((kind, i) => ({ kind, id: randomUUID(), sessionId: randomUUID(), state: i < 2 ? 'denied' : 'exited' }));
  for (const record of records) {
    const dir = join(data, record.kind === 'goal' ? 'goals' : 'schedules'); mkdirSync(dir, { recursive: true });
    const reservation = { id: randomUUID(), at, sessionId: record.sessionId, launchState: 'pending' };
    writeFileSync(join(dir, `${record.id}.json`), JSON.stringify(record.kind === 'goal'
      ? { id: record.id, projectId, title: `Recovery ${record.id}`, statement: 'Never replay', status: 'paused', assignment: { kind: 'profile', profile: 'shell' }, iteration: 0, history: { retain: 10, iterations: [reservation] }, createdAt: at, updatedAt: at }
      : { id: record.id, projectId, name: `Recovery ${record.id}`, enabled: false, profile: 'shell', schedule: { every: '1d' }, inboxLevel: 'silent', status: { runCount: 0, runs: [{ ...reservation, result: 'skipped' }] }, createdAt: at, updatedAt: at }));
  }
  const app = await launchApp(home);
  try {
    const opened = app.electron.waitForEvent('window');
    await app.electron.evaluate(({ BrowserWindow }, url) => {
      const client = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); void client.loadURL(url);
    }, app.window.url());
    const browser = await opened; await browser.waitForLoadState('domcontentloaded');
    const project = (await app.window.evaluate(() => window.cc.projects.list())).find(row => row.id === projectId)!;
    const userData = await app.electron.evaluate(({ app }) => app.getPath('userData'));
    for (const [i, record] of records.entries()) {
      const page = i < 2 ? app.window : browser;
      const path = record.kind === 'goal' ? '/goals' : `/schedules/${record.id}`;
      await page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
      const controls = record.kind === 'goal' ? page.locator('.scheduler-card').filter({ hasText: `Recovery ${record.id}` }) : page.getByTestId('schedule-info-panel');
      await expect(controls.getByTestId('pending-worker-recovery')).toBeVisible();
      // Recovering one goal refreshes the goal catalog. Reveal only this worker's
      // evidence so that refresh cannot resolve later fixtures before their click.
      writeFileSync(join(userData, 'launch-ledger.json'), JSON.stringify({ version: 1, revision: i + 1, entries: [{
        id: randomUUID(), idempotencyKey: record.id, launchDigest: 'fixture', authorizationId: randomUUID(), sessionId: record.sessionId,
        principal: { kind: record.kind === 'goal' ? 'automation' : 'schedule', id: `${record.kind}:${record.id}` },
        binding: { consumerKind: 'terminal', scope: 'local', initialTaskDigest: 'fixture', storeRevision: 'fixture', projectIdentityDigest: projectIdentityDigest(project), autonomous: false },
        state: record.state, revision: 1, createdAt: Date.now(), updatedAt: Date.now()
      }] }));
      await controls.getByRole('button', { name: 'Check worker' }).click();
      await expect(controls.getByTestId('pending-worker-recovery')).toHaveCount(0);
      await expect(controls.getByRole('button', { name: 'Run now', exact: true })).toBeEnabled();
      const persisted = JSON.parse(readFileSync(join(data, record.kind === 'goal' ? 'goals' : 'schedules', `${record.id}.json`), 'utf8'));
      expect(record.kind === 'goal' ? persisted.status : persisted.enabled).toBe(record.kind === 'goal' ? 'paused' : false);
      expect((record.kind === 'goal' ? persisted.history.iterations : persisted.status.runs)[0]).toMatchObject({ sessionId: record.sessionId, launchState: 'failed' });
    }
    expect(await app.window.evaluate(id => window.cc.terminals.list(id), projectId)).toEqual([]);
    await browser.close();
  } finally { await app.electron.close(); }
});
