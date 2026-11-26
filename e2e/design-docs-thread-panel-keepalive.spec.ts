/**
 * Keep-alive deck for plugin tabs in a thread's side panel: a chat card focuses
 * the doc's existing tab instead of opening a second one, and only a bounded
 * number of hidden plugin tabs stay mounted.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

async function installDesignDocs(win: Page): Promise<void> {
  const hint = win.getByRole('button', { name: 'Dismiss tutorial hint', exact: true });
  await win.removeLocatorHandler(hint);
  if (await hint.isVisible()) await hint.click();
  await win.addLocatorHandler(hint, async button => { await button.click(); }, { times: 1 });
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await expect(win.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 20_000 });
  const install = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }));
  expect(install).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((p) => p.id === 'design-docs')?.status
  ), { timeout: 30_000 }).toBe('running');
}

async function createDoc(win: Page, title: string, projectId?: string): Promise<string> {
  return win.evaluate(async ({ title, projectId }) => {
    const doc = await window.cc.pluginApps.callRpc('design-docs', 'create', {
      title, template: 'technical', ...(projectId ? { projectId } : {})
    }) as { id: string };
    return doc.id;
  }, { title, projectId });
}

async function goTo(win: Page, path: string): Promise<void> {
  await win.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

const slots = (win: Page) => win.getByTestId('plugin-tab-slot');
const visibleSlot = (win: Page) => win.locator('[data-testid="plugin-tab-slot"]:not([hidden])');

test('a chat card focuses the existing Design Docs tab and keeps its place', async ({ app, home }) => {
  test.setTimeout(120_000);
  const win = app.window;
  await installDesignDocs(win);
  const projectPath = join(home, 'keepalive-card');
  mkdirSync(projectPath, { recursive: true });
  const projectId = await win.evaluate(async (path) => {
    const added = await window.cc.projects.add(path);
    if (!added.ok) throw new Error(added.message);
    return added.value.id;
  }, projectPath);
  const docId = await createDoc(win, 'Card doc', projectId);

  // The deterministic provider echoes the prompt, including the plugin directive.
  const threadId = await win.evaluate(async ({ projectId, docId }) => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'fake', input: `Here it is.\n\n::design-doc{id="${docId}"}\n\nDone.` })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, { projectId, docId });
  await goTo(win, `/threads/${threadId}`);
  await expect(win.getByTestId('thread-detail')).toBeVisible({ timeout: 15_000 });

  const card = win.locator('.dd-card .plugin-directive-card-main').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  const panel = win.getByTestId('thread-secondary-panel');
  await expect(panel.getByTitle('Files in this doc')).toBeVisible({ timeout: 30_000 });
  const docTab = win.locator('.thread-secondary-tab-label', { hasText: 'Card doc' });
  await expect(docTab).toHaveCount(1);

  // Visit Info (the doc tab stays mounted but hidden), then use the card again.
  await panel.getByTestId('thread-info-pin').click();
  await expect(panel.getByTitle('Files in this doc')).toBeHidden();
  await expect(slots(win)).toHaveCount(1);
  await card.click();
  await expect(panel.getByTitle('Files in this doc')).toBeVisible({ timeout: 15_000 });
  await expect(docTab).toHaveCount(1);
  await expect(slots(win)).toHaveCount(1);
});

test('only a bounded number of hidden Design Docs tabs stay mounted', async ({ app }) => {
  test.setTimeout(120_000);
  const win = app.window;
  await installDesignDocs(win);
  const owner = 'e2e-docs-keepalive-cap';
  const titles = ['Cap doc 1', 'Cap doc 2', 'Cap doc 3', 'Cap doc 4', 'Cap doc 5', 'Cap doc 6'];
  const ids: string[] = [];
  for (const title of titles) ids.push(await createDoc(win, title));

  await win.evaluate(({ owner, titles, ids }) => {
    localStorage.setItem(`zcc.secondaryPanel.${owner}`, JSON.stringify({
      version: 1, isOpen: true, isMaximized: false, widthPx: 640, activeId: 'plugin:doc-0',
      tabs: titles.map((title, index) => ({
        id: `plugin:doc-${index}`, kind: 'plugin', title, moduleId: 'design-docs', actionId: 'design-doc',
        params: { docId: ids[index] }
      }))
    }));
  }, { owner, titles, ids });
  await goTo(win, `/threads/${owner}`);
  await expect(win.getByTestId('thread-detail')).toBeVisible({ timeout: 15_000 });
  const panel = win.getByTestId('thread-secondary-panel');
  const tab = (title: string) => win.locator('.thread-secondary-tab-label', { hasText: title });

  await expect(visibleSlot(win)).toContainText('Cap doc 1', { timeout: 30_000 });
  for (const title of titles.slice(1)) {
    await tab(title).click();
    await expect(visibleSlot(win)).toContainText(title, { timeout: 30_000 });
  }
  // Six plugin tabs were visited; the active one plus four hidden ones stay mounted.
  await expect(slots(win)).toHaveCount(5);

  // The evicted first tab comes back from its params, and the deck stays bounded.
  await tab('Cap doc 1').click();
  await expect(visibleSlot(win)).toContainText('Cap doc 1', { timeout: 30_000 });
  await expect(visibleSlot(win).getByTitle('Files in this doc')).toBeVisible();
  await expect(slots(win)).toHaveCount(5);

  // Closing a tab unmounts its slot.
  await win.getByRole('button', { name: 'Close Cap doc 1' }).click();
  await expect(tab('Cap doc 1')).toHaveCount(0);
  await expect(slots(win)).toHaveCount(4);
});
