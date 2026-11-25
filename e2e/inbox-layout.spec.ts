import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { test as base, expect } from './fixtures/app.js';

const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const bin = join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
    await use({ PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, GH_CONFIG_DIR: join(home, 'gh') });
  }
});

test.use({ initialConfig: { sponsorPromptDismissed: true } });

test('Inbox defaults to full-width, remembers layout choices, and shares item state', async ({ app }) => {
  const { window: win, home } = app;
  const path = join(home, 'checkout');
  mkdirSync(path);
  const projectId = await win.evaluate(async (directory) => {
    const result = await window.cc.projects.add(directory);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, path);
  const inboxDir = join(home, '.zcc', 'inbox');
  mkdirSync(inboxDir, { recursive: true });
  const briefEntry = {
    id: 'brief', ts: Date.now() - 60_000, projectId, subject: 'Checkout brief',
    report: true, comments: 'Two PRs are ready to merge.'
  };
  appendFileSync(join(inboxDir, 'entries.jsonl'), JSON.stringify(briefEntry) + '\n');
  expect(await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'pr-monitor' }))).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((plugin) => plugin.id === 'pr-monitor')?.status
  ), { timeout: 30_000 }).toMatch(/running|needs-configuration/);
  await win.getByTestId('nav-inbox').click();
  const inbox = win.locator('.inbox-view');
  const layout = inbox.getByRole('group', { name: 'Inbox layout' });
  const filter = inbox.getByRole('textbox', { name: 'Search inbox' });
  const splitView = layout.getByRole('button', { name: 'Split view' });
  const fullWidthView = layout.getByRole('button', { name: 'Full-width' });
  await expect(fullWidthView).toHaveAttribute('aria-pressed', 'true');
  await splitView.click();
  await win.reload();
  await expect(splitView).toHaveAttribute('aria-pressed', 'true');
  const refresh = inbox.getByRole('button', { name: 'Refresh inbox' });
  await refresh.click();
  await expect(refresh).toBeFocused();
  await expect(inbox.locator('.inbox-row', { hasText: 'Checkout brief' })).toBeVisible();
  const unread = inbox.getByRole('button', { name: /^Unread/ });
  const [searchBox, unreadBox] = await Promise.all([filter.boundingBox(), unread.boundingBox()]);
  expect(searchBox!.y + searchBox!.height <= unreadBox!.y || searchBox!.x + searchBox!.width <= unreadBox!.x).toBe(true);

  const actions = inbox.getByRole('button', { name: 'Inbox actions' });
  const menu = win.getByRole('menu', { name: 'Inbox actions' });
  await actions.focus();
  await win.keyboard.press('Enter');
  await expect(menu.getByRole('menuitemradio', { name: 'Group by project' })).toBeFocused();
  await win.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: 'Group by time' })).toBeFocused();
  await win.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(actions).toBeFocused();
  await actions.click();
  await menu.getByRole('menuitemradio', { name: 'Group by project' }).click();

  await filter.fill('Checkout brief');
  await fullWidthView.click();
  await expect(inbox).toHaveAttribute('data-full-width', 'true');
  await expect(filter).toHaveValue('Checkout brief');
  const brief = inbox.getByRole('button', { name: /Checkout brief/ });
  await expect(brief).toBeVisible();
  await expect(inbox.getByText('Report', { exact: true })).toBeVisible();
  await expect(inbox.getByRole('button', { name: 'Fix with agent' })).toHaveCount(0);
  await brief.click();
  await expect(inbox.locator('.inbox-view-detail')).toContainText('Two PRs are ready to merge.');
  await inbox.getByRole('button', { name: 'Save this report for later' }).click();
  await expect(inbox.getByRole('button', { name: 'Saved for later' })).toBeVisible();
  await inbox.getByRole('button', { name: 'Inbox', exact: true }).click();
  await expect(brief).toBeFocused();
  await expect(brief.getByLabel('Unread')).toHaveCount(0);

  await win.evaluate((id) => window.cc.pluginApps.callRpc('pr-monitor', 'pushInbox', {
    projectId: id, comments: 'CI timed out on PR #482.', offerAgentFix: true
  }), projectId);
  await filter.clear();
  await inbox.getByRole('button', { name: 'Needs action' }).click();
  await expect(brief).toHaveCount(0);
  await inbox.getByRole('button', { name: 'Fix with agent' }).click();
  const draft = win.getByRole('dialog', { name: 'New agent' });
  await expect(draft).toBeVisible();
  const prompt = draft.locator('[contenteditable="true"]');
  await expect(prompt).toBeEditable();
  await expect(prompt).toContainText('CI timed out on PR #482.');
  await win.keyboard.press('Escape');
  await expect(draft).toHaveCount(0);
  await filter.fill('CI timed out');
  const savedTab = inbox.getByRole('tab', { name: /^Saved/ });
  const tabBefore = await savedTab.boundingBox();
  expect(tabBefore).toBeTruthy();
  await savedTab.click();
  await expect(savedTab).toHaveAttribute('aria-selected', 'true');
  expect(await savedTab.boundingBox()).toEqual(tabBefore);
  await expect(inbox.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
  await expect(layout).toHaveCount(0);
  await expect(inbox).toHaveAttribute('data-full-width', 'false');
  const savedSearch = inbox.getByRole('textbox', { name: 'Search saved reports' });
  await expect(savedSearch).toHaveValue('');
  await expect(inbox.locator('.saved-row', { hasText: 'Checkout brief' })).toBeVisible();
  await expect(inbox.locator('.inbox-view-detail')).toContainText('Two PRs are ready to merge.');
  await savedSearch.fill('Checkout');
  await inbox.getByRole('tab', { name: /^Feed/ }).click();
  await expect(inbox).toHaveAttribute('data-full-width', 'true');
  await expect(filter).toHaveValue('CI timed out');
  await savedTab.click();
  await expect(savedSearch).toHaveValue('Checkout');
  await inbox.getByRole('tab', { name: /^Feed/ }).click();

  await win.reload();
  await expect(fullWidthView).toHaveAttribute('aria-pressed', 'true');
  await splitView.click();
  await expect(inbox).toHaveAttribute('data-full-width', 'false');
  await expect(inbox.locator('.inbox-row', { hasText: 'Checkout brief' })).toBeVisible();
  await expect(inbox.locator('.inbox-row', { hasText: 'Checkout brief' })).not.toHaveClass(/\bunread\b/);
});
