import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSqliteDatabase } from '../packages/db/src/sqlite.js';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { tmuxScope: 'off', sponsorPromptDismissed: true } });

test.afterEach(async ({ app }, info) => {
  if (info.status === info.expectedStatus) return;
  const data = await app.window.evaluate(async () => {
    const { threads } = await (await fetch('/api/v1/threads')).json();
    return Promise.all((threads ?? []).slice(0, 5).map(async (thread: { id: string }) => ({ thread,
      events: await (await fetch(`/api/v1/threads/${thread.id}/events?limit=30`)).json()
    })));
  }).catch(() => null);
  await info.attach('thread-state', { body: JSON.stringify(data, null, 2), contentType: 'application/json' });
});

test('project trees retain threads and CLI Agents while bundled thread navigation is active', async ({ app }) => {
  const { window, home } = app;
  const support = window.getByRole('dialog', { name: 'Support Zana' });
  if (await support.isVisible().catch(() => false)) await support.getByRole('button', { name: 'Dismiss' }).click();
  const root = join(home, 'thread-list-project'); mkdirSync(root);
  const bin = join(root, 'sidebar-agent.cjs');
  writeFileSync(bin, `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('2.1.220 (Claude Code)'); process.exit(0); }
process.stdout.write('CLI Agent ready\\n');
process.stdin.resume();
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  const { threadId, projectId } = await window.evaluate(async ({ path, bin }) => {
    await window.cc.config.set({ claudeBinary: bin });
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    const cli = await window.cc.terminals.create({ projectId: project.value.id, profile: 'claude', title: 'Sidebar CLI Agent', cols: 80, rows: 24 });
    if (!cli.ok) throw new Error(cli.message);
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Thread list check', title: 'Original thread' }) });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    history.pushState({}, '', '/agents'); dispatchEvent(new PopStateEvent('popstate'));
    return { threadId: body.thread.id as string, projectId: project.value.id };
  }, { path: root, bin });
  const list = window.getByTestId('plugin-thread-list');
  await expect.poll(() => window.evaluate(async () => {
    const entries = await window.cc.pluginApps.list();
    return entries.filter(entry => entry.id === 'thread-list');
  }), { timeout: 15_000 }).toMatchObject([{ id: 'thread-list', status: 'running' }]);
  await expect(list).toHaveCount(0);
  const cliRows = window.locator('.sidebar [data-kind="agent"]');
  await expect(cliRows).toHaveCount(1);
  const sidebar = window.locator('.sidebar');
  const sessions = sidebar.getByRole('list', { name: 'Sessions in thread-list-project', exact: true });
  await expect(sessions.getByTestId('project-thread-row')).toContainText('Original thread');
  await expect(sessions.locator('[data-kind="agent"]')).toContainText('Sidebar CLI Agent');
  await expect(sidebar.getByTestId('plugin-thread-list')).toHaveCount(0);
  await sidebar.getByRole('button', { name: 'Collapse sessions for thread-list-project', exact: true }).click();
  await expect(sessions).toHaveCount(0);
  await sidebar.getByRole('button', { name: 'Expand sessions for thread-list-project', exact: true }).click();
  await expect(sessions.getByTestId('project-thread-row')).toContainText('Original thread');
  await window.evaluate(async id => {
    const response = await fetch(`/api/v1/threads/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed project thread' })
    });
    if (!response.ok) throw new Error(await response.text());
  }, threadId);
  await expect(sessions.getByTestId('project-thread-row')).toContainText('Renamed project thread');
  await sidebar.getByRole('textbox', { name: 'Filter projects' }).fill('does not match');
  await expect(sessions).toHaveCount(0);
  await sidebar.getByRole('textbox', { name: 'Filter projects' }).clear();
  await expect(sessions.getByTestId('project-thread-row')).toContainText('Renamed project thread');
  await expect(cliRows).toHaveCount(1);
  const otherRoot = join(home, 'other-project'); mkdirSync(otherRoot);
  await window.evaluate(async path => {
    const other = await window.cc.projects.add(path);
    if (!other.ok) throw new Error(other.message);
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: other.value.id, providerId: 'fake', input: 'Other project check', title: 'Other project thread' }) });
    if (!response.ok) throw new Error(await response.text());
  }, otherRoot);
  await sidebar.getByRole('button', { name: 'Open thread-list-project', exact: true }).click();
  await expect(sidebar.getByTestId('project-session-rail')).toBeVisible();
  await expect(list).toHaveCount(0);
  await expect(sessions.getByTestId('project-thread-row')).toContainText('Renamed project thread');
  await expect(sidebar).not.toContainText('Other project thread');
  await expect(cliRows).toHaveCount(1);
  await sessions.getByTestId('project-thread-row').click();
  await expect(window).toHaveURL(new RegExp(`/projects/${projectId}/threads/${threadId}$`));
  await window.evaluate(async () => { const result = await window.cc.pluginApps.setEnabled('thread-list', false); if (!result.ok) throw new Error(result.message); });
  await expect(list).toHaveCount(0);
  await expect(window.locator('.sidebar [data-kind="thread"]')).toHaveCount(1);
  await expect(cliRows).toHaveCount(1);
  await window.evaluate(async () => { await window.cc.pluginApps.setEnabled('thread-list', true); });
  await expect.poll(() => window.evaluate(async () =>
    (await window.cc.pluginApps.list()).find(entry => entry.id === 'thread-list')?.status
  )).toBe('running');
  await expect(list).toHaveCount(0);
  await expect(sessions.getByTestId('project-thread-row')).toContainText('Renamed project thread');
  await expect(cliRows).toHaveCount(1);
  await window.reload();
  await expect(sessions.getByTestId('project-thread-row')).toContainText('Renamed project thread');
  await expect(cliRows).toHaveCount(1);
  await expect(sidebar.getByRole('searchbox', { name: 'Search threads' })).toHaveCount(0);
  await sessions.getByTestId('project-thread-row').click();
  await expect(window).toHaveURL(new RegExp(`/threads/${threadId}$`));
});

