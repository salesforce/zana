import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('a thread file chip asks which duplicate basename to preview', async ({ app }) => {
  const { window, home } = app;
  const projectPath = join(home, 'preview-ambiguity-project');
  mkdirSync(join(projectPath, 'docs'), { recursive: true });
  mkdirSync(join(projectPath, 'examples'), { recursive: true });
  writeFileSync(join(projectPath, 'docs', 'report.md'), '# Docs report\n\nChosen from docs.');
  writeFileSync(join(projectPath, 'examples', 'report.md'), '# Example report\n\nChosen from examples.');
  const root = realpathSync(projectPath);
  const thread = await window.evaluate(async (root) => {
    const project = await window.cc.projects.add(root);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Preview report.md' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread ?? body.value;
  }, root);

  await window.route((url) => url.pathname === `/api/v1/threads/${thread.id}/timeline`, async (route) => {
    await route.fulfill({ json: {
      rows: [{
        id: 'preview-response', threadId: thread.id, turnId: 'preview-turn', sourceSeqStart: 1, sourceSeqEnd: 1,
        startedAt: Date.now(), createdAt: Date.now(), completedAt: Date.now(),
        kind: 'conversation', role: 'assistant', attachments: null, turnRequest: null,
        text: 'Open `report.md`.'
      }], maxSeq: 1, status: 'idle', activeThinking: null
    } });
  });
  await window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, thread.id);

  await window.getByTestId('inbox-md-file-chip').click();
  const choices = window.getByRole('group', { name: 'Choose a file matching report.md' });
  await expect(choices.getByRole('button')).toHaveCount(2);
  await choices.getByRole('button', { name: 'docs/report.md', exact: true }).click();
  await expect(window.getByRole('heading', { name: 'Docs report', exact: true })).toBeVisible({ timeout: 15_000 });
});
