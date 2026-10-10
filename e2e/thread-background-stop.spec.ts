import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createSqliteDatabase } from '../packages/db/src/sqlite.js';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('a background command is stopped from its card row while the thread is idle', async ({ app }) => {
  test.setTimeout(120_000);
  const { window, home } = app;
  const id = await window.evaluate(async () => {
    const project = (await window.cc.projects.list())[0];
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, providerId: 'codex', input: 'Start the dev server' }) });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  });
  await expect.poll(() => window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, id)).toBe('idle');

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

  await window.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, id);
  const support = window.getByRole('dialog', { name: 'Support Zana' });
  if (await support.isVisible().catch(() => false)) await support.getByRole('button', { name: 'Dismiss' }).click();
  const card = window.getByTestId('thread-background-commands');
  await expect(card).toContainText('npm run dev');

  await card.getByRole('button', { name: 'Stop npm run dev' }).click();
  // The fake provider has no native stop, so the server asks the agent instead.
  await expect(card.locator('[data-stop-state="asked"]')).toContainText('Asked agent to stop');
  await expect(window.getByTestId('thread-timeline')).toContainText('Stop these running background tasks now: npm run dev', { timeout: 30_000 });
});
