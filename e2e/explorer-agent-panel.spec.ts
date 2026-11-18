import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, dismissConsentOverlays } from './fixtures/app.js';

test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { sponsorPromptDismissed: true, theme: 'light' } });
test.setTimeout(120_000);

test('Explorer keeps a project agent beside its files and accepts file and folder drags', async ({ app, home }, testInfo) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const root = join(home, 'Explorer Agent');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# Explorer Agent\n\nBrowse files beside your conversation.\n');
  writeFileSync(join(root, 'src', 'app.ts'), 'export const app = true;\n');
  const projectId = await page.evaluate(async root => {
    const result = await window.cc.projects.add(root);
    if (!result.ok) throw Error(result.message);
    return result.value.id;
  }, root);
  const route = (path: string) => page.evaluate(path => {
    history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await route(`/projects/${projectId}/explorer`);
  const host = page.getByTestId('explorer-panel-layout');
  const file = host.locator('.tree-row.file').filter({ hasText: 'README.md' });
  await file.click();
  await expect(host.locator('.explorer-viewer')).toContainText('Browse files beside your conversation.');
  await expect(host.getByRole('button', { name: 'Ask an agent', exact: true })).toBeVisible();
  await host.getByRole('button', { name: 'Show right panel', exact: true }).click();
  await expect(host.getByTestId('panel-agent-tab-composer')).toBeVisible();
  await host.getByTestId('thread-secondary-hide').click();
  await host.getByRole('button', { name: 'Ask an agent', exact: true }).click();
  const composer = host.getByTestId('panel-agent-tab-composer');
  const input = composer.getByTestId('thread-command-input');
  await expect(input).toBeEditable();
  await input.fill('Review these files: ');
  await file.dragTo(input);
  await expect(input.locator('.prompt-mention-pill')).toContainText('README.md');
  await host.locator('.tree-row.dir').filter({ hasText: 'src' }).dragTo(input);
  await expect(input.locator('.prompt-mention-pill')).toHaveCount(2);
  await expect(input).toContainText('Review these files:');
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/explorer$`));
  await page.screenshot({ path: testInfo.outputPath('explorer-agent-draft.png') });

  const panel = host.getByTestId('thread-secondary-panel');
  const previousWidth = (await panel.boundingBox())!.width;
  const handle = (await panel.getByRole('separator', { name: 'Resize right panel' }).boundingBox())!;
  await page.mouse.move(handle.x + 3, handle.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle.x - 70, handle.y + 100, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(previousWidth + 40);
  await host.getByTestId('thread-secondary-maximize').click();
  await expect(host.locator('.explorer-view')).toBeHidden();
  await host.getByTestId('thread-secondary-maximize').click();
  await expect(file).toBeVisible();
  await host.getByTestId('thread-secondary-hide').click();
  await host.getByRole('button', { name: 'Ask an agent', exact: true }).click();
  await expect(input).toContainText('Review these files:');
  await expect(input.locator('.prompt-mention-pill')).toHaveCount(2);

  await route(`/projects/${projectId}/terminals`);
  await route(`/projects/${projectId}/explorer`);
  await expect(input.locator('.prompt-mention-pill')).toHaveCount(2);
  await expect(input).toContainText('Review these files:');
  await expect(composer.getByTestId('thread-command-send')).toBeEnabled({ timeout: 30_000 });
  await composer.getByTestId('thread-command-send').click();
  const chat = host.getByTestId('panel-agent-tab-chat');
  await expect(chat).toBeVisible({ timeout: 30_000 });
  await expect(chat.getByTestId('thread-user-text').first()).toContainText('Review these files:', { timeout: 30_000 });
  await expect(host.locator('.explorer-viewer')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/explorer$`));
  const thread = await page.evaluate(async projectId => {
    const state = JSON.parse(localStorage.getItem(`zcc.secondaryPanel.project-explorer:${projectId}`)!);
    const tab = state.tabs.find((tab: { kind: string; threadId?: string }) => tab.kind === 'agent' && tab.threadId);
    if (!tab) throw Error('Missing Explorer conversation');
    return (await (await fetch(`/api/v1/threads/${tab.threadId}`)).json()).thread;
  }, projectId);
  expect(thread).toMatchObject({ projectId });
  expect(thread.originPluginId).toBeFalsy();
  await page.screenshot({ path: testInfo.outputPath('explorer-agent-chat.png') });
});
