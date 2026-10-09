import { test, expect } from './fixtures/app.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createSqliteDatabase } from '../packages/db/src/sqlite.js';
import type { RuntimePerformanceSnapshot } from '../packages/desktop-contract/src/performance.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('Performance shows real utility metrics, heartbeat, charts and refresh failures in built Electron', async ({ app }, testInfo) => {
  const win = app.window;
  await win.getByRole('link', { name: 'Settings', exact: true }).click();
  await win.getByRole('combobox', { name: 'Search settings' }).fill('daemon');
  // A query shows ranked result rows (not the nav list); open the Performance page result.
  await win.getByRole('option').filter({ hasText: 'Performance' }).first().click();
  const panel = win.getByTestId('performance-view');
  await expect(panel).toBeVisible();
  await expect.poll(async () => {
    const snapshot = await win.evaluate(() => window.cc.app.performance());
    return snapshot?.processes.map(process => process.role).sort();
  }).toEqual(['daemon', 'server']);
  let snapshot: RuntimePerformanceSnapshot | null = null;
  await expect.poll(async () => {
    snapshot = await win.evaluate(() => window.cc.app.performance());
    return snapshot?.processes.every(process => process.cpuPercent !== null && process.memoryBytes !== null && process.memoryBytes > 0);
  }, { timeout: 20_000, intervals: [5_100] }).toBe(true);
  expect(snapshot!.hostId).toBeTruthy();
  for (const process of snapshot!.processes) {
    expect(process.pid).toBeGreaterThan(0); expect(process.createdAt).toBeLessThan(snapshot!.sampledAt);
  }
  await expect(panel.getByText('Connected', { exact: true })).toBeVisible();
  await expect(panel.getByRole('img')).toHaveCount(3, { timeout: 20_000 });
  await expect.poll(async () => win.evaluate(async id => {
    const response = await fetch(`/api/v1/hosts/${id}/performance`);
    return (await response.json()).lastHeartbeatAt;
  }, snapshot!.hostId), { timeout: 25_000 }).not.toBeNull();
  await panel.getByRole('button', { name: 'Copy diagnostics' }).click();
  await expect(panel.getByText('Diagnostics copied')).toBeVisible();
  const copied = await app.electron.evaluate(({ clipboard }) => JSON.parse(clipboard.readText()));
  expect(copied.resources.processes).toHaveLength(2); expect(copied).not.toHaveProperty('token');
  await win.screenshot({ path: testInfo.outputPath('performance.png'), animations: 'disabled' });

  await win.route('**/api/v1/hosts/*/performance', route => route.fulfill({ status: 503, json: { error: 'offline' } }));
  await panel.getByRole('button', { name: 'Refresh' }).click();
  await expect(panel.getByRole('alert')).toContainText('could not be refreshed');
  await expect(panel.getByText('Connection data stale')).toBeVisible();
  await win.unroute('**/api/v1/hosts/*/performance');
  await panel.getByRole('button', { name: 'Refresh' }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await win.setViewportSize({ width: 800, height: 740 });
  await expect.poll(() => panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await win.screenshot({ path: testInfo.outputPath('performance-narrow.png'), animations: 'disabled' });
});

