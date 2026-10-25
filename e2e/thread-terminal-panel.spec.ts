import { openThreadToolLauncher } from './fixtures/thread-tool-panel.js';
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { tmuxScope: 'off', sponsorPromptDismissed: true } });

test('side-panel terminal opens, resizes and preserves output while project scans stay asynchronous', async ({ app }) => {
  const { window: page, electron: electronApp, home } = app;
  const path = join(home, 'terminal-panel-project');
  mkdirSync(path);
  const root = realpathSync(path);
  for (let i = 0; i < 1500; i++) writeFileSync(join(root, `file-${i}.txt`), 'panel-scan-needle\n');
  symlinkSync(root, join(root, 'cycle'));
  symlinkSync(home, join(root, 'outside'));
  const { projectId, threadId } = await page.evaluate(async (root) => {
    const project = await window.cc.projects.add(root);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Terminal panel test' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return { projectId: project.value.id, threadId: (body.thread ?? body.value).id as string };
  }, root);
  await page.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  await expect(page.getByTestId('thread-detail')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Terminal panel test', exact: true })).toBeVisible();
  const show = page.getByTestId('thread-secondary-show');
  if (await show.isVisible()) await show.click();
  await openThreadToolLauncher(page);
  await page.getByTestId('thread-new-tab-terminal').click();
  const anchor = page.getByTestId('thread-terminal-tab');
  const terminal = anchor.locator('.xterm');
  await expect(terminal).toBeVisible({ timeout: 15_000 });
  const sessionId = await page.evaluate(async (id) => {
    const { sessions } = await (await fetch('/api/v1/terminals')).json();
    const shell = sessions.find((s: { profile: string; projectId: string }) => s.profile === 'shell' && s.projectId === id);
    if (!shell) throw new Error('Missing panel shell');
    return shell.id;
  }, projectId);
  await terminal.evaluate((element) => { (window as unknown as { panelXterm: Element }).panelXterm = element; });
  const backlog = () => page.evaluate(async (id) => (await (await fetch(`/api/v1/terminals/${id}/output`)).json()).text as string, sessionId);
  await page.evaluate((id) => fetch(`/api/v1/terminals/${id}/input`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: "printf 'PANEL-HISTORY-%s\\n' {1..20000}; echo PANEL_OUTPUT_READY\r" })
  }).then((response) => { if (!response.ok) throw new Error('Terminal input failed'); }), sessionId);
  await expect.poll(backlog).toContain('PANEL_OUTPUT_READY\r\n');
  await page.getByTestId('thread-secondary-maximize').click();
  await expect(terminal).toBeVisible();
  await page.getByTestId('thread-secondary-maximize').click();
  await page.getByTestId('thread-info-pin').click();
  await expect(page.getByTestId('thread-info-storage')).toBeVisible();
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(terminal).toBeVisible();
  expect(await terminal.evaluate((element) => element === (window as unknown as { panelXterm: Element }).panelXterm)).toBe(true);
  await page.getByTestId('thread-secondary-hide').click();
  await page.getByTestId('thread-secondary-show').click();
  await expect(terminal).toBeVisible();
  await terminal.locator('.xterm-helper-textarea').fill('echo PANEL_STILL_LIVE');
  await page.keyboard.press('Enter');
  await expect.poll(backlog).toContain('PANEL_STILL_LIVE\r\n');

  // Reject synchronous tree I/O at the real Electron IPC boundary. The old
  // scanner silently returned [] after readdirSync threw, failing below.
  await electronApp.evaluate((_electron, root) => {
    const fs = process.getBuiltinModule('node:fs');
    const originals = { readdirSync: fs.readdirSync, readFileSync: fs.readFileSync };
    const state = globalThis as unknown as { restorePanelScan: () => void };
    state.restorePanelScan = () => Object.assign(fs, originals);
    for (const key of ['readdirSync', 'readFileSync'] as const) {
      fs[key] = (path: unknown, ...args: unknown[]) => {
        if (String(path) === root || String(path).startsWith(`${root}/`)) throw new Error('Synchronous project scan');
        return originals[key](path, ...args);
      };
    }
  }, root);
  try {
    const files = await page.evaluate((root) => window.cc.fs.walkFiles(root), root);
    expect(files.filter((file) => /^file-\d+\.txt$/.test(file.rel))).toHaveLength(1500);
    expect(files.some((file) => /^(cycle|outside)\//.test(file.rel))).toBe(false);
    const result = await page.evaluate((root) => window.cc.fs.searchFiles(root, 'panel-scan-needle'), root);
    expect(result.hits).toHaveLength(500);
    expect(result.truncated).toBe(true);
    await openThreadToolLauncher(page);
    await page.getByRole('searchbox', { name: 'Search tools and files' }).fill('file-1499');
    await expect(page.getByRole('button', { name: 'file-1499.txt', exact: true })).toBeVisible();
  } finally {
    await electronApp.evaluate(() => (globalThis as unknown as { restorePanelScan: () => void }).restorePanelScan());
    await page.evaluate((id) => fetch(`/api/v1/terminals/${id}/close`, { method: 'POST' }).then(() => undefined), sessionId);
  }
});
