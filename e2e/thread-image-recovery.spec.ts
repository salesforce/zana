import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1', ZCC_GH_BINARY: '/nonexistent/zcc-test-gh' }, isolateBundledCatalog: true });

test('thread images, gallery and cached tabs recover in built Electron', async ({ app }, testInfo) => {
  test.setTimeout(180_000);
  const { window, home } = app;
  mkdirSync(join(home, 'image-thread'));
  mkdirSync(join(home, 'other-image-project'));
  const root = realpathSync(join(home, 'image-thread'));
  const other = realpathSync(join(home, 'other-image-project'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  writeFileSync(join(root, 'art.png'), png);
  writeFileSync(join(other, 'art.png'), png);
  writeFileSync(join(root, 'README.md'), '# Image thread');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Preview E2E');
  git('config', 'user.email', 'preview@example.test');
  git('add', '.');
  git('commit', '-m', 'Initial images');
  const thread = await window.evaluate(async ({ root, other }) => {
    const project = await window.cc.projects.add(root);
    await window.cc.projects.add(other);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Image regression' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread ?? body.value;
  }, { root, other });

  await window.route('https://images.example.test/**', (route) => route.fulfill({ contentType: 'image/png', body: png }));
  await window.route((url) => url.pathname === `/api/v1/threads/${thread.id}/timeline`, async (route) => {
    const rows = [{
      id: 'image-response', threadId: thread.id, turnId: 'image-turn', sourceSeqStart: 1, sourceSeqEnd: 1,
      startedAt: Date.now(), createdAt: Date.now(), completedAt: Date.now(),
      kind: 'conversation', role: 'assistant', attachments: null, turnRequest: null,
      text: `[Project artwork](${other}/art.png)\n\n![Other project](${other}/art.png)\n\n![Workspace art](art.png)\n\n![Missing art](missing.png)\n\n![Desert Frontier](https://images.example.test/frontier.webp)\n\n![Restored Outpost](https://images.example.test/outpost.webp)`
    }];
    await route.fulfill({ json: { rows, maxSeq: 1, status: 'idle', activeThinking: null } });
  });
  const tabErrors: number[] = [];
  const violations: string[] = [];
  window.on('response', (response) => {
    if (response.url().endsWith(`/threads/${thread.id}/tabs`) && !response.ok()) tabErrors.push(response.status());
  });
  window.on('console', (message) => {
    if (/violates.*Content Security Policy/iu.test(message.text())) violations.push(message.text());
  });
  await window.evaluate(async (id) => {
    // The original bug reset expectedRevision to zero whenever localStorage existed.
    const response = await fetch(`/api/v1/threads/${id}/tabs`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, tabs: [] })
    });
    if (!response.ok) throw new Error(await response.text());
    localStorage.setItem(`zcc.secondaryPanel.${id}`, JSON.stringify({ version: 1, isOpen: true, isMaximized: false, widthPx: 480,
      activeId: 'local', tabs: [{ id: 'local', kind: 'new-tab', title: 'New Tab' }] }));
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, thread.id);
  const message = window.getByTestId('thread-assistant-text');
  for (const name of ['Other project', 'Workspace art', 'Desert Frontier', 'Restored Outpost']) {
    await expect.poll(() => message.getByRole('img', { name, exact: true }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  }
  await expect(message.getByText('Missing art — Image unavailable', { exact: true })).toBeVisible();
  await expect(message.locator('[node]')).toHaveCount(0);
  await message.getByRole('button', { name: 'View Desert Frontier', exact: true }).click();
  const dialog = window.getByRole('dialog', { name: 'Desert Frontier', exact: true });
  await expect.poll(() => dialog.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await dialog.getByRole('button', { name: 'Next image' }).click();
  const next = window.getByRole('dialog', { name: 'Restored Outpost', exact: true });
  await expect.poll(() => next.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await window.screenshot({ path: testInfo.outputPath('working-image-gallery.png') });
  await window.keyboard.press('Escape');

  await expect.poll(() => window.evaluate(async (id) => (await (await fetch(`/api/v1/threads/${id}/tabs`)).json()).tabs, thread.id))
    .toEqual([{ id: 'local', kind: 'new-tab' }]);
  await window.reload();
  await expect(message.getByRole('img', { name: 'Workspace art', exact: true })).toBeVisible();
  expect(tabErrors).toEqual([]);
  expect(violations).toEqual([]);

  // Exercise optional metadata through product HTTP and the real host CLI failure.
  const pr = await window.evaluate(async (id) => {
    const response = await fetch(`/api/v1/environments/${id}/pull-request`);
    return { status: response.status, body: await response.json() };
  }, thread.environmentId);
  expect(pr).toMatchObject({ status: 200, body: { pullRequest: null, unavailableReason: 'gh is not installed on this host' } });
});
