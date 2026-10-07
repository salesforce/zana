import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createSqliteDatabase } from '../packages/db/src/sqlite.js';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('settings pages load only on navigation in built Electron', async ({ app }) => {
  const page = app.window;
  const loaded = () => page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/SettingsView-[^/]+\.js/.test(name)));
  expect(await loaded()).toEqual([]);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Preferences', exact: true })).toBeVisible();
  await expect.poll(loaded).toHaveLength(1);
  await page.getByTestId('settings-nav-performance').click();
  await expect(page.getByTestId('performance-view')).toBeVisible();
  await page.getByRole('link', { name: 'Back to app', exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByTestId('performance-view')).toBeVisible();
  expect(await loaded()).toHaveLength(1);
});

test('outline snapshots remain correct across large histories and external edits in built Electron', async ({ app }, testInfo) => {
  test.setTimeout(120_000);
  const page = app.window;
  const thread = await page.evaluate(async () => {
    const project = (await window.cc.projects.list())[0]!;
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.id, providerId: 'fake', input: 'Outline fixture' }) });
    if (!response.ok) throw Error(await response.text());
    return (await response.json()).thread;
  });
  await expect.poll(() => page.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, thread.id)).toBe('idle');
  const db = createSqliteDatabase(join(app.home, '.zcc', 'zcc.sqlite'));
  try {
    db.pragma('busy_timeout = 5000');
    let seq = (db.prepare('SELECT MAX(sequence) AS n FROM thread_events WHERE thread_id=?').get(thread.id) as { n: number }).n;
    const insert = db.prepare('INSERT INTO thread_events(id,thread_id,sequence,type,payload,created_at) VALUES (?,?,?,?,?,?)');
    const add = (type: string, turnId: string, fields: object) => {
      const id = randomUUID();
      insert.run(id, thread.id, ++seq, type, JSON.stringify({ type, threadId: thread.id, providerThreadId: 'fixture', scope: type === 'client/turn/requested' ? { kind: 'thread' } : { kind: 'turn', turnId }, ...fields }), Date.now());
      return id;
    };
    let editedEventId = '';
    db.transaction(() => {
      for (let turn = 0; turn < 300; turn++) {
        const turnId = `outline-${turn}`;
        add('client/turn/requested', turnId, { requestId: `request-${turn}`, source: 'tell', initiator: 'user', senderThreadId: null, target: { kind: 'new-turn' }, input: [{ type: 'text', text: `Outline question ${turn}`, mentions: [] }] });
        add('turn/started', turnId, {});
        const eventId = add('item/completed', turnId, { item: { id: `answer-${turn}`, type: 'agentMessage', text: `Outline answer ${turn}` } });
        if (turn === 150) editedEventId = eventId;
        // Large non-outline work stays outside the retained result.
        for (let work = 0; work < 30; work++) add('item/completed', turnId, { item: { id: `work-${turn}-${work}`, type: 'commandExecution', command: 'echo fixture', status: 'completed', aggregatedOutput: 'x'.repeat(256) } });
        add('turn/completed', turnId, { status: 'completed' });
      }
    })();
    const read = () => page.evaluate(async id => {
      const start = performance.now();
      const response = await fetch(`/api/v1/threads/${id}/conversation-outline`);
      if (!response.ok) throw Error(await response.text());
      const body = await response.json();
      return { body, durationMs: performance.now() - start };
    }, thread.id);
    const cold = await read();
    await testInfo.attach('outline-cold.json', { body: JSON.stringify(cold), contentType: 'application/json' });
    expect(cold.body.items.filter((item: { preview: string }) => item.preview.startsWith('Outline question '))).toHaveLength(300);
    expect(cold.body.items.filter((item: { preview: string }) => item.preview.startsWith('Outline answer '))).toHaveLength(300);
    const warmMs: number[] = [];
    for (let sample = 0; sample < 8; sample++) { const warm = await read(); expect(warm.body).toEqual(cold.body); warmMs.push(warm.durationMs); }
    db.prepare("UPDATE thread_events SET payload=json_set(payload,'$.item.text',?) WHERE id=?").run('Edited interior answer', editedEventId);
    const edited = await read();
    expect(edited.body.maxSeq).toBe(cold.body.maxSeq);
    expect(edited.body.items.some((item: { preview: string }) => item.preview === 'Edited interior answer')).toBe(true);
    db.prepare('DELETE FROM thread_events WHERE id=?').run(editedEventId);
    const deleted = await read();
    expect(deleted.body.maxSeq).toBe(cold.body.maxSeq);
    expect(deleted.body.items.some((item: { preview: string }) => item.preview === 'Edited interior answer')).toBe(false);
    const rosterResponse = await page.evaluate(async projectId => {
      const response = await fetch(`/api/v1/threads?projectId=${projectId}`);
      return { status: response.status, body: await response.json() };
    }, thread.projectId);
    expect(rosterResponse.status).toBe(200);
    const timings = { events: 300 * 34, coldMs: cold.durationMs, warmMs, editedMs: edited.durationMs, note: 'Cold vs warm HTTP requests in built Electron; timing is observational, correctness assertions are deterministic.' };
    const timingPath = testInfo.outputPath('outline-product-http-timings.json');
    await import('node:fs/promises').then(fs => fs.writeFile(timingPath, JSON.stringify(timings, null, 2)));
    await testInfo.attach('outline-product-http-timings.json', { path: timingPath, contentType: 'application/json' });
  } finally { db.close(); }
});

