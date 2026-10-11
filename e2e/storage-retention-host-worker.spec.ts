import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

// The plugin ships installed but disabled; once enabled, its host entry must
// receive the daemon-owned thread-storage root and measure a thread's folder.
test('Storage & retention installs disabled and scans thread storage through its host worker', async ({ app }) => {
  test.setTimeout(180_000);
  const { window, home } = app;
  const root = join(home, 'storage-retention-project'); mkdirSync(root);
  const setup = await window.evaluate(async path => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Storage scan' }) });
    const thread = await response.json(); if (!response.ok) throw new Error(JSON.stringify(thread));
    const hosts = await fetch('/api/v1/hosts').then(r => r.json());
    return { threadId: (thread.thread ?? thread.value).id as string, hostId: hosts.find((h: any) => h.isPrimary).id as string };
  }, root);

  const pluginState = () => window.evaluate(async () => {
    const plugin = (await window.cc.pluginApps.list()).find(row => row.id === 'storage-retention');
    return { status: plugin?.status, detail: plugin?.statusDetail ?? null };
  });
  await expect.poll(pluginState, { timeout: 30_000 }).toMatchObject({ status: 'disabled' });

  const folder = join(home, '.zcc', 'thread-storage', setup.threadId);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'output.bin'), Buffer.alloc(64 * 1024, 1));

  await window.evaluate(() => window.cc.pluginApps.setEnabled('storage-retention', true));
  await expect.poll(pluginState, { timeout: 60_000 }).toMatchObject({ status: 'running', detail: null });

  const call = async (method: string, args: unknown) => {
    const result = await window.evaluate(async ({ method, args }) => {
      const response = await fetch('/api/v1/plugin-apps/storage-retention/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }) });
      return { status: response.status, body: await response.json() };
    }, { method, args });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return result.body.value;
  };

  const state = await call('state', null);
  expect(state.policy).toEqual({ archiveAfterDays: null, clearAfterDays: null, clearStorageOnArchive: false });

  await call('scanHost', { hostId: setup.hostId });
  await expect.poll(async () => {
    const state = await call('host', { hostId: setup.hostId });
    if (state.scan.state === 'failed') throw new Error(state.scan.message);
    return state.scan.state === 'scanning' ? null : state.report;
  }, { timeout: 90_000 }).not.toBeNull();

  const { report } = await call('host', { hostId: setup.hostId });
  expect(report.hostId).toBe(setup.hostId);
  expect(report.activeThreadBytes).toBeGreaterThanOrEqual(64 * 1024);
  expect(report.largestThreads.map((thread: { threadId: string }) => thread.threadId)).toContain(setup.threadId);
});
