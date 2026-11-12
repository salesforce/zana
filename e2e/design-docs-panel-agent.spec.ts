import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

async function dismissTutorialHint(win: Page): Promise<void> {
  const hint = win.getByRole('button', { name: 'Dismiss tutorial hint', exact: true });
  await win.removeLocatorHandler(hint);
  if (await hint.isVisible()) await hint.click();
  // The discovery hint can arrive after the fixture's initial dismissal.
  await win.addLocatorHandler(hint, async button => {
    await button.click();
  }, { times: 1 });
}

async function setUpDoc(win: Page, home: string, folder: string): Promise<{ docId: string; projectId: string }> {
  await dismissTutorialHint(win);
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  const install = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }));
  expect(install).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((p) => p.id === 'design-docs')?.status
  ), { timeout: 30_000 }).toBe('running');

  const projectPath = join(home, folder);
  mkdirSync(projectPath, { recursive: true });
  const created = await win.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    const doc = await window.cc.pluginApps.callRpc('design-docs', 'create', {
      title: 'Panel agent doc',
      template: 'technical',
      projectId: result.value.id
    }) as { id: string };
    return { docId: doc.id, projectId: result.value.id };
  }, projectPath);
  await dismissTutorialHint(win);
  return created;
}

/** Ask agent → Review, check the prefilled panel composer, send; returns the started thread. */
async function askReviewAndSend(
  win: Page,
  { docId, panel, owner = panel, stayOn }: { docId: string; panel: string; owner?: string; stayOn: string }
): Promise<string> {
  await dismissTutorialHint(win);
  await win.getByRole('button', { name: /Ask agent/ }).first().click();
  await win.getByRole('menuitem', { name: /^Review/ }).click();

  // Ask agent prefills the panel's composer; the user picks the harness and sends.
  const panelComposer = win.getByTestId('panel-agent-tab-composer');
  await expect(panelComposer.getByTestId('thread-command-input')).toContainText(`id ${docId}`, { timeout: 30_000 });
  expect(win.url()).toContain(stayOn);
  await expect(panelComposer.getByTestId('thread-command-send')).toBeEnabled({ timeout: 30_000 });
  await panelComposer.getByTestId('thread-command-send').click();

  // The conversation opens beside the doc instead of navigating to a thread.
  const chat = win.getByTestId('panel-agent-tab-chat');
  await expect(chat.getByTestId('thread-command-input')).toBeVisible({ timeout: 30_000 });
  await expect(chat.getByTestId('thread-timeline')).toContainText('Response to:', { timeout: 30_000 });
  expect(win.url()).toContain(stayOn);

  const binding = await win.evaluate(async (prefix) => {
    const key = Object.keys(localStorage).find((row) => row.startsWith(prefix));
    if (!key) throw new Error('plugin panel state was not persisted');
    const state = JSON.parse(localStorage.getItem(key)!) as { tabs: Array<{ kind: string; threadId?: string; title: string }> };
    const tab = state.tabs.find((row) => row.kind === 'agent' && row.threadId);
    if (!tab?.threadId) throw new Error('agent tab did not record its thread');
    const metadata = await (await fetch(`/api/v1/threads/${tab.threadId}/plugin-metadata?pluginId=design-docs`)).json();
    const { thread } = await (await fetch(`/api/v1/threads/${tab.threadId}`)).json() as { thread: { visibility: string; originPluginId: string } };
    return { tab, metadata, thread };
  }, `zcc.secondaryPanel.plugin-panel:design-docs:${owner}`);
  expect(binding.tab.title).toBe('Panel agent doc');
  expect(binding.metadata).toMatchObject({ panelAgent: { panel, view: docId } });
  // A panel conversation stays out of the Agents list until opened as a thread.
  expect(binding.thread).toMatchObject({ visibility: 'hidden', originPluginId: 'design-docs' });
  // Design Docs links the conversation to the doc it was started beside.
  await expect.poll(() => win.evaluate(async (id) =>
    ((await window.cc.pluginApps.callRpc('design-docs', 'get', { doc: id })) as { threads: Array<{ threadId: string }> })
      .threads.map((row) => row.threadId), docId), { timeout: 30_000 }).toContain(binding.tab.threadId);
  return binding.tab.threadId!;
}

