import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createSqliteDatabase } from '../packages/db/src/sqlite.js';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('archiving a thread with a running background process warns, then settles it', async ({ app }) => {
  test.setTimeout(120_000);
  const { window, home } = app;
  const id = await window.evaluate(async () => {
    const project = (await window.cc.projects.list())[0];
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, providerId: 'codex', input: 'Start the dev server' }) });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  });
  const thread = () => window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread, id);
  await expect.poll(async () => (await thread()).status).toBe('idle');

  // A turn that ended while its background shell keeps running, like `npm run dev`.
  const db = createSqliteDatabase(join(home, '.zcc', 'zcc.sqlite'));
  try {
    db.pragma('busy_timeout = 5000');
    let seq = (db.prepare('SELECT MAX(sequence) AS seq FROM thread_events WHERE thread_id = ?').get(id) as { seq: number }).seq;
    const insert = db.prepare('INSERT INTO thread_events (id, thread_id, sequence, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const add = (type: string, fields: object = {}) => insert.run(randomUUID(), id, ++seq, type, JSON.stringify({ type, threadId: id,
      providerThreadId: 'fixture', scope: { kind: 'turn', turnId: 'dev-turn' }, ...fields }), Date.now());
    db.transaction(() => {
      add('turn/started');
      add('item/started', { item: { type: 'backgroundTask', id: 'dev-task', taskType: 'local_bash', description: 'npm run dev',
        status: 'pending', taskStatus: 'running', skipTranscript: false } });
      add('turn/completed', { status: 'completed' });
    })();
  } finally { db.close(); }
  await expect.poll(async () => (await thread()).activity?.activeBackgroundCommandCount).toBe(1);

  // The list row carries a process badge instead of the old bare dot.
  await window.reload();
  await window.evaluate(() => { history.pushState({}, '', '/agents'); dispatchEvent(new PopStateEvent('popstate')); });
  const badge = window.getByTestId('thread-process-badge').first();
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(badge).toHaveAttribute('aria-label', '1 background process running');

  await window.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, id);
  await expect(window.getByTestId('thread-background-commands')).toContainText('npm run dev');

  const prompts: string[] = [];
  window.on('dialog', dialog => {
    prompts.push(dialog.message());
    void dialog.accept();
  });
  await window.getByTestId('thread-overflow-trigger').click();
  await window.getByRole('menuitem', { name: 'Archive' }).click();
  await expect.poll(() => prompts.length).toBe(1);
  expect(prompts[0]).toContain('This agent still has a background process running, like a dev server. Ending its session stops it.');

  // Archive ends the session, so the archived thread must stop reporting the shell as running.
  await expect.poll(async () => Boolean((await thread()).archivedAt)).toBe(true);
  await expect.poll(async () => (await thread()).activity?.activeBackgroundCommandCount).toBe(0);
});
