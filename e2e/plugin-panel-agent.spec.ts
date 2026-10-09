import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import { DEFAULT_PR_MONITOR_SETTINGS, type MonitoredPr } from '../plugins/pr-monitor/lib/types.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

async function shot(electron: ElectronApplication, win: Page, testInfo: TestInfo, name: string) {
  const dir = process.env.ZCC_E2E_SHOT_DIR;
  const path = dir ? join(dir, `${name}.png`) : testInfo.outputPath(`${name}.png`);
  await captureElectronScreenshot(electron, win, path);
}

test('a plugin page opens an agent side panel from its launcher and New Tab', async ({ app, home }, testInfo) => {
  test.setTimeout(120_000);
  const win = app.window;
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  const install = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'pr-monitor' }));
  expect(install).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((p) => p.id === 'pr-monitor')?.status
  ), { timeout: 30_000 }).toMatch(/running|needs-configuration/);

  const projectPath = join(home, 'agent-panel-project');
  mkdirSync(projectPath, { recursive: true });
  const projectId = await win.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, projectPath);
  const now = Date.now();
  const pr: MonitoredPr = {
    url: 'https://github.com/acme/app/pull/42', repo: 'acme/app', number: 42,
    title: 'Fix flaky checkout test', status: 'failed', checks: [{ name: 'Integration tests', state: 'FAILURE' }],
    mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', body: 'Retries the checkout flow.',
    headRefName: 'fix/checkout', baseRefName: 'main',
    addedAt: now, lastChecked: now, lastStatusChange: now, lastSeenAt: 0, source: 'manual',
  };
  await win.evaluate(async ({ pr, settings }) => {
    await window.cc.pluginApps.callRpc('pr-monitor', 'storageSet', { key: 'settings', value: settings });
    await window.cc.pluginApps.callRpc('pr-monitor', 'storageSet', { key: 'prs', value: { [pr.url]: pr } });
  }, { pr, settings: { ...DEFAULT_PR_MONITOR_SETTINGS, autoSyncEnabled: false, authorDiscovered: true, orgDiscovered: true } });

  const support = win.getByRole('dialog', { name: 'Support Zana' });
  if (await support.isVisible()) await support.getByRole('button', { name: 'Dismiss' }).click();
  await win.getByRole('button', { name: /^PR Monitor/ }).click();
  await expect(win.locator('.prm-board-card').filter({ hasText: pr.title })).toBeVisible();

  const launcher = win.getByTestId('plugin-panel-agent-show');
  await expect(launcher).toBeVisible();
  await expect(win.getByTestId('plugin-panel-secondary-show')).toBeVisible();
  await shot(app.electron, win, testInfo, '1-plugin-launchers');

  await launcher.click();
  await expect(win.getByTestId('panel-agent-tab-composer')).toBeVisible();
  await shot(app.electron, win, testInfo, '2-agent-composer');

  // The panel's composer binds its thread to PR Monitor, whose tools then drive the board.
  const toolArgs = Buffer.from(JSON.stringify({ action: 'reveal', pr: '#42' })).toString('base64url');
  const panelComposer = win.getByTestId('panel-agent-tab-composer');
  await expect(panelComposer.getByTestId('thread-command-send')).toBeEnabled({ timeout: 30_000 });
  await panelComposer.getByTestId('thread-command-input').fill(`call_tool:pr_monitor_panel tool_args:${toolArgs}`);
  await panelComposer.getByTestId('thread-command-send').click();
  const chat = win.getByTestId('panel-agent-tab-chat');
  await expect(chat).toBeVisible({ timeout: 30_000 });
  const detail = win.locator('.prm-detail-sidebar');
  await expect(detail).toContainText('fix/checkout', { timeout: 30_000 });
  await expect(win.getByText(pr.title, { exact: true }).last()).toBeVisible();
  await shot(app.electron, win, testInfo, '3-agent-revealed-pr');
  await win.keyboard.press('Escape');
  await expect(detail).toBeHidden();
  await expect(chat.getByText('Tool called: pr_monitor_panel').first()).toBeVisible({ timeout: 30_000 });

  const binding = await win.evaluate(async () => {
    const key = Object.keys(localStorage).find((row) => row.startsWith('zcc.secondaryPanel.plugin-panel:pr-monitor:'));
    if (!key) throw new Error('plugin panel state was not persisted');
    const state = JSON.parse(localStorage.getItem(key)!) as { tabs: Array<{ kind: string; threadId?: string }> };
    const threadId = state.tabs.find((tab) => tab.kind === 'agent' && tab.threadId)?.threadId;
    if (!threadId) throw new Error('agent tab did not record its thread');
    const metadata = await (await fetch(`/api/v1/threads/${threadId}/plugin-metadata?pluginId=pr-monitor`)).json();
    const { thread } = await (await fetch(`/api/v1/threads/${threadId}`)).json() as { thread: { visibility: string; originPluginId: string } };
    return { threadId, panel: key.slice('zcc.secondaryPanel.plugin-panel:pr-monitor:'.length), metadata, thread };
  });
  expect(binding.metadata.panelAgent).toMatchObject({ panel: binding.panel });
  // Panel conversations stay out of the Agents list until promoted.
  expect(binding.thread).toMatchObject({ visibility: 'hidden', originPluginId: 'pr-monitor' });

  // Main, not the renderer, decides which plugins may bind a thread.
  const rejected = await win.evaluate(async (projectId) => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'fake', input: 'hi', pluginPanel: { pluginId: 'not-installed', panel: 'x' } })
    });
    return response.status;
  }, projectId);
  expect(rejected).toBe(409);
  await win.waitForTimeout(1_500);
  await shot(app.electron, win, testInfo, '3b-agent-chat');

  await win.getByTestId('thread-secondary-new-tab').click();
  await expect(win.getByTestId('thread-new-tab-agent')).toBeVisible();
  await shot(app.electron, win, testInfo, '4-new-tab-agent-entry');
  await win.getByTestId('thread-new-tab-agent').click();
  await expect(win.getByTestId('panel-agent-tab-composer')).toBeVisible();
  // A fresh composer lists the plugin's earlier conversations to pick up again.
  const recent = win.getByTestId('panel-agent-recent');
  await expect(recent).toHaveCount(1, { timeout: 15_000 });
  await shot(app.electron, win, testInfo, '5-agent-recents');
  await recent.click();
  await expect(win.getByTestId('panel-agent-tab-chat')).toBeVisible();

  // Open as thread promotes it into the Agents list and goes there.
  await win.getByTestId('panel-agent-open-as-thread').click();
  await expect.poll(() => win.url()).toContain(binding.threadId);
  await expect.poll(() => win.evaluate(async (id) =>
    ((await (await fetch(`/api/v1/threads/${id}`)).json()) as { thread: { visibility: string } }).thread.visibility
  , binding.threadId)).toBe('visible');
  await shot(app.electron, win, testInfo, '6-opened-as-thread');
  await win.getByRole('button', { name: /^PR Monitor/ }).click();
  await expect(win.locator('.prm-board-card').filter({ hasText: pr.title })).toBeVisible();

  // Hiding and relaunching returns to the latest conversation tab.
  await win.getByTestId('thread-secondary-hide').click();
  await launcher.click();
  await expect(win.getByTestId('panel-agent-tab-composer')).toBeVisible();
});