test('Design Docs Ask agent prefills the side panel composer and stays on the doc', async ({ app, home }, testInfo) => {
  test.setTimeout(120_000);
  const win = app.window;
  const { docId } = await setUpDoc(win, home, 'design-docs-panel-project');

  await win.getByRole('button', { name: /^Design Docs/ }).click();
  await win.getByText('Panel agent doc').first().click();
  await expect.poll(() => win.url()).toContain(docId);
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('design-docs-global-rail.png'));

  await askReviewAndSend(win, { docId, panel: 'design-docs', stayOn: docId });
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('design-docs-global-agent.png'));

  // Linked conversations use the same agent tab, never a second embedded chat in the doc rail.
  await win.getByTestId('thread-secondary-hide').click();
  const reviewRail = win.getByRole('complementary', { name: 'Comments, history and agents' });
  if (!await reviewRail.isVisible()) await win.getByRole('button', { name: 'Show comments & history' }).click();
  await reviewRail.getByRole('tab', { name: /Agents/ }).click();
  await reviewRail.getByTitle('Open chat beside the doc').first().click();
  await expect(win.getByTestId('panel-agent-tab-chat')).toBeVisible();
  await expect(win.getByTestId('panel-agent-open-as-thread')).toBeVisible();
  await expect(win.locator('.dd-agent-chat')).toHaveCount(0);
  await expect(win.getByTestId('thread-secondary-chrome').locator('.thread-secondary-tab')).toHaveCount(1);
  await expect(win.getByTestId('panel-agent-tab-chat').getByTestId('thread-timeline')).toContainText('Response to:', { timeout: 30_000 });
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('design-docs-linked-agent.png'));
});

test('Design Docs Ask agent opens the side panel composer from a project tab', async ({ app, home }, testInfo) => {
  test.setTimeout(120_000);
  const win = app.window;
  const { docId, projectId } = await setUpDoc(win, home, 'design-docs-panel-tab-project');

  const tabPath = `/projects/${encodeURIComponent(projectId)}/design-docs`;
  await win.evaluate((path) => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, tabPath);
  await expect.poll(() => win.url()).toContain(tabPath);
  await win.getByText('Panel agent doc').first().click();

  // Project tabs use the same rail and panel as global plugin pages, scoped to this project.
  await expect(win.getByTestId('plugin-panel-host-layout')).toBeVisible({ timeout: 30_000 });
  await expect(win.getByTestId('plugin-panel-agent-show')).toBeVisible();
  await expect(win.getByTestId('plugin-panel-secondary-show')).toBeVisible();
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('design-docs-project-rail.png'));
  // The panel is the project tab's, kept per project; the draft names the doc.
  await askReviewAndSend(win, { docId, panel: 'design', owner: `design@${projectId}`, stayOn: tabPath });
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('design-docs-project-agent.png'));
});