test('Performance keeps remote resources unavailable and stops polling after navigation', async ({ app }) => {
  const win = app.window;
  const hosts = await win.evaluate(() => window.cc.hosts.list());
  const remote = { ...hosts[0]!, id: 'remote-performance', name: 'Remote test machine', isPrimary: false, status: 'disconnected' };
  await win.route('**/api/v1/hosts', route => route.fulfill({ json: [...hosts, remote] }));
  let remoteRequests = 0;
  let remoteConnected = false;
  await win.route('**/api/v1/hosts/remote-performance/performance', route => {
    remoteRequests++;
    return route.fulfill({ json: { hostId: remote.id, sampledAt: Date.now(), connected: remoteConnected, connectedAt: remoteConnected ? 1 : null, lastHeartbeatAt: null,
      workload: { activeThreads: 3, threadStates: { starting: 0, active: 2, waiting: 1, stopping: 0 }, terminals: 0, truncated: false }, threads: [], recentConnections: [] } });
  });
  await win.getByRole('link', { name: 'Settings', exact: true }).click();
  await win.getByTestId('settings-nav-performance').click();
  const panel = win.getByTestId('performance-view');
  await panel.getByRole('combobox', { name: 'Performance machine' }).selectOption(remote.id);
  await expect(panel.getByText(/Remote resource metrics are not available yet/)).toBeVisible();
  await expect(panel.locator('.performance-metric').filter({ hasText: 'Daemon CPU' })).toContainText('Unavailable');
  await expect(panel.getByText('Last known workload')).toBeVisible();
  await expect(panel.getByRole('img', { name: /Thread load/ })).toHaveCount(0);
  remoteConnected = true;
  await panel.getByRole('button', { name: 'Refresh' }).click();
  await expect(panel.getByRole('img', { name: /Thread load trend. Observed peak 3/ })).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByRole('img', { name: /CPU trend|Memory trend/ })).toHaveCount(0);
  await panel.getByRole('link', { name: 'Open Machines' }).click();
  await expect(win).toHaveURL(/\/settings\/machines$/);
  const count = remoteRequests;
  // Wait beyond one real sample interval to prove unmounted UI does no work.
  await new Promise(resolve => setTimeout(resolve, 5_500));
  expect(remoteRequests).toBe(count);
});

test('Performance reads real active and waiting threads and opens the selected conversation', async ({ app }, testInfo) => {
  const win = app.window;
  const project = (await win.evaluate(() => window.cc.projects.list()))[0]!;
  const request = (path: string, body?: unknown) => win.evaluate(async ({ path, body }) => {
    const response = await fetch(`/api/v1/${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return response.json();
  }, { path, body });
  const active = await request('threads', { projectId: project.id, providerId: 'fake', input: 'delay:60000 workload test', title: 'Performance active work' });
  let waitingId: string | undefined;
  try {
    const waiting = await request('threads', { projectId: project.id, providerId: 'fake', input: 'delay:60000 waiting workload fixture', title: 'Performance needs input',
      environment: { kind: 'reuse', environmentId: active.thread.environmentId } });
    waitingId = waiting.thread.id;
    // The app's fake adapter disables native questions. Seed only the durable
    // interaction fact in this test's isolated HOME; counts and navigation use
    // the real server and renderer, with both conversations actually running.
    const db = createSqliteDatabase(join(app.home, '.zcc', 'zcc.sqlite'));
    try {
      db.pragma('busy_timeout = 5000');
      const now = Date.now();
      db.prepare(`INSERT INTO pending_interactions
        (id, thread_id, origin_kind, turn_id, provider_id, provider_thread_id, provider_request_id, status, payload, created_at, updated_at)
        VALUES (?, ?, 'provider', 'performance-turn', 'fake', ?, ?, 'pending', ?, ?, ?)`).run(randomUUID(), waitingId, `fixture-${waitingId}`, randomUUID(),
        JSON.stringify({ kind: 'user_question', questions: [{ id: 'workload', prompt: 'Performance question', options: [{ value: 'yes', label: 'Yes' }], multiSelect: false, allowFreeText: true }] }), now, now);
    } finally { db.close(); }
    await expect.poll(async () => (await request(`hosts/${active.thread.hostId}/performance`)).workload.threadStates).toEqual({ starting: 0, active: 1, waiting: 1, stopping: 0 });
    await win.getByRole('link', { name: 'Settings', exact: true }).click();
    await win.getByTestId('settings-nav-performance').click();
    const panel = win.getByTestId('performance-view');
    const list = panel.getByRole('list', { name: 'Threads in progress' });
    const links = list.getByRole('link');
    await expect(links).toHaveCount(2);
    await expect(links.first()).toContainText('Performance needs input');
    await expect(links.first()).toContainText('Waiting for input');
    await expect(links.first()).toContainText(`${project.name} · Provider: fake`);
    await expect(links.last()).toContainText('Active');
    await list.scrollIntoViewIfNeeded();
    await win.screenshot({ path: testInfo.outputPath('performance-threads.png'), animations: 'disabled' });
    await links.first().click();
    await expect(win).toHaveURL(new RegExp(`/projects/${project.id}/threads/${waiting.thread.id}$`));
    await expect(win.getByTestId('thread-timeline')).toBeVisible();
  } finally {
    await request(`threads/${active.thread.id}/stop`, {});
    if (waitingId) await request(`threads/${waitingId}/stop`, {});
  }
});
