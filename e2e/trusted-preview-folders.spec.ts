import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { stubOpenDialog } from './sdk/native-dialog.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('trusted preview folders gate external file preview', async ({ app }) => {
  const { window, home } = app;
  mkdirSync(join(home, 'ws'), { recursive: true });
  mkdirSync(join(home, 'notes'), { recursive: true });
  const ws = realpathSync(join(home, 'ws'));
  const notes = realpathSync(join(home, 'notes'));
  const file = join(notes, 'handoff.md');
  writeFileSync(file, '# External handoff');

  const threadId = await window.evaluate(async (ws) => {
    const project = await window.cc.projects.add(ws);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Trusted preview' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, ws);

  const read = (path: string) => window.evaluate(async ({ threadId, path }) => {
    const response = await fetch(`/api/v1/threads/${threadId}/host-files/content?path=${encodeURIComponent(path)}`);
    return { status: response.status, body: response.ok ? await response.text() : '' };
  }, { threadId, path });

  expect((await read(file)).status).not.toBe(200);

  // Trust is granted only through the native chooser in the main process; a
  // renderer config patch must not be able to grant it.
  await window.evaluate(async (notes) => {
    await window.cc.config.set({ trustedPreviewFolders: [notes] } as never);
  }, notes);
  expect((await read(file)).status).not.toBe(200);
  const config = await window.evaluate(() => window.cc.config.get());
  expect(config.trustedPreviewFolders ?? []).toEqual([]);

  // The chooser and list are exposed under Settings > Configuration.
  await window.evaluate(() => {
    history.pushState({}, '', '/settings/global');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(window.getByRole('heading', { name: 'Trusted Preview Folders' })).toBeVisible();
  const addButton = window.getByRole('button', { name: /add folder/i });
  await expect(addButton).toBeVisible();

  // Cancelling the chooser changes nothing.
  await stubOpenDialog(app.electron, [[]]);
  await addButton.click();
  expect((await read(file)).status).not.toBe(200);

  // Picking the folder in the native chooser trusts it: the file now previews.
  await stubOpenDialog(app.electron, [[notes]]);
  await addButton.click();
  await expect(window.getByTestId('trusted-preview-folders')).toContainText(notes);
  await expect.poll(async () => (await read(file)).status).toBe(200);
  expect((await read(file)).body).toContain('External handoff');

  // Removing the folder revokes access on the next request, and never deletes the file.
  await window.getByTestId('trusted-preview-folders').getByRole('button', { name: /remove/i }).click();
  await expect.poll(async () => (await read(file)).status).not.toBe(200);
  expect(existsSync(file)).toBe(true);
});
