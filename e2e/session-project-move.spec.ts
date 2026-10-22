import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('moves sessions with the picker and drag/drop, undoes moves, and resumes in the destination', async ({ app }) => {
  test.setTimeout(120_000);
  const { window, home } = app;
  const sourcePath = join(home, 'move-source');const destinationPath = join(home, 'move-destination');
  mkdirSync(sourcePath, { recursive: true });mkdirSync(destinationPath, { recursive: true });
  const setup = await window.evaluate(async ({ sourcePath, destinationPath }) => {
    const source = await window.cc.projects.add(sourcePath);
    const destination = await window.cc.projects.add(destinationPath);
    if (!source.ok || !destination.ok) throw new Error('Could not register projects');
    const form = new FormData();
    form.append('file', new Blob(['Attachment survives moving projects'], { type: 'text/plain' }), 'move-notes.txt');
    const upload = await fetch(`/api/v1/projects/${source.value.id}/attachments`, { method: 'POST', body: form });
    if (!upload.ok) throw new Error(await upload.text());
    const attachment = await upload.json();
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: source.value.id, providerId: 'fake', title: 'Move this conversation', input: [{ type: 'text', text: 'Keep this original message' }, { type: 'localFile', path: attachment.path, name: attachment.name }] }) });
    if (!response.ok) throw new Error(await response.text());
    const body = await response.json();
    return { sourceId: source.value.id, destinationId: destination.value.id, threadId: (body.thread ?? body.value).id as string, attachmentPath: attachment.path as string };
  }, { sourcePath, destinationPath });
  const read = () => window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread, setup.threadId);
  await expect.poll(async () => (await read()).status).toBe('idle');
  await window.evaluate(id => { history.pushState({}, '', `/threads/${id}`);dispatchEvent(new PopStateEvent('popstate')); }, setup.threadId);
  await expect(window.getByTestId('thread-timeline')).toContainText('Keep this original message');

  await window.getByTestId('thread-overflow-trigger').click();
  await window.getByRole('menuitem', { name: 'Move to project…' }).click();
  const picker = window.getByRole('dialog', { name: 'Move to project', exact: true });
  await expect(picker.getByRole('button', { name: /move-source.*Current project/ })).toBeDisabled();
  await picker.getByRole('textbox', { name: 'Search destination projects' }).fill('move-destination');
  await picker.getByRole('button', { name: /move-destination/ }).click();
  await expect.poll(async () => (await read()).projectId).toBe(setup.destinationId);
  expect((await read()).cwd).toBe(realpathSync(destinationPath));
  expect(await window.evaluate(async ({ projectId, path }) => {
    const response = await fetch(`/api/v1/projects/${projectId}/attachments/content?path=${encodeURIComponent(path)}`);
    if (!response.ok) throw new Error(await response.text());
    return response.text();
  }, { projectId: setup.destinationId, path: setup.attachmentPath })).toBe('Attachment survives moving projects');
  await expect(window.getByTestId('thread-timeline')).toContainText('Keep this original message');
  await expect(window).toHaveURL(new RegExp(`/threads/${setup.threadId}$`));

  await window.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await read()).projectId).toBe(setup.sourceId);
  const row = window.locator('.sidebar--global').getByTestId('project-thread-row').filter({ hasText: 'Move this conversation' });
  await expect(row).toBeVisible();
  const target = window.locator(`[data-session-move-project="${setup.destinationId}"]`);
  const from = await row.boundingBox();const to = await target.boundingBox();
  if (!from || !to) throw new Error('Sidebar drag targets are not visible');
  await window.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await window.mouse.down();
  await window.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 });
  await expect(target).toHaveClass(/session-move-drop-allowed/);
  await window.mouse.up();
  await expect.poll(async () => (await read()).projectId).toBe(setup.destinationId);
  await expect(target).not.toHaveClass(/session-move-drop-allowed/);

  // The retained conversation must accept another turn through the new environment.
  const input = window.getByTestId('thread-command-input');
  await input.fill('Continue after moving projects');
  await window.getByTestId('thread-command-send').click();
  await expect(window.getByTestId('thread-timeline')).toContainText('Response to: Continue after moving projects', { timeout: 30_000 });
  await expect.poll(async () => (await read()).status).toBe('idle');
  expect((await read()).cwd).toBe(realpathSync(destinationPath));
  await window.reload();
  await expect(window.getByTestId('thread-timeline')).toContainText('Keep this original message');
  expect((await read()).projectId).toBe(setup.destinationId);
});

test('requires an explicit stop before moving a running session', async ({ app }) => {
  test.setTimeout(120_000);
  const { window, home } = app;
  const destinationPath = join(home, 'running-destination');mkdirSync(destinationPath, { recursive: true });
  const setup = await window.evaluate(async path => {
    const source = (await window.cc.projects.list())[0]!;
    const destination = await window.cc.projects.add(path);
    if (!destination.ok) throw new Error('Could not register destination');
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: source.id, providerId: 'fake', title: 'Running move', input: 'delay:60000 Keep working' }) });
    if (!response.ok) throw new Error(await response.text());
    const body = await response.json();
    return { threadId: (body.thread ?? body.value).id as string, sourceId: source.id, destinationId: destination.value.id };
  }, destinationPath);
  const read = () => window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread, setup.threadId);
  await expect.poll(async () => (await read()).status).toBe('active');
  await window.evaluate(id => { history.pushState({}, '', `/threads/${id}`);dispatchEvent(new PopStateEvent('popstate')); }, setup.threadId);
  await window.getByTestId('thread-overflow-trigger').click();
  await window.getByRole('menuitem', { name: 'Move to project…' }).click();
  await window.getByRole('dialog', { name: 'Move to project', exact: true }).getByRole('button', { name: /running-destination/ }).click();
  const confirm = window.getByRole('dialog', { name: 'Stop and move this session?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  expect((await read()).projectId).toBe(setup.sourceId);expect((await read()).status).toBe('active');
  await window.getByTestId('thread-overflow-trigger').click();await window.getByRole('menuitem', { name: 'Move to project…' }).click();
  await window.getByRole('dialog', { name: 'Move to project', exact: true }).getByRole('button', { name: /running-destination/ }).click();
  await confirm.getByRole('button', { name: 'Stop & move' }).click();
  await expect.poll(async () => (await read()).projectId).toBe(setup.destinationId);
  expect((await read()).status).toBe('idle');expect((await read()).cwd).toBe(realpathSync(destinationPath));
});