test('generic Design Docs panel follows the current page and snapshots queued context', async ({ app, home }) => {
  test.setTimeout(120_000);
  const win = app.window;
  const { docId, projectId } = await setUpDoc(win, home, 'design-docs-current-page');
  const firstContent = 'Canonical ALPHA-401 describes offline retries.';
  const secondContent = 'Canonical BRAVO-902 describes release rollback.';
  const laterContent = 'Canonical CHARLIE-803 was written after the message was queued.';
  const secondTitle = 'Release rollback design';
  const secondDocId = await win.evaluate(async ({ docId, projectId, firstContent, secondContent, secondTitle }) => {
    const file = await window.cc.pluginApps.callRpc('design-docs', 'readFile', { doc: docId, path: 'README.md' }) as { revision: number };
    await window.cc.pluginApps.callRpc('design-docs', 'writeFile', {
      doc: docId, path: 'README.md', content: `# Offline retries\n\n${firstContent}\n`, baseRevision: file.revision
    });
    const next = await window.cc.pluginApps.callRpc('design-docs', 'create', {
      title: secondTitle, projectId, template: 'blank'
    }) as { id: string };
    const nextFile = await window.cc.pluginApps.callRpc('design-docs', 'readFile', { doc: next.id, path: 'README.md' }) as { revision: number };
    await window.cc.pluginApps.callRpc('design-docs', 'writeFile', {
      doc: next.id, path: 'README.md', content: `# Release rollback\n\n${secondContent}\n`, baseRevision: nextFile.revision
    });
    return next.id;
  }, { docId, projectId, firstContent, secondContent, secondTitle });

  // Project tabs keep their document selection inside the plugin rather than in the URL.
  const tabPath = `/projects/${encodeURIComponent(projectId)}/design-docs`;
  await win.evaluate(path => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, tabPath);
  await win.locator('.dd-doc-row').filter({ hasText: 'Panel agent doc' }).click();
  await expect(win.locator('.dd-main')).toContainText(firstContent);
  await win.getByTestId('plugin-panel-agent-show').click();
  const composer = win.getByTestId('panel-agent-tab-composer');
  const firstPrompt = 'What does this page describe?';
  await composer.getByTestId('thread-command-input').fill(firstPrompt);
  await expect(composer.getByTestId('thread-command-input')).toHaveText(firstPrompt);
  await expect(composer.getByTestId('thread-command-send')).toBeEnabled({ timeout: 30_000 });
  const createdResponse = win.waitForResponse(response =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/threads');
  await composer.getByTestId('thread-command-send').click();
  const created = await (await createdResponse).json() as { thread: { id: string } };
  const threadId = created.thread.id;
  const binding = await win.evaluate(async id =>
    (await fetch(`/api/v1/threads/${id}/plugin-metadata?pluginId=design-docs`)).json(), threadId);
  expect(binding).toMatchObject({ panelAgent: { panel: 'design', view: docId } });
  const chat = win.getByTestId('panel-agent-tab-chat');
  const replies = chat.getByTestId('thread-assistant-text');
  // Every message carries a small page identity and retrieval reference, without document content.
  await expect(replies.nth(0)).toContainText(firstPrompt, { timeout: 30_000 });
  await expect(replies.nth(0)).toContainText(docId);
  await expect(replies.nth(0)).toContainText('Panel agent doc');
  await expect(replies.nth(0)).toContainText('README.md');
  await expect(replies.nth(0)).toContainText('page_context_read');
  await expect(replies.nth(0)).toContainText('design-doc');
  await expect(replies.nth(0)).not.toContainText(firstContent);
  await expect.poll(() => win.evaluate(async id =>
    ((await window.cc.pluginApps.callRpc('design-docs', 'get', { doc: id })) as { threads: Array<{ threadId: string }> })
      .threads.map(row => row.threadId), docId)).toContain(threadId);
  await expect.poll(() => win.evaluate(async id =>
    (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, threadId)).toBe('idle');

  // Continue the same conversation after selecting a different document.
  await win.locator('.dd-doc-row').filter({ hasText: secondTitle }).click();
  await expect(win.locator('.dd-main')).toContainText(secondContent);
  const followUp = 'delay:15000 Explain the current page.';
  await chat.getByTestId('thread-command-input').fill(followUp);
  await chat.getByTestId('thread-command-send').click();
  await expect(chat.getByTestId('thread-command-send')).toHaveAttribute('aria-label', 'Queue');
  const queuedPrompt = 'Check this page again on the next turn.';
  await chat.getByTestId('thread-command-input').fill(queuedPrompt);
  await chat.getByTestId('thread-command-send').click();
  const queue = chat.getByTestId('thread-queued-messages');
  await expect(queue.locator('.thread-queued-item-text')).toHaveText(queuedPrompt);
  await expect(queue).not.toContainText(secondDocId);
  await expect(queue).not.toContainText(secondContent);
  const queued = await win.evaluate(async id =>
    (await (await fetch(`/api/v1/threads/${id}/next-turn`)).json()).items as Array<{ text: string }>, threadId);
  expect(queued.map(item => item.text)).toEqual([queuedPrompt]);
  await queue.getByRole('button', { name: 'Edit queued message', exact: true }).click();
  const queuedEditor = queue.getByRole('textbox', { name: 'Queued message text' });
  await expect(queuedEditor).toHaveValue(queuedPrompt);
  const editedQueuedPrompt = 'Explain the saved page reference in one sentence.';
  await queuedEditor.fill(editedQueuedPrompt);

  // Navigation cannot retarget a queued reference; content is fetched only when needed.
  await win.evaluate(async ({ docId, laterContent }) => {
    const file = await window.cc.pluginApps.callRpc('design-docs', 'readFile', { doc: docId, path: 'README.md' }) as { revision: number };
    await window.cc.pluginApps.callRpc('design-docs', 'writeFile', {
      doc: docId, path: 'README.md', content: laterContent, baseRevision: file.revision
    });
  }, { docId: secondDocId, laterContent });
  await win.locator('.dd-doc-row').filter({ hasText: 'Panel agent doc' }).click();
  await expect(win.locator('.dd-main')).toContainText(firstContent);
  await expect(replies.nth(1)).toContainText(followUp, { timeout: 30_000 });
  // Saving changes the user's words while retaining the original hidden B reference.
  const savedResponse = win.waitForResponse(response =>
    response.request().method() === 'PATCH' && new URL(response.url()).pathname.includes(`/threads/${threadId}/next-turn/`));
  await queue.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await savedResponse;
  expect(saved.status()).toBe(200);
  expect((await saved.json()).item.text).toBe(editedQueuedPrompt);
  await expect(replies.nth(2)).toContainText(editedQueuedPrompt, { timeout: 30_000 });
  await expect(replies.nth(2)).not.toContainText(queuedPrompt);
  for (const reply of [replies.nth(1), replies.nth(2)]) {
    await expect(reply).toContainText(secondDocId);
    await expect(reply).toContainText(secondTitle);
    await expect(reply).toContainText('README.md');
    await expect(reply).toContainText('page_context_read');
    await expect(reply).toContainText('design-doc');
    await expect(reply).not.toContainText(secondContent);
    await expect(reply).not.toContainText(firstContent);
    await expect(reply).not.toContainText(laterContent);
  }
  expect(win.url()).toContain(tabPath);

  // A plugin's internal Settings page must replace the last document context too.
  await expect.poll(() => win.evaluate(async id =>
    (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, threadId)).toBe('idle');
  await win.getByTitle('Design Docs settings: peers and agent', { exact: true }).click();
  await expect(win.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
  const settingsPrompt = 'Explain the page I am looking at now.';
  await chat.getByTestId('thread-command-input').fill(settingsPrompt);
  await chat.getByTestId('thread-command-send').click();
  const settingsReply = replies.nth(3);
  await expect(settingsReply).toContainText(settingsPrompt, { timeout: 30_000 });
  await expect(settingsReply).toContainText('Design Docs settings');
  await expect(settingsReply).not.toContainText(docId);
  await expect(settingsReply).not.toContainText(secondDocId);
  await expect(settingsReply).not.toContainText(firstContent);
  await expect(settingsReply).not.toContainText(secondContent);
  await expect(settingsReply).not.toContainText(laterContent);

  // The agent can read a saved reference on demand, receiving the current canonical content.
  await expect.poll(() => win.evaluate(async id =>
    (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, threadId)).toBe('idle');
  const readArgs = Buffer.from(JSON.stringify({
    pluginId: 'design-docs', providerId: 'design-doc', itemId: secondDocId
  })).toString('base64url');
  await chat.getByTestId('thread-command-input').fill(`report_tool_result call_tool:page_context_read tool_args:${readArgs}`);
  await chat.getByTestId('thread-command-send').click();
  const readReply = replies.nth(4);
  await expect(readReply).toContainText('Tool called: page_context_read', { timeout: 30_000 });
  await expect(readReply).toContainText(laterContent);
  await expect(readReply).not.toContainText(firstContent);
  await expect(readReply).not.toContainText(secondContent);
});

test('selected passages stay compact, inspectable and removable in a roomy Ask agent composer', async ({ app, home }, testInfo) => {
  test.setTimeout(120_000);
  const win = app.window;
  const { docId } = await setUpDoc(win, home, 'design-docs-selection');
  await win.evaluate(async (doc) => {
    const file = await window.cc.pluginApps.callRpc('design-docs', 'readFile', { doc, path: 'README.md' }) as { revision: number };
    await window.cc.pluginApps.callRpc('design-docs', 'writeFile', { doc, path: 'README.md', content: '# Authentication\n\nTokens expire after one hour.\n', baseRevision: file.revision });
  }, docId);
  await win.getByRole('button', { name: /^Design Docs/ }).click();
  await win.getByText('Panel agent doc').first().click();
  const passage = win.getByText('Tokens expire after one hour.', { exact: true });
  await expect(passage).toBeVisible();
  await passage.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await passage.dispatchEvent('mouseup');
  await win.locator('.dd-selection-chip').getByRole('button', { name: 'Ask agent' }).click();
  const menu = win.locator('.dd-ask');
  await expect(menu.getByText('README.md (selection)')).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(480);
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  await menu.locator('summary').click();
  await expect(menu.locator('pre')).toHaveText('Tokens expire after one hour.');
  await menu.getByRole('textbox').fill('Explain this expiry policy.');
  await menu.getByRole('button', { name: 'Start', exact: true }).click();
  const composer = win.getByTestId('panel-agent-tab-composer');
  const chip = composer.getByRole('button', { name: 'Inspect README.md (selection)' });
  await expect(chip).toBeVisible();
  expect((await win.getByTestId('thread-secondary-chrome').boundingBox())!.width).toBeGreaterThanOrEqual(550);
  await expect(composer.getByTestId('thread-command-input')).not.toContainText('Tokens expire after one hour.');
  await chip.click();
  await expect(win.getByRole('dialog', { name: 'Copied selection: README.md (selection)' })).toContainText('Tokens expire after one hour.');
  await win.getByRole('button', { name: 'Close selection preview' }).click();
  await composer.getByRole('button', { name: 'Remove README.md (selection)' }).click();
  await expect(chip).toHaveCount(0);
  await composer.getByTestId('thread-command-input').press('ControlOrMeta+z');
  await expect(chip).toBeVisible();
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('design-docs-selection-composer.png'));
  await composer.getByTestId('thread-command-send').click();
  const chat = win.getByTestId('panel-agent-tab-chat');
  await expect(chat.getByTestId('thread-timeline')).toContainText('Tokens expire after one hour.', { timeout: 30_000 });
  await expect(chat.getByTestId('thread-timeline')).toContainText('Explain this expiry policy.');
});


test('artifact cards stay hidden in the doc assistant and reappear when opened as a thread', async ({ app, home }) => {
  test.setTimeout(120_000);
  const win = app.window;
  const { docId } = await setUpDoc(win, home, 'design-docs-assistant-card');
  await win.getByRole('button', { name: /^Design Docs/ }).click();
  await win.getByText('Panel agent doc').first().click();
  await expect(win.getByRole('button', { name: /Ask agent/ }).first()).toBeVisible();
  await win.getByTestId('plugin-panel-agent-show').click();
  const composer = win.getByTestId('panel-agent-tab-composer');
  await expect(composer.getByTestId('thread-command-send')).toBeEnabled({ timeout: 30_000 });
  // The deterministic provider echoes this text, including the real plugin directive.
  await composer.getByTestId('thread-command-input').fill(`Compilation passed.\n\n::design-doc{id="${docId}"}\n\nLocal change only.`);
  await composer.getByTestId('thread-command-send').click();
  const chat = win.getByTestId('panel-agent-tab-chat');
  await expect(chat.getByTestId('thread-timeline')).toContainText('Response to:', { timeout: 30_000 });
  await expect(chat.getByTestId('thread-timeline')).toContainText('Local change only.');
  await expect(chat.locator('.dd-card')).toHaveCount(0);
  await chat.getByTestId('panel-agent-open-as-thread').click();
  await expect(win.getByTestId('panel-agent-tab-chat')).toHaveCount(0);
  await expect(win.locator('.dd-card').first()).toBeVisible({ timeout: 30_000 });
  await expect(win.getByRole('button', { name: 'Open in Design Docs' }).first()).toBeVisible();
});
