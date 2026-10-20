import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true, initialConfig: { sponsorPromptDismissed: true } });

test('HTML above the source cap renders, refreshes and recovers from a source error in built Electron', async ({ app }, testInfo) => {
  const { window, home } = app;
  mkdirSync(join(home, 'html-project'));
  const projectPath = realpathSync(join(home, 'html-project'));
  const path = join(projectPath, 'large #1.html');
  // Above the 2 MB source cap; below the HTML endpoint's bounded 20 MB limit.
  // The script proves the rendered document runs with its own sandboxed CSP.
  const html = (title: string) => `<!doctype html><html><body><h1 id="title">Loading</h1><script>document.getElementById('title').textContent = '${title}'</script><!--${'x'.repeat(2_100_000)}--></body></html>`;
  writeFileSync(path, html('Large HTML rendered'));
  const threadId = await window.evaluate(async (projectPath) => {
    const project = await window.cc.projects.add(projectPath);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'HTML preview regression' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, projectPath);
  await window.evaluate((threadId) => {
    history.pushState({}, '', `/threads/${threadId}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  await expect(window.getByTestId('thread-detail')).toBeVisible();
  const preview = async () => window.evaluate(async ({ threadId, path }) => {
    const response = await fetch(`/api/v1/threads/${threadId}/open`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: { source: 'workspace', path } })
    });
    if (!response.ok) throw new Error(await response.text());
  }, { threadId, path });

  await preview();
  const panel = window.getByTestId('thread-secondary-panel');
  const frame = panel.frameLocator('[data-testid="thread-file-preview-html"]');
  await expect(frame.getByRole('heading', { name: 'Large HTML rendered' })).toBeVisible();
  await expect(panel).not.toContainText('file exceeds the read cap');
  await expect(panel.getByTestId('thread-file-preview-html')).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-modals');

  await panel.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Source is too large to display' })).toBeVisible();
  await expect(panel.getByRole('status')).toContainText('Switch to Preview');
  await panel.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Large HTML rendered' })).toBeVisible();

  writeFileSync(path, html('Updated HTML rendered'));
  await preview();
  await expect(frame.getByRole('heading', { name: 'Updated HTML rendered' })).toBeVisible();
  await window.screenshot({ path: testInfo.outputPath('large-html-preview.png') });

  // An explicit retry also recovers if the source becomes small enough to read.
  await panel.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Source is too large to display' })).toBeVisible();
  writeFileSync(path, '<h1>Smaller source</h1>');
  await panel.getByRole('button', { name: 'Try again' }).click();
  await expect(panel.getByTestId('thread-file-preview')).toContainText('<h1>Smaller source</h1>');

  await window.evaluate(async (threadId) => {
    const response = await fetch(`/api/v1/threads/${threadId}/open`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: { source: 'workspace', path: 'missing.html' } })
    });
    if (!response.ok) throw new Error(await response.text());
  }, threadId);
  await expect(frame.getByRole('heading', { name: 'Could not open this preview' })).toBeVisible();
  writeFileSync(join(projectPath, 'missing.html'), '<h1>Restored HTML</h1>');
  await frame.getByRole('button', { name: 'Try again' }).click();
  await expect(frame.getByRole('heading', { name: 'Restored HTML' })).toBeVisible();
});