test('hidden split threads suspend timeline reads and catch up with their draft intact', async ({ app }) => {
  const page = app.window;
  const id = await page.evaluate(async () => {
    const project = (await window.cc.projects.list())[0]!;
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.id, providerId: 'fake', input: 'Split refresh fixture', title: 'Hidden refresh fixture' }) });
    if (!response.ok) throw Error(await response.text());
    return (await response.json()).thread.id as string;
  });
  await expect.poll(() => page.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, id)).toBe('idle');
  await page.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, id);
  const detail = page.getByTestId('thread-detail');
  await expect(detail.getByTestId('thread-timeline')).toContainText('Response to: Split refresh fixture');
  await detail.getByTestId('thread-command-input').fill('Draft retained while hidden');
  const workspace = page.getByTestId('split-workspace');
  const from = (await page.getByTestId('nav-inbox').boundingBox())!;
  const to = (await workspace.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width * 0.9, to.y + to.height * 0.5, { steps: 12 });
  await expect(page.locator('.split-drag-overlay-label')).toHaveText('Split right');
  await page.mouse.up();
  await expect(workspace).toHaveAttribute('data-split', 'true');
  const inbox = workspace.locator('.split-pane').filter({ has: page.locator('.split-pane-bar-title', { hasText: 'Inbox' }) });
  await inbox.getByRole('button', { name: 'Maximize pane', exact: true }).click();
  await expect(detail).toBeHidden();
  let reads = 0;
  page.on('request', request => { if (request.url().includes(`/api/v1/threads/${id}/timeline`)) reads++; });
  for (const text of ['Hidden response one', 'Hidden response two']) {
    await page.evaluate(async ({ id, text }) => {
      const response = await fetch(`/api/v1/threads/${id}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: text }) });
      if (!response.ok) throw Error(await response.text());
    }, { id, text });
    await expect.poll(() => page.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, id)).toBe('idle');
  }
  // Past the refresh coalescing ceiling, after real event and status pushes.
  await page.waitForTimeout(500);
  expect(reads).toBe(0);
  await inbox.getByRole('button', { name: 'Restore pane', exact: true }).click();
  await expect(detail.getByTestId('thread-timeline')).toContainText('Response to: Hidden response two');
  await expect(detail.getByTestId('thread-command-input')).toHaveText('Draft retained while hidden');
  expect(reads).toBeGreaterThan(0);
  await page.setViewportSize({ width: 680, height: 900 });
  await expect(workspace).toHaveAttribute('data-split', 'false');
  await expect(detail).toBeHidden();
  reads = 0;
  await page.evaluate(async id => {
    const response = await fetch(`/api/v1/threads/${id}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'Compact hidden response' }) });
    if (!response.ok) throw Error(await response.text());
  }, id);
  await expect.poll(() => page.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, id)).toBe('idle');
  await page.waitForTimeout(500);
  expect(reads).toBe(0);
  await page.setViewportSize({ width: 1480, height: 960 });
  await expect(detail.getByTestId('thread-timeline')).toContainText('Response to: Compact hidden response');
  await expect(detail.getByTestId('thread-command-input')).toHaveText('Draft retained while hidden');
});
