import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

async function dismissTutorialHint(win: Page): Promise<void> {
  const hint = win.getByRole('button', { name: 'Dismiss tutorial hint', exact: true });
  await win.removeLocatorHandler(hint);
  if (await hint.isVisible()) await hint.click();
  await win.addLocatorHandler(hint, async button => {
    await button.click();
  }, { times: 1 });
}

interface Setup {
  projectId: string;
  docs: Array<{ id: string; title: string }>;
  threadId: string;
}

/** Installs Design Docs, registers a project, creates docs through the plugin RPC and one fake-provider thread. */
async function setUp(win: Page, home: string, titles: string[]): Promise<Setup> {
  await dismissTutorialHint(win);
  await win.setViewportSize({ width: 1600, height: 900 }).catch(() => undefined);
  const install = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }));
  expect(install).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((p) => p.id === 'design-docs')?.status
  ), { timeout: 30_000 }).toBe('running');

  const projectPath = join(home, 'pinned-tabs-project');
  mkdirSync(projectPath, { recursive: true });
  const created = await win.evaluate(async ({ path, titles }) => {
    const added = await window.cc.projects.add(path);
    if (!added.ok) throw new Error(added.message);
    const docs: Array<{ id: string; title: string }> = [];
    for (const title of titles) {
      const doc = await window.cc.pluginApps.callRpc('design-docs', 'create', {
        title, template: 'technical', projectId: added.value.id
      }) as { id: string };
      docs.push({ id: doc.id, title });
    }
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: added.value.id, providerId: 'fake', title: 'Seeded thread', input: 'delay:60000 keep running' })
    });
    if (!response.ok) throw new Error(await response.text());
    return { projectId: added.value.id, docs, threadId: (await response.json()).thread.id as string };
  }, { path: projectPath, titles });
  await dismissTutorialHint(win);
  // No project is selected on purpose: a doc pins into its own project.
  return created;
}

const bar = (win: Page) => win.getByTestId('application-tabs');
const pluginTab = (win: Page, title: string) =>
  bar(win).locator('[data-tab-kind="plugin"]').filter({ hasText: title });
const kinds = (win: Page) =>
  bar(win).locator('[data-tab-kind]').evaluateAll(els => els.map(el => el.getAttribute('data-tab-kind')));

async function openDoc(win: Page, title: string): Promise<void> {
  await win.getByRole('button', { name: /^Design Docs/ }).click();
  await win.locator('.dd-doc-row').filter({ hasText: title }).first().click();
  await expect(win.locator('.dd-doc-title').first()).toContainText(title);
}

/** Pins the open doc with real clicks: the host requires transient user activation. */
async function pinOpenDoc(win: Page): Promise<void> {
  await win.getByRole('button', { name: 'More actions', exact: true }).click();
  await win.getByRole('menuitem', { name: /^Add to tab bar/ }).click();
}

async function openThread(win: Page, threadId: string): Promise<void> {
  await win.evaluate(to => {
    history.pushState({}, '', to);
    dispatchEvent(new PopStateEvent('popstate'));
  }, `/threads/${threadId}`);
  await expect(bar(win).locator('[data-tab-kind="thread"]')).toHaveCount(1);
}

/** Hovers `target` (after leaving it) until `done` holds; resolvePin is throttled per tab, so poll rather than sleep. */
async function hoverUntil(win: Page, away: Locator, target: Locator, done: () => Promise<boolean>): Promise<void> {
  await expect.poll(async () => {
    await away.hover();
    await target.hover();
    return done();
  }, { timeout: 60_000, intervals: [500, 1000, 2000] }).toBe(true);
}

async function pinTwoDocsAndThread(win: Page, setup: Setup): Promise<void> {
  const [a, b] = setup.docs;
  await openDoc(win, a!.title);
  await pinOpenDoc(win);
  await expect(pluginTab(win, a!.title)).toHaveCount(1);
  await openThread(win, setup.threadId);
  await openDoc(win, b!.title);
  await pinOpenDoc(win);
  await expect(pluginTab(win, b!.title)).toHaveCount(1);
}

