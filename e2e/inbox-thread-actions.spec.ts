import { appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true });

for (const explicitOrigin of [false, true]) {
  test(`inbox reopens and replies to the original archived thread (${explicitOrigin ? 'explicit' : 'legacy'} origin)`, async ({ app }) => {
    const { window, home } = app;
    const projectPath = join(home, 'inbox-thread-project');
    mkdirSync(projectPath);
    const ids = await window.evaluate(async (path) => {
      const project = await window.cc.projects.add(path);
      if (!project.ok) throw new Error('Project registration failed');
      const response = await fetch('/api/v1/threads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Original inbox conversation' })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(body));
      return { threadId: body.thread.id as string, projectId: project.value.id };
    }, realpathSync(projectPath));
    const readThread = () => window.evaluate(async (id) => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread, ids.threadId);
    await expect.poll(async () => (await readThread()).status).toBe('idle');

    const inboxDir = join(home, '.zcc', 'inbox');
    mkdirSync(inboxDir, { recursive: true });
    appendFileSync(join(inboxDir, 'entries.jsonl'), `${JSON.stringify({
      id: 'thread-report', ts: Date.now(), projectId: ids.projectId, sessionId: ids.threadId,
      ...(explicitOrigin ? { origin: { threadId: ids.threadId } } : {}),
      subject: 'Thread result ready', comments: 'Continue in the original conversation.', report: true
    })}\n`);

    const archive = () => window.evaluate(async (id) => {
      const response = await fetch(`/api/v1/threads/${id}/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error(await response.text());
    }, ids.threadId);
    const openReport = async () => {
      await window.reload();
      await window.getByTestId('nav-inbox').click();
      await window.getByRole('button', { name: /Thread result ready/ }).click();
      await expect(window.locator('.inbox-detail').getByText('Archived', { exact: true })).toBeVisible();
    };

    await archive();
    await openReport();
    await window.locator('.inbox-detail').getByRole('button', { name: 'Reopen', exact: true }).click();
    await expect(window).toHaveURL(new RegExp(`/projects/${ids.projectId}/threads/${ids.threadId}$`));
    await expect(window.getByTestId('thread-timeline')).toContainText('Original inbox conversation');
    expect((await readThread()).archivedAt).toBeNull();

    await archive();
    await openReport();
    const detail = window.locator('.inbox-detail');
    const reply = 'Follow up from the inbox';
    await detail.getByRole('textbox', { name: 'Reply to the originating agent' }).fill(reply);
    await detail.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(detail).toContainText('Replied to');
    await expect.poll(async () => (await readThread()).archivedAt).toBeNull();
    await expect.poll(async () => (await readThread()).status).toBe('idle');
    await detail.getByRole('button', { name: /^(Open|Reopen)$/ }).click();
    await expect(window).toHaveURL(new RegExp(`/projects/${ids.projectId}/threads/${ids.threadId}$`));
    await expect(window.getByTestId('thread-timeline')).toContainText(`Response to: ${reply}`);
    const threads = await window.evaluate(async (projectId) => (await (await fetch(`/api/v1/threads?projectId=${projectId}`)).json()).threads, ids.projectId);
    expect(threads.map((thread: { id: string }) => thread.id)).toEqual([ids.threadId]);
  });
}
