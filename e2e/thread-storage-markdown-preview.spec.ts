import { copyFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true, initialConfig: { sponsorPromptDismissed: true } });

test('absolute Markdown links open the owning thread report and recording in built Electron', async ({ app }) => {
  const { window, home } = app;
  mkdirSync(join(home, 'storage-preview-project'));
  const projectPath = realpathSync(join(home, 'storage-preview-project'));
  const threadId = await window.evaluate(async (projectPath) => {
    const project = await window.cc.projects.add(projectPath);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Recording and results' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, projectPath);
  const storage = join(home, '.zcc', 'thread-storage', threadId, 'recording');
  mkdirSync(storage, { recursive: true });
  const report = join(storage, 'index.html');
  const recording = join(storage, 'recording.mp4');
  writeFileSync(report, '<h1>Recording and results</h1><p>Stored outside the checkout.</p>');
  copyFileSync(fileURLToPath(new URL('./fixtures/preview-video.mp4', import.meta.url)), recording);

  await window.route((url) => url.pathname === `/api/v1/threads/${threadId}/timeline`, async (route) => {
    await route.fulfill({ json: {
      rows: [{
        id: 'storage-response', threadId, turnId: 'storage-turn', sourceSeqStart: 1, sourceSeqEnd: 1,
        startedAt: Date.now(), createdAt: Date.now(), completedAt: Date.now(),
        kind: 'conversation', role: 'assistant', attachments: null, turnRequest: null,
        text: `[Recording and results](${report}) · [Watch recording](${recording})`
      }], maxSeq: 1, status: 'idle', activeThinking: null
    } });
  });
  await window.evaluate((threadId) => {
    history.pushState({}, '', `/threads/${threadId}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);

  await window.getByRole('link', { name: 'Preview index.html', exact: true }).click();
  const panel = window.getByTestId('thread-secondary-panel');
  const frame = panel.frameLocator('[data-testid="thread-file-preview-html"]');
  await expect(frame.getByRole('heading', { name: 'Recording and results' })).toBeVisible();
  await panel.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(panel.getByTestId('thread-file-preview')).toContainText('Stored outside the checkout.');

  await window.getByRole('link', { name: 'Preview recording.mp4', exact: true }).click();
  const video = panel.getByLabel('Video preview: recording.mp4');
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => ({
    error: node.error?.message ?? null, width: node.videoWidth, duration: node.duration
  }))).toEqual({ error: null, width: 160, duration: 4 });
  await video.evaluate(async (node: HTMLVideoElement) => { node.muted = true; await node.play(); });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.1);

  const rejected = await window.evaluate(async ({ threadId, report }) => {
    const response = await fetch(`/api/v1/threads/${threadId}/preview-path/resolve`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: report.replace(threadId, `${threadId}-other`) })
    });
    return response.status;
  }, { threadId, report });
  expect(rejected).toBe(403);
});