test('durable retry sweep sends safe failures and leaves ambiguous sends for manual recovery', async ({ app }) => {
  const { window, home } = app;
  const support = window.getByRole('dialog', { name: 'Support Zana' });
  if (await support.isVisible().catch(() => false)) await support.getByRole('button', { name: 'Dismiss' }).click();
  const root = join(home, 'queue-retry-project'); mkdirSync(root);
  const threadId = await window.evaluate(async path => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Initial turn' }) });
    const body = await response.json(); if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread.id as string;
  }, root);
  await expect.poll(() => window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, threadId)).toBe('idle');
  // Seed persisted delivery outcomes in this isolated HOME, as after a server restart.
  const db = createSqliteDatabase(join(home, '.zcc', 'zcc.sqlite'));
  try {
    const insert = db.prepare(`INSERT INTO deferred_thread_messages
      (id, thread_id, kind, payload, created_at, status, paused, failure_reason, failure_count, retry_at, updated_at)
      VALUES (?, ?, 'send', ?, ?, 'failed', 0, ?, 1, ?, ?)`);
    const now = Date.now();
    insert.run(randomUUID(), threadId, JSON.stringify({ kind: 'send', mode: 'queue-if-active', input: 'Automatically recovered' }), now, 'Host was busy', now + 1000, now);
    insert.run(randomUUID(), threadId, JSON.stringify({ kind: 'send', mode: 'queue-if-active', input: 'Manual recovery only' }), now + 1, 'Delivery timed out; check before retrying', null, now);
  } finally { db.close(); }
  await window.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, threadId);
  const timeline = window.getByTestId('thread-timeline');
  await expect(timeline).toContainText('Response to: Automatically recovered', { timeout: 30_000 });
  const queue = window.getByTestId('thread-queued-messages');
  await expect(queue).toContainText('Manual recovery only');
  await expect(timeline).not.toContainText('Response to: Manual recovery only');
  await queue.getByRole('button', { name: 'Send now', exact: true }).click();
  await expect(timeline).toContainText('Response to: Manual recovery only');
  await expect(queue).toHaveCount(0);
});