test('pinned doc tabs interleave with thread tabs in open order and support strip keyboard navigation', async ({ app, home }) => {
  test.setTimeout(150_000);
  const win = app.window;
  const setup = await setUp(win, home, ['Pinned alpha', 'Pinned beta']);
  await pinTwoDocsAndThread(win, setup);

  // Open order: doc A, thread, doc B.
  await expect.poll(() => kinds(win)).toEqual(['plugin', 'thread', 'plugin']);
  // The header reflects the pinned state.
  await openDoc(win, 'Pinned beta');
  await expect(win.getByRole('button', { name: 'Remove from tab bar', exact: true })).toBeVisible();

  const tabs = bar(win).getByRole('tab');
  await expect(tabs).toHaveCount(3);
  await tabs.nth(0).click();
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await tabs.nth(0).press('ArrowRight');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(win).toHaveURL(new RegExp(`/threads/${setup.threadId}$`));
  await tabs.nth(1).press('ArrowRight');
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await tabs.nth(2).press('Home');
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await tabs.nth(0).press('End');
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(win.locator('.dd-doc-title').first()).toContainText('Pinned beta');
});

test('plugin tabs and their order survive a window reload', async ({ app, home }) => {
  test.setTimeout(150_000);
  const win = app.window;
  const setup = await setUp(win, home, ['Pinned alpha', 'Pinned beta']);
  await pinTwoDocsAndThread(win, setup);
  await expect.poll(() => kinds(win)).toEqual(['plugin', 'thread', 'plugin']);

  await win.reload();
  await expect.poll(() => kinds(win), { timeout: 30_000 }).toEqual(['plugin', 'thread', 'plugin']);
  // Before the bundle loads a tab is never dimmed; once loaded, existing docs stay available.
  await expect(pluginTab(win, 'Pinned alpha')).toHaveCount(1);
  await expect(pluginTab(win, 'Pinned beta')).toHaveCount(1);
  await expect(bar(win).locator('.is-dimmed')).toHaveCount(0);
  // The page route exists only once the plugin bundle has registered its nav page.
  await expect(win.getByRole('button', { name: /^Design Docs/ })).toBeVisible({ timeout: 30_000 });
  await pluginTab(win, 'Pinned alpha').getByRole('tab').click();
  await expect(win.locator('.dd-doc-title').first()).toContainText('Pinned alpha', { timeout: 30_000 });
});

test('each pinned doc tab shows only its own agent in the side panel', async ({ app, home }) => {
  test.setTimeout(180_000);
  const win = app.window;
  const setup = await setUp(win, home, ['Pinned alpha', 'Pinned beta']);
  const [a, b] = setup.docs;

  for (const doc of [a!, b!]) {
    await openDoc(win, doc.title);
    await pinOpenDoc(win);
    await expect(pluginTab(win, doc.title)).toHaveCount(1);
    await dismissTutorialHint(win);
    await win.getByRole('button', { name: /Ask agent/ }).first().click();
    await win.getByRole('menuitem', { name: /^Review/ }).click();
    const composer = win.getByTestId('panel-agent-tab-composer');
    await expect(composer.getByTestId('thread-command-input')).toContainText(`id ${doc.id}`, { timeout: 30_000 });
    await expect(composer.getByTestId('thread-command-send')).toBeEnabled({ timeout: 30_000 });
    await composer.getByTestId('thread-command-send').click();
    await expect(win.getByTestId('panel-agent-tab-chat').getByTestId('thread-timeline'))
      .toContainText('Response to:', { timeout: 30_000 });
  }

  for (const [own, other] of [[a!, b!], [b!, a!]] as const) {
    await pluginTab(win, own.title).getByRole('tab').click();
    await expect(win.locator('.dd-doc-title').first()).toContainText(own.title);
    const timeline = win.getByTestId('panel-agent-tab-chat').getByTestId('thread-timeline');
    await expect(timeline).toContainText(own.id, { timeout: 30_000 });
    await expect(timeline).not.toContainText(other.id);
  }
});

