import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { createSqliteDatabase } from '../packages/db/src/sqlite.js';
import { test, expect } from './fixtures/app.js';

test.skip(process.platform !== 'darwin', 'macOS companion surface');
test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true, initialConfig: { companionEnabled: true } });
async function part(electron: ElectronApplication, name: string): Promise<Page> {
  let page: Page | undefined;
  await expect.poll(() => !!(page = electron.windows().find(p => p.url().includes('surface=companion') && p.url().includes(`part=${name}`)))).toBe(true);
  await page!.waitForSelector('#root');
  return page!;
}

test('thread context clears when resolved and a disconnected error shows its recorded reason', async ({ app, home }) => {
  const { window, electron } = app;
  const thread = await window.evaluate(async () => {
    const { projects } = await (await fetch('/api/v1/projects')).json();
    const r = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: projects[0].id, providerId: 'fake', title: 'Context review', input: 'Review the routes before asking me.' }) });
    const b = await r.json(); if (!r.ok) throw new Error(JSON.stringify(b)); return b.thread;
  });
  await expect.poll(() => window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, thread.id)).toBe('idle');
  // Read the real completed provider turn; the host then raises a canonical
  // question against it, through the same authenticated transport as providers.
  const db = createSqliteDatabase(join(home, '.zcc', 'zcc.sqlite'));
  let payload: { scope: { turnId: string }; item: { text: string } };
  try {
    const row = db.prepare("SELECT id, payload FROM thread_events WHERE thread_id = ? AND type = 'item/completed' AND json_extract(payload, '$.item.type') = 'agentMessage' ORDER BY sequence DESC LIMIT 1").get(thread.id) as { id: string; payload: string };
    payload = JSON.parse(row.payload);
    // Make this isolated fixture genuinely overflow the two-line preview.
    payload.item.text = Array.from({ length: 6 }, (_, i) => `Review finding ${i + 1}: check the deployment route and verify the result before continuing.`).join('\n');
    db.prepare('UPDATE thread_events SET payload = ? WHERE id = ?').run(JSON.stringify(payload), row.id);
  } finally { db.close(); }
  const auth = JSON.parse(readFileSync(join(home, '.zcc', 'auth.json'), 'utf8'));
  const hostRequest = async (path: string, body: unknown) => {
    const r = await fetch(new URL(`/internal/hosts/${path}`, window.url()), { method: 'POST', headers: { 'content-type': 'application/json', 'x-zcc-host-id': auth.hostId, authorization: `Bearer ${auth.hostKey}` }, body: JSON.stringify(body) });
    const b = await r.json(); expect(r.ok, JSON.stringify(b)).toBe(true); return b;
  };
  // Activating Zana dismisses the companion, so activate the isolated fixture
  // before entering it. Synthetic panel clicks do not activate a macOS app.
  await electron.evaluate(({ app }) => app.focus({ steal: true }));
  await window.evaluate(() => window.cc.companion.enter());
  const rail = await part(electron, 'rail');
  const raiseQuestion = (providerRequestId: string) => hostRequest('interactive-request', { sessionId: thread.id, interaction: { threadId: thread.id, turnId: payload!.scope.turnId, providerId: 'fake', providerThreadId: 'fixture', providerRequestId, payload: { kind: 'user_question', questions: [
    { id: 'q1', prompt: 'Which route should I take?', multiSelect: false, allowFreeText: true, options: [{ value: 'a', label: 'Staging (Recommended)', description: 'Test the changes first.' }, { value: 'b', label: 'Production', description: 'Release the changes.' }] },
    { id: 'q2', prompt: 'What should I check afterwards?', multiSelect: true, allowFreeText: true, options: [{ value: 'tests', label: 'Tests' }] }
  ] } } });
  await raiseQuestion('context-question');
  const needs = rail.getByRole('button', { name: /^Needs you:/ });
  await expect(needs).toHaveAttribute('aria-label', /1 needs attention/, { timeout: 15000 });
  await needs.dispatchEvent('click');
  const panel = await part(electron, 'panel');
  const row = panel.getByRole('button', { name: /Which route should I take/ });
  await expect(row).toContainText(payload!.item.text);
  await expect(row).toContainText('2 questions');
  await row.dispatchEvent('click');
  await panel.bringToFront();
  await expect(panel.getByRole('region', { name: 'Last assistant message' })).toContainText(payload!.item.text);
  await expect(panel.getByRole('region', { name: 'Question 1 of 2' })).toContainText('Test the changes first.');
  const choices = panel.getByRole('region', { name: 'Question 1 of 2' });
  await expect(choices.locator('.cc-tag')).toHaveText('Recommended');
  await expect(choices.locator('.cc-option-label').first()).toContainText('Staging');
  await expect(choices).not.toContainText('(Recommended)');
  await expect(panel.getByRole('region', { name: 'Question 2 of 2' })).toContainText('What should I check afterwards?');
  const message = panel.locator('.cc-thread-message');
  const collapsed = await message.evaluate(el => ({ height: el.clientHeight, fullHeight: el.scrollHeight }));
  const collapsedHeight = collapsed.height;
  expect(collapsed.fullHeight).toBeGreaterThan(collapsedHeight);
  await panel.getByRole('button', { name: 'Show full message' }).dispatchEvent('click');
  await expect(panel.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  const expanded = await message.evaluate(el => ({ height: el.clientHeight, overflow: el.scrollHeight - el.clientHeight }));
  expect(expanded.height).toBeGreaterThan(collapsedHeight);
  expect(expanded.overflow).toBeLessThanOrEqual(1);
  await panel.getByRole('button', { name: 'Show less' }).dispatchEvent('click');
  await expect.poll(() => message.evaluate(el => el.clientHeight)).toBe(collapsedHeight);
  const previewDb = createSqliteDatabase(join(home, '.zcc', 'zcc.sqlite'));
  try {
    previewDb.prepare("UPDATE thread_events SET payload = json_set(payload, '$.item.text', ?) WHERE thread_id = ? AND type = 'item/completed' AND json_extract(payload, '$.item.type') = 'agentMessage'").run('Review complete.', thread.id);
  } finally { previewDb.close(); }
  // Direct fixture DB edits do not emit the live feed invalidation. Raise a
  // fresh canonical interaction so the companion receives the short preview.
  await hostRequest('interactive-request/interrupt', { sessionId: thread.id, providerId: 'fake', threadIds: [thread.id], reason: 'Replacing fixture question with a short preview' });
  await expect(panel.getByText('All clear', { exact: true })).toBeVisible();
  await raiseQuestion('short-preview-question');
  await expect(row).toContainText('Review complete.', { timeout: 15000 });
  await row.dispatchEvent('click');
  await panel.bringToFront();
  await expect(message).toHaveText('Review complete.', { timeout: 15000 });
  await expect(panel.getByRole('button', { name: 'Show full message' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Send' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Skip' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Open in Zana' }).last().dispatchEvent('click');
  await expect.poll(() => window.url()).toContain(thread.id);
  await expect(window.getByTestId('thread-pending-banner')).toContainText('Which route should I take?');
  await expect(window.getByTestId('thread-pending-option-recommended')).toHaveText('Recommended');
  await window.evaluate(() => window.cc.companion.enter());
  await needs.dispatchEvent('click');
  await panel.getByRole('button', { name: /Which route should I take/ }).dispatchEvent('click');
  await hostRequest('interactive-request/interrupt', { sessionId: thread.id, providerId: 'fake', threadIds: [thread.id], reason: 'Answered elsewhere in fixture' });
  await expect(needs).toHaveAttribute('aria-label', /Nothing needs attention/, { timeout: 15000 });
  await expect(panel.getByText('All clear', { exact: true })).toBeVisible();
  await expect(panel.getByText('Which route should I take?', { exact: true })).toHaveCount(0);

  // Seed a terminal provider failure in this fixture's isolated database, then
  // exercise the real HTTP feed → Electron controller → native error card.
  await rail.locator('.cc-rail-logo').dispatchEvent('click');
  const failureDb = createSqliteDatabase(join(home, '.zcc', 'zcc.sqlite'));
  try {
    failureDb.pragma('busy_timeout = 5000');
    failureDb.transaction(() => {
      const sequence = (failureDb.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS n FROM thread_events WHERE thread_id = ?').get(thread.id) as { n: number }).n;
      failureDb.prepare('INSERT INTO thread_events (id, thread_id, sequence, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        randomUUID(), thread.id, sequence, 'turn/completed', JSON.stringify({ type: 'turn/completed', threadId: thread.id, status: 'failed', error: { message: 'Provider connection closed during the review.' } }), Date.now()
      );
      failureDb.prepare('INSERT INTO thread_events (id, thread_id, sequence, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        randomUUID(), thread.id, sequence + 1, 'system/error', JSON.stringify({ type: 'system/error', threadId: thread.id,
          scope: { kind: 'turn', turnId: payload!.scope.turnId }, message: 'Thread interrupted because the host daemon disconnected' }), Date.now()
      );
      failureDb.prepare("UPDATE threads SET status = 'error', updated_at = ? WHERE id = ?").run(Date.now(), thread.id);
    })();
  } finally { failureDb.close(); }
  await window.evaluate(() => window.cc.companion.enter());
  await expect(needs).toHaveAttribute('aria-label', /Nothing needs attention/, { timeout: 15000 });
  await needs.dispatchEvent('click');
  await expect(panel.getByText('All clear', { exact: true })).toBeVisible();
  await expect(panel.getByText(/Thread failed/)).toHaveCount(0);
  const snapshot = await rail.evaluate(() => window.cc.companion.request());
  expect(snapshot.requests).toEqual([]);
  expect(snapshot.counts.blocked).toBe(0);
  expect(snapshot.agents).toContainEqual(expect.objectContaining({ threadId: thread.id, state: 'idle', failure: 'Thread failed: Thread interrupted because the host daemon disconnected' }));
  await rail.getByRole('button', { name: /^Agents:/ }).dispatchEvent('click');
  await expect(panel.getByText(/Error ·/)).toBeVisible();
  await expect(panel.getByText('Thread failed: Thread interrupted because the host daemon disconnected', { exact: true })).toBeVisible();
  await panel.getByTitle('Context review — Error').dispatchEvent('click');
  await expect.poll(() => window.url()).toContain(thread.id);
});
