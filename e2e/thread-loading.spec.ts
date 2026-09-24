import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true });

test('thread loading is illustrated, motion-aware, and settles on success, failure, and retry', async ({ app }, testInfo) => {
  const { window, home } = app;
  const projectPath = join(home, 'loading-project');
  mkdirSync(projectPath);
  const threadId = await window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Hello from the loading test' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread.id as string;
  }, realpathSync(projectPath));
  await expect.poll(() => window.evaluate(async (id) => {
    return (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status;
  }, threadId)).toBe('idle');

  let release = () => {};
  let gate = new Promise<void>((resolve) => { release = resolve; });
  let phase: 'loaded' | 'error' | 'empty' = 'loaded';
  await window.route((url) => url.pathname === `/api/v1/threads/${threadId}/timeline`, async (route) => {
    if (phase === 'error') {
      await route.fulfill({ status: 503, json: { error: 'Conversation temporarily unavailable' } });
      return;
    }
    const response = await route.fetch();
    const body = await response.json();
    await gate;
    await route.fulfill({ response, json: phase === 'empty' ? { ...body, rows: [], maxSeq: 0 } : body });
  });
  await window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);

  const detail = window.getByTestId('thread-detail');
  const timeline = detail.getByTestId('thread-timeline');
  const loading = timeline.getByTestId('thread-loading');
  try {
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute('role', 'status');
    await expect(timeline).toHaveAttribute('aria-busy', 'true');
    await expect(timeline).not.toContainText('Waiting for the first turn');
    await expect(timeline.locator('.thread-working-indicator')).toHaveCount(0);
    await expect(loading.locator('.pane-empty-loading-lines span').first()).toHaveCSS('animation-name', 'pane-empty-loading-line');

    const paneBox = await timeline.boundingBox();
    const artBox = await loading.locator('.pane-empty-art').boundingBox();
    expect(paneBox).not.toBeNull();
    expect(artBox).not.toBeNull();
    expect(Math.abs(artBox!.x + artBox!.width / 2 - (paneBox!.x + paneBox!.width / 2))).toBeLessThan(4);
    expect(artBox!.y).toBeGreaterThan(paneBox!.y + paneBox!.height * 0.15);

    for (const theme of ['light', 'dark']) {
      await window.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
      await detail.screenshot({ path: testInfo.outputPath(`thread-loading-${theme}.png`) });
    }
    await window.emulateMedia({ reducedMotion: 'reduce' });
    await expect(loading).toHaveCSS('animation-name', 'none');
    await expect(loading.locator('.pane-empty-loading-lines span').first()).toHaveCSS('animation-name', 'none');
    expect(await loading.locator('.pane-empty-well').evaluate((node) =>
      getComputedStyle(node, '::before').animationName
    )).toBe('none');
  } finally {
    release();
  }
  await expect(loading).toHaveCount(0);
  await expect(timeline).toHaveAttribute('aria-busy', 'false');
  await expect(timeline).toContainText('Response to: Hello from the loading test');

  phase = 'error';
  await window.reload();
  const error = detail.getByTestId('thread-timeline-load-error');
  await expect(error).toBeVisible();
  await expect(loading).toHaveCount(0);
  await expect(timeline).not.toContainText('Waiting for the first turn');

  phase = 'empty';
  gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await error.getByRole('button', { name: 'Retry' }).click();
    await expect(loading).toBeVisible();
    await expect(error).toHaveCount(0);
  } finally {
    release();
  }
  await expect(loading).toHaveCount(0);
  await expect(timeline).toContainText('Waiting for the first turn…');
  await expect(timeline).toHaveAttribute('aria-busy', 'false');
});
