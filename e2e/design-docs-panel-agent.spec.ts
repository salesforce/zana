import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

async function setUpDoc(win: Page, home: string, folder: string): Promise<{ docId: string; projectId: string }> {
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  const install = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }));
  expect(install).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((p) => p.id === 'design-docs')?.status
  ), { timeout: 30_000 }).toBe('running');

  const projectPath = join(home, folder);
  mkdirSync(projectPath, { recursive: true });
  return win.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    const doc = await window.cc.pluginApps.callRpc('design-docs', 'create', {
      title: 'Panel agent doc',
      template: 'technical',
      projectId: result.value.id
    }) as { id: string };
    return { docId: doc.id, projectId: result.value.id };
  }, projectPath);
}

/** Ask agent → Review, check the prefilled panel composer, send; returns the started thread. */
async function askReviewAndSend(
  win: Page,
  { docId, panel, owner = panel, stayOn }: { docId: string; panel: string; owner?: string; stayOn: string }
): Promise<string> {
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


test('artifact cards stay hidden in the doc assistant and reappear when opened as a thread', async ({ app, home }) => {
  test.setTimeout(120_000);
  const win = app.window;
  const { docId } = await setUpDoc(win, home, 'design-docs-assistant-card');
  await win.evaluate(path => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, `/plugins/design-docs/design-docs/${docId}`);
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
