import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true, initialConfig: { sponsorPromptDismissed: true } });

test('file previews reveal confined local files through main in built Electron', async ({ app }, testInfo) => {
  const { window, electron, home } = app;
  mkdirSync(join(home, 'reveal-project', 'dist'), { recursive: true });
  const root = realpathSync(join(home, 'reveal-project'));
  const installer = join(root, 'dist', 'Installer #1.dmg');
  const large = join(root, 'large.log');
  const document = join(root, 'notes.md');
  const outside = join(home, 'outside.dmg');
  writeFileSync(installer, Buffer.alloc(2_100_000));
  writeFileSync(large, 'x'.repeat(2_100_000));
  writeFileSync(document, '# Readable document');
  writeFileSync(outside, 'outside');
  if (process.platform !== 'win32') symlinkSync(outside, join(root, 'escape.dmg'));

  // Intercept only the final OS call; scope resolution, stat and IPC run unchanged.
  await electron.evaluate(({ shell }) => {
    const state = globalThis as unknown as { revealed: string[]; failReveal: boolean };
    state.revealed = []; state.failReveal = false;
    shell.showItemInFolder = path => {
      if (state.failReveal) throw new Error('Native reveal unavailable');
      state.revealed.push(path);
    };
  });
  const ids = await window.evaluate(async root => {
    const project = await window.cc.projects.add(root);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'File reveal regression' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return { projectId: project.value.id, threadId: (body.thread ?? body.value).id as string };
  }, root);
  await window.evaluate(threadId => {
    history.pushState({}, '', `/threads/${threadId}`); dispatchEvent(new PopStateEvent('popstate'));
  }, ids.threadId);
  await expect(window.getByTestId('thread-detail')).toBeVisible();
  const open = async (path: string) => window.evaluate(async ({ threadId, path }) => {
    const response = await fetch(`/api/v1/threads/${threadId}/open`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: { source: 'workspace', path } })
    });
    if (!response.ok) throw new Error(await response.text());
  }, { ...ids, path });
  const panel = window.getByTestId('thread-secondary-panel');
  const label = process.platform === 'darwin' ? 'Show in Finder' : process.platform === 'win32' ? 'Show in Explorer' : 'Show in file manager';
  const calls = () => electron.evaluate(() => (globalThis as unknown as { revealed: string[] }).revealed);

  await open('dist/Installer #1.dmg');
  await expect(panel.getByText('macOS disk image', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: label, exact: true })).toHaveCount(2);
  await expect(panel).not.toContainText('file exceeds the read cap');
  await panel.getByRole('button', { name: label, exact: true }).last().click();
  await expect.poll(calls).toEqual([installer]);
  await window.screenshot({ path: testInfo.outputPath('installer-reveal.png') });

  await open('notes.md');
  await expect(panel.getByRole('heading', { name: 'Readable document' })).toBeVisible();
  await expect(panel.getByRole('button', { name: label, exact: true })).toHaveCount(1);
  await panel.getByRole('button', { name: label, exact: true }).click();
  await expect.poll(calls).toEqual([installer, document]);

  await open('large.log');
  await expect(panel.getByRole('heading', { name: 'This file is too large to preview.' })).toBeVisible();
  await panel.getByRole('button', { name: label, exact: true }).last().click();
  await expect.poll(calls).toEqual([installer, document, large]);

  // A native failure appears in the preview and leaves the action retryable.
  await electron.evaluate(() => { (globalThis as unknown as { failReveal: boolean }).failReveal = true; });
  await panel.getByRole('button', { name: label, exact: true }).first().click();
  await expect(panel.getByRole('alert')).toContainText('Could not show this file');
  await electron.evaluate(() => { (globalThis as unknown as { failReveal: boolean }).failReveal = false; });
  await panel.getByRole('button', { name: label, exact: true }).first().click();
  await expect(panel.getByRole('alert')).toHaveCount(0);

  const count = (await calls()).length;
  for (const path of [outside, '../outside.dmg', ...(process.platform === 'win32' ? [] : ['escape.dmg'])]) {
    const result = await window.evaluate(input => window.cc.openers.revealFile(input), {
      path, ...ids, source: 'workspace' as const
    });
    expect(result.ok).toBe(false);
  }
  rmSync(installer);
  const missing = await window.evaluate(input => window.cc.openers.revealFile(input), {
    path: installer, ...ids, source: 'workspace' as const
  });
  expect(missing.ok).toBe(false);
  expect(await calls()).toHaveLength(count);
});