test('a doc deleted elsewhere dims its tab and one click removes it', async ({ app, home }) => {
  test.setTimeout(150_000);
  const win = app.window;
  const setup = await setUp(win, home, ['Pinned alpha', 'Pinned beta']);
  await pinTwoDocsAndThread(win, setup);
  const [a] = setup.docs;
  // Move off the doc so its page is not mounted and cannot report the deletion itself.
  await bar(win).locator('[data-tab-kind="thread"]').getByRole('tab').click();
  await expect(win).toHaveURL(new RegExp(`/threads/${setup.threadId}$`));

  await win.evaluate(doc => window.cc.pluginApps.callRpc('design-docs', 'remove', { doc }), a!.id);
  const alpha = pluginTab(win, 'Pinned alpha');
  await hoverUntil(win, bar(win).locator('[data-tab-kind="thread"]'), alpha,
    async () => (await alpha.getAttribute('class'))?.includes('is-dimmed') ?? false);
  await expect(alpha.locator('.titlebar-thread-context')).toContainText('Unavailable');
  const remove = alpha.getByRole('button', { name: /^Close tab:/ });
  await expect(remove).toHaveAttribute('title', 'Remove unavailable tab');
  await remove.click();
  await expect(pluginTab(win, 'Pinned alpha')).toHaveCount(0);
  await expect(pluginTab(win, 'Pinned beta')).toHaveCount(1);
  await expect.poll(() => kinds(win)).toEqual(['thread', 'plugin']);
});

test('closing a doc tab unpins it but leaves the doc and clears the header pin state', async ({ app, home }) => {
  test.setTimeout(120_000);
  const win = app.window;
  const setup = await setUp(win, home, ['Pinned alpha']);
  const [a] = setup.docs;
  await openDoc(win, 'Pinned alpha');
  await pinOpenDoc(win);
  await expect(pluginTab(win, 'Pinned alpha')).toHaveCount(1);
  await expect(win.getByRole('button', { name: 'Remove from tab bar', exact: true })).toBeVisible();

  await pluginTab(win, 'Pinned alpha').getByRole('button', { name: /^Close tab:/ }).click();
  await expect(pluginTab(win, 'Pinned alpha')).toHaveCount(0);
  const still = await win.evaluate(doc => window.cc.pluginApps.callRpc('design-docs', 'get', { doc }), a!.id) as { title: string };
  expect(still.title).toBe('Pinned alpha');

  await openDoc(win, 'Pinned alpha');
  await expect(win.getByRole('button', { name: 'Remove from tab bar', exact: true })).toHaveCount(0);
  await win.getByRole('button', { name: 'More actions', exact: true }).click();
  await expect(win.getByRole('menuitem', { name: /^Add to tab bar/ })).toBeVisible();
});

test('the per-plugin cap refuses the 11th pinned tab with a toast', async ({ app, home }) => {
  test.setTimeout(240_000);
  const win = app.window;
  const titles = Array.from({ length: 11 }, (_, i) => `Cap doc ${String(i + 1).padStart(2, '0')}`);
  await setUp(win, home, titles);

  for (const title of titles.slice(0, 10)) {
    await openDoc(win, title);
    await pinOpenDoc(win);
    await expect(pluginTab(win, title)).toHaveCount(1);
  }
  await expect(bar(win).locator('[data-tab-kind="plugin"]')).toHaveCount(10);

  await openDoc(win, titles[10]!);
  await pinOpenDoc(win);
  await expect(win.locator('.toaster .toast.error')).toBeVisible();
  await expect(bar(win).locator('[data-tab-kind="plugin"]')).toHaveCount(10);
  await expect(pluginTab(win, titles[10]!)).toHaveCount(0);
});

test('a background pinned tab refreshes its title on hover without opening the doc', async ({ app, home }) => {
  test.setTimeout(150_000);
  const win = app.window;
  const setup = await setUp(win, home, ['Pinned alpha', 'Pinned beta']);
  await pinTwoDocsAndThread(win, setup);
  const [, b] = setup.docs;
  await bar(win).locator('[data-tab-kind="thread"]').getByRole('tab').click();
  await expect(win).toHaveURL(new RegExp(`/threads/${setup.threadId}$`));

  await win.evaluate(async doc => {
    const current = await window.cc.pluginApps.callRpc('design-docs', 'get', { doc }) as { head: string };
    await window.cc.pluginApps.callRpc('design-docs', 'update', { doc, title: 'Renamed beta', expectedHead: current.head });
  }, b!.id);

  const tab = bar(win).locator(`[data-tab-id][data-tab-kind="plugin"]`).filter({ hasText: /Pinned beta|Renamed beta/ });
  await hoverUntil(win, bar(win).locator('[data-tab-kind="thread"]'), tab,
    async () => (await tab.locator('.titlebar-thread-name').textContent()) === 'Renamed beta');
  // Still on the thread: the page was never mounted.
  await expect(win).toHaveURL(new RegExp(`/threads/${setup.threadId}$`));
  await expect(tab.getByRole('tab')).toHaveAttribute('aria-label', /^Renamed beta/);
});
