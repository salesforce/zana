import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true });

test('side-panel Markdown resolves workspace and storage images in built Electron', async ({ app }, testInfo) => {
  const { window, home } = app;
  mkdirSync(join(home, 'image-project', 'docs', 'assets'), { recursive: true });
  const root = realpathSync(join(home, 'image-project'));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="100"><rect width="320" height="100" fill="teal"/><text x="10" y="50" fill="white">Architecture preview</text></svg>';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  writeFileSync(join(root, 'docs', 'assets', 'architecture.svg'), svg);
  writeFileSync(join(root, 'docs', 'assets', 'image #1.png'), png);
  writeFileSync(join(home, 'outside.svg'), svg);
  symlinkSync(join(home, 'outside.svg'), join(root, 'docs', 'assets', 'escape.svg'));
  writeFileSync(join(root, 'README.md'), '# How the app fits together\n\n[![Architecture](docs/assets/architecture.svg)](docs/assets/architecture.svg)');
  writeFileSync(join(root, 'docs', 'guide.md'), '# Nested guide\n\n![Nested diagram](./assets/architecture.svg)\n\n![Encoded PNG](assets/image%20%231.png)\n\n![Missing](assets/missing.svg)\n\n![Blocked](assets/escape.svg)');
  const threadId = await window.evaluate(async (projectPath) => {
    const project = await window.cc.projects.add(projectPath);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Image preview test' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, root);
  // Absolute paths exercise the real desktop readDataUrl IPC, just like Explorer previews.
  await window.evaluate(({ threadId, path }) => {
    localStorage.setItem(`zcc.secondaryPanel.${threadId}`, JSON.stringify({
      version: 1, isOpen: true, isMaximized: false, widthPx: 480, activeId: 'readme',
      tabs: [{ id: 'readme', kind: 'file-preview', path, title: 'README.md' }]
    }));
    history.pushState({}, '', `/threads/${threadId}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, { threadId, path: join(root, 'README.md') });
  const preview = window.getByTestId('thread-file-preview');
  const architecture = preview.getByRole('img', { name: 'Architecture', exact: true });
  await expect.poll(() => architecture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);
  expect(await architecture.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  await window.screenshot({ path: testInfo.outputPath('markdown-image-preview.png') });

  const open = async (path: string, source: 'workspace' | 'thread-storage') => {
    await window.evaluate(async ({ threadId, path, source }) => {
      const response = await fetch(`/api/v1/threads/${threadId}/open`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: { path, source } })
      });
      if (!response.ok) throw new Error(await response.text());
    }, { threadId, path, source });
  };
  // Relative paths exercise the product HTTP -> host read in the thread environment.
  await open('docs/guide.md', 'workspace');
  await expect.poll(() => preview.getByRole('img', { name: 'Nested diagram' }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);
  await expect.poll(() => preview.getByRole('img', { name: 'Encoded PNG' }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await expect(preview.getByText('Missing', { exact: true })).toBeVisible();
  await expect(preview.getByText('Blocked', { exact: true })).toBeVisible();
  await expect(preview.getByRole('img')).toHaveCount(2);

  const storage = join(home, '.zcc', 'thread-storage', threadId, 'reports');
  mkdirSync(join(storage, 'assets'), { recursive: true });
  writeFileSync(join(storage, 'assets', 'stored.png'), png);
  writeFileSync(join(storage, 'report.md'), '# Stored report\n\n![Stored image](assets/stored.png)');
  await open('reports/report.md', 'thread-storage');
  await expect.poll(() => preview.getByRole('img', { name: 'Stored image' }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
});
