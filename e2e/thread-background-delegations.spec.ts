import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createSqliteDatabase } from '../packages/db/src/sqlite.js';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('open child agents appear in the existing activity card across turns and history paging', async ({ app }) => {
  test.setTimeout(120_000);
  const { window, home } = app;
  const id = await window.evaluate(async () => {
    const project = (await window.cc.projects.list())[0];
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, providerId: 'codex', input: 'Check the changes' }) });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  });
  const read = () => window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread, id);
  await expect.poll(async () => (await read()).status).toBe('idle');

  const agent = (name: string, status = 'pending') => ({ type: 'delegation', id: `agent-${name}`, childRef: `child-${name}`,
    label: name === 'ci' ? 'Check GitHub CI' : 'Coding-session diagnostic', status, background: false });
  const append = (items: Array<{ type: string; fields?: object }>) => {
    const db = createSqliteDatabase(join(home, '.zcc', 'zcc.sqlite'));
    try {
      db.pragma('busy_timeout = 5000');
      let seq = (db.prepare('SELECT MAX(sequence) AS seq FROM thread_events WHERE thread_id = ?').get(id) as { seq: number }).seq;
      const insert = db.prepare('INSERT INTO thread_events (id, thread_id, sequence, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      db.transaction(() => {
        for (const { type, fields } of items) insert.run(randomUUID(), id, ++seq, type,
          JSON.stringify({ type, threadId: id, providerThreadId: 'fixture', scope: { kind: 'turn', turnId: 'parent' }, ...fields }), Date.now());
      })();
    } finally { db.close(); }
  };
  append([
    { type: 'turn/started' },
    { type: 'item/started', fields: { item: agent('ci') } },
    { type: 'item/started', fields: { item: agent('diagnostic') } },
    { type: 'turn/completed', fields: { status: 'completed' } },
    // Keep the starts outside even a generous latest history window.
    ...Array.from({ length: 30 }, (_, i) => ({ type: 'client/turn/requested', fields: {
      direction: 'outbound', source: 'tell', initiator: 'user', senderThreadId: null, target: { kind: 'new-turn' },
      request: { method: 'turn/start', params: {} },
      requestId: `later-${i}`, input: [{ type: 'text', text: `Later reply ${i}`, mentions: [] }], execution: {},
    } })),
  ]);
  await window.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, id);
  const support = window.getByRole('dialog', { name: 'Support Zana' });
  if (await support.isVisible().catch(() => false)) await support.getByRole('button', { name: 'Dismiss' }).click();
  const card = window.getByTestId('thread-background-commands');
  await expect(card).toContainText('Check GitHub CI');
  await expect(card).toContainText('Coding-session diagnostic');
  await expect(card.getByRole('button', { name: 'Stop Check GitHub CI', exact: true })).toHaveCount(1);
  expect((await read()).activity.activeBackgroundAgentCount).toBe(2);
  const narrow = await window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}/timeline?segmentLimit=1`)).json()), id);
  expect(narrow.activeBackgroundCommands.map((row: { itemId: string }) => row.itemId).sort()).toEqual(['agent-ci', 'agent-diagnostic']);

  await card.getByRole('button', { name: 'Stop Check GitHub CI', exact: true }).click();
  await expect(card.locator('[data-stop-state="asked"]')).toContainText('Asked agent to stop');
  await expect.poll(async () => (await read()).status).toBe('idle');
  await expect(card).toContainText('Coding-session diagnostic');
  const transcript = await window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}/timeline`)).json()), id);
  expect(JSON.stringify(transcript.rows)).toContain('Check GitHub CI (child-ci)');

  append([{ type: 'item/delegation/completed', fields: { scope: { kind: 'thread' }, item: agent('ci', 'completed') } }]);
  await window.reload();
  await expect(card).toContainText('Coding-session diagnostic');
  await expect(card).not.toContainText('Check GitHub CI');
  expect((await read()).activity.activeBackgroundAgentCount).toBe(1);
  append([{ type: 'item/delegation/completed', fields: { scope: { kind: 'thread' }, item: agent('diagnostic', 'interrupted') } }]);
  await window.reload();
  await expect(card).toHaveCount(0);
  expect((await read()).activity.activeBackgroundAgentCount).toBe(0);
});
