import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('Design Docs Ask agent opens the agent in the page side panel and stays on the doc', async ({ app, home }) => {
  test.setTimeout(120_000);
  const win = app.window;
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  const install = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }));
  expect(install).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((p) => p.id === 'design-docs')?.status
  ), { timeout: 30_000 }).toBe('running');

  const projectPath = join(home, 'design-docs-panel-project');
  mkdirSync(projectPath, { recursive: true });
  const docId = await win.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    const doc = await window.cc.pluginApps.callRpc('design-docs', 'create', {
      title: 'Panel agent doc',
      template: 'technical',
      projectId: result.value.id
    }) as { id: string };
    return doc.id;
  }, projectPath);

  await win.getByRole('button', { name: /^Design Docs/ }).click();
  await win.getByText('Panel agent doc').first().click();
  await expect.poll(() => win.url()).toContain(docId);

  await win.getByRole('button', { name: /Ask agent/ }).first().click();
  await win.getByRole('menuitem', { name: /^Review/ }).click();

  // The conversation opens beside the doc instead of navigating to a thread.
  const chat = win.getByTestId('panel-agent-tab-chat');
  await expect(chat).toBeVisible({ timeout: 30_000 });
  expect(win.url()).toContain(docId);

  const binding = await win.evaluate(async () => {
    const key = Object.keys(localStorage).find((row) => row.startsWith('zcc.secondaryPanel.plugin-panel:design-docs:'));
    if (!key) throw new Error('plugin panel state was not persisted');
    const state = JSON.parse(localStorage.getItem(key)!) as { tabs: Array<{ kind: string; threadId?: string; title: string }> };
    const tab = state.tabs.find((row) => row.kind === 'agent' && row.threadId);
    if (!tab?.threadId) throw new Error('agent tab did not record its thread');
    const metadata = await (await fetch(`/api/v1/threads/${tab.threadId}/plugin-metadata?pluginId=design-docs`)).json();
    const { thread } = await (await fetch(`/api/v1/threads/${tab.threadId}`)).json() as { thread: { visibility: string; originPluginId: string } };
    return { tab, metadata, thread };
  });
  expect(binding.tab.title).toBe('Panel agent doc');
  expect(binding.metadata).toMatchObject({ designDocId: docId, action: 'review', panelAgent: { panel: 'design-docs', view: docId } });
  // A panel conversation stays out of the Agents list until opened as a thread.
  expect(binding.thread).toMatchObject({ visibility: 'hidden', originPluginId: 'design-docs' });
});
