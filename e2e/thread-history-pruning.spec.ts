import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createSqliteDatabase } from '../packages/db/src/sqlite.js';
import { test, expect } from './fixtures/app.js';
import { waitForThreadProvider } from './fixtures/thread-providers.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('background history cleanup preserves answers, output, capacity and continuation', async ({ app }) => {
  test.setTimeout(130_000);
  const { window, home } = app;
  await waitForThreadProvider(window, 'codex');
  const id = await window.evaluate(async () => {
    const project = (await window.cc.projects.list())[0];
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, providerId: 'codex', input: 'Pruning regression' }) });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  });
  await expect.poll(() => window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, id)).toBe('idle');
  const pids = () => app.electron.evaluate(({ app }) => app.getAppMetrics()
    .filter(metric => /(?:server|host)-runtime\.js/.test(metric.name ?? '')).map(metric => metric.pid).sort());
  const beforePids = await pids();
  const db = createSqliteDatabase(join(home, '.zcc', 'zcc.sqlite'));
  let lastSequence = 0;
  const fixtureIds: Record<string, string[]> = {};
  try {
    db.pragma('busy_timeout = 5000');
    let seq = (db.prepare('SELECT MAX(sequence) AS seq FROM thread_events WHERE thread_id = ?').get(id) as { seq: number }).seq;
    const insert = db.prepare('INSERT INTO thread_events (id, thread_id, sequence, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const add = (type: string, fields: object = {}) => {
      const eventId = randomUUID();
      insert.run(eventId, id, ++seq, type, JSON.stringify({ type, threadId: id, providerThreadId: 'fixture',
        scope: { kind: 'turn', turnId: 'prune-turn' }, ...fields }), Date.now());
      (fixtureIds[type] ??= []).push(eventId);
    };
    db.transaction(() => {
      add('turn/started');
      for (let i = 0; i < 10; i++) {
        add('thread/contextWindowUsage/updated', { contextWindowUsage: { usedTokens: 100 + i, modelContextWindow: i === 0 ? 200000 : null, estimated: false } });
        const usage = { totalTokens: 100 + i, inputTokens: 80, cachedInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 0 };
        add('thread/tokenUsage/updated', { tokenUsage: { total: usage, last: usage, modelContextWindow: null } });
        add('provider/rateLimits/updated', { rateLimits: { providerId: 'codex', status: 'allowed', kind: 'unknown', windows: [],
          reachedReason: null, overageStatus: null, overageReason: null } });
        add('item/agentMessage/delta', { itemId: 'prune-answer', delta: 'fragment ' });
        add('item/commandExecution/outputDelta', { itemId: 'prune-command', delta: 'fragment ' });
      }
      add('item/completed', { item: { type: 'agentMessage', id: 'prune-answer', text: 'Preserved final answer' } });
      add('item/completed', { item: { type: 'commandExecution', id: 'prune-command', command: 'echo result', cwd: '/',
        status: 'completed', approvalStatus: 'not-requested', aggregatedOutput: 'Preserved command output ' + 'x'.repeat(17 * 1024), exitCode: 0 } });
      const task = { type: 'backgroundTask', id: 'prune-task', taskType: 'local_bash', description: 'Completed background command',
        status: 'pending', taskStatus: 'running', skipTranscript: false };
      add('item/started', { item: task });
      for (let i = 0; i < 10; i++) add('item/backgroundTask/progress', { scope: { kind: 'thread' }, item: task });
      add('item/backgroundTask/completed', { scope: { kind: 'thread' }, item: { ...task, status: 'completed', taskStatus: 'completed', summary: 'Preserved task result' } });
      add('turn/completed', { status: 'completed' });
      lastSequence = seq;
    })();
    const counts = () => Object.fromEntries(Object.entries(fixtureIds).map(([type, ids]) => [type,
      (db.prepare(`SELECT COUNT(*) AS count FROM thread_events WHERE id IN (${ids.map(() => '?').join(',')})`).get(...ids) as { count: number }).count
    ]));
    await window.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, id);
    await expect(window.getByTestId('thread-timeline')).toContainText('Preserved final answer');
    // Run the actual product-context timer, without a test-only cleanup endpoint.
    await expect.poll(counts, { timeout: 90_000, intervals: [1000, 2000, 5000] }).toMatchObject({
      'thread/contextWindowUsage/updated': 2, 'thread/tokenUsage/updated': 1, 'provider/rateLimits/updated': 1,
      'item/agentMessage/delta': 1, 'item/commandExecution/outputDelta': 1, 'item/backgroundTask/progress': 0,
      'item/completed': 2, 'item/started': 1, 'item/backgroundTask/completed': 1, 'turn/completed': 1
    });
    expect(await pids()).toEqual(beforePids);
    expect((db.prepare('SELECT MAX(sequence) AS seq FROM thread_events WHERE thread_id = ?').get(id) as { seq: number }).seq).toBe(lastSequence);
    const view = await window.evaluate(async id => {
      const response = await fetch(`/api/v1/threads/${id}/timeline?includeNestedRows=true&summaryOnly=false`);
      return { status: response.status, body: await response.json() };
    }, id);
    expect(view.status).toBe(200);
    expect(view.body.contextWindowUsage).toMatchObject({ modelContextWindow: 200000, usedTokens: 109 });
    expect(JSON.stringify(view.body.rows)).toContain('Preserved final answer');
    expect(JSON.stringify(view.body.rows)).toContain('Preserved command output');
    expect(JSON.stringify(view.body.rows)).toContain('Preserved task result');
    const support = window.getByRole('dialog', { name: 'Support Zana' });
    if (await support.isVisible().catch(() => false)) await support.getByRole('button', { name: 'Dismiss' }).click();
    const composer = window.getByTestId('thread-detail').locator('.thread-command-composer');
    await composer.getByTestId('thread-command-input').fill('Continue after cleanup');
    await composer.getByTestId('thread-command-input').press('Enter');
    await expect(window.getByTestId('thread-timeline')).toContainText('Response to: Continue after cleanup', { timeout: 30_000 });
    expect(await pids()).toEqual(beforePids);
  } finally { db.close(); }
});
