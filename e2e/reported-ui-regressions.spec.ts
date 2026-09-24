import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type AppHandle } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

async function createThread(app: AppHandle, title: string) {
  const path = join(app.home, 'preview-project');
  mkdirSync(path, { recursive: true });
  const project = await app.window.evaluate((path) => window.cc.projects.add(path), path);
  if (!project.ok) throw new Error('Project registration failed');
  const created = await app.window.evaluate(async ({ projectId, title }) => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'fake', title, input: 'Initial turn' })
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, { projectId: project.value.id, title });
  return { threadId: created.value.id as string, projectId: project.value.id };
}

test('agent inspector stays centered when resizing from either side or a corner', async ({ app }) => {
  const { window } = app;
  const nativeWindow = await app.electron.browserWindow(window);
  await nativeWindow.evaluate((win) => win.webContents.setZoomFactor(1));
  await window.setViewportSize({ width: 1600, height: 1000 });
  await createThread(app, 'Centered resize regression');
  await window.getByTestId('nav-agents').click();
  await window.locator('.agent-card[data-kind="thread"]').filter({ hasText: 'Centered resize regression' }).click();
  const modal = window.getByTestId('thread-modal');
  await expect(modal).toBeVisible();
  const frame = () => modal.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      width: Math.round(rect.width), height: Math.round(rect.height),
      centerX: Math.round(rect.left + rect.width / 2),
      centerY: Math.round(rect.top + rect.height / 2)
    };
  });
  const initial = { width: 1080, height: 940, centerX: 800, centerY: 500 };
  await expect.poll(frame).toEqual(initial);
  const keyboardHandle = modal.getByTestId('inspector-resize-se');
  for (const edge of ['e', 'w', 's', 'se', 'sw']) {
    for (const distance of [40, -40]) {
      await keyboardHandle.press('Enter');
      await expect.poll(frame).toEqual(initial);
      const handle = modal.getByTestId(`inspector-resize-${edge}`);
      const box = await handle.boundingBox();
      if (!box) throw new Error(`Missing resize handle: ${edge}`);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await window.mouse.move(x, y);
      await window.mouse.down();
      await window.mouse.move(
        x + (edge.includes('w') ? -distance : edge.includes('e') ? distance : 0),
        y + (edge.includes('s') ? distance : 0),
        { steps: 5 }
      );
      await window.mouse.up();
      await expect.poll(frame).toEqual({
        ...initial,
        width: initial.width + (edge === 's' ? 0 : distance * 2),
        height: edge.includes('s') ? Math.min(968, initial.height + distance * 2) : initial.height
      });
      await expect(modal).not.toHaveClass(/is-resizing/);
    }
  }
  await keyboardHandle.press('Home');
  await expect.poll(frame).toEqual({ width: 640, height: 400, centerX: 800, centerY: 500 });
  await keyboardHandle.press('ArrowRight');
  await expect.poll(frame).toEqual({ width: 664, height: 400, centerX: 800, centerY: 500 });
  await keyboardHandle.press('End');
  await expect.poll(frame).toEqual({ width: 1568, height: 968, centerX: 800, centerY: 500 });
  await window.setViewportSize({ width: 900, height: 700 });
  await expect.poll(frame).toEqual({ width: 868, height: 668, centerX: 450, centerY: 350 });
  await keyboardHandle.press('Enter');
  await expect.poll(frame).toEqual({ width: 846, height: 658, centerX: 450, centerY: 350 });
});

test('agent inspector exits fullscreen and keeps its window controls clickable (#181)', async ({ app }) => {
  const { window } = app;
  // The fixture deliberately hides windows and prevents focus. This native OS
  // test needs a visible, focusable window; CDP can otherwise click a hidden
  // renderer while macOS ignores its fullscreen request.
  await app.electron.evaluate(({ app: electronApp }) => {
    if (process.platform === 'darwin') electronApp.setActivationPolicy('regular');
  });
  const nativeWindow = await app.electron.browserWindow(window);
  await nativeWindow.evaluate((win) => {
    win.removeAllListeners('show');
    win.setFocusable(true);
    win.show();
    win.focus();
  });
  await createThread(app, 'Fullscreen regression');
  await window.getByTestId('nav-agents').click();
  await window.locator('.agent-card[data-kind="thread"]').filter({ hasText: 'Fullscreen regression' }).click();
  const modal = window.getByTestId('thread-modal');
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId('inspector-resize-se')).toBeVisible();
  const nativeFullScreen = () => window.evaluate(() => window.cc.app.isFullScreen());
  // isFullScreen() and the optimistic renderer class can change before macOS
  // finishes its animation. Wait for the native event before toggling again.
  const clickAfterTransition = async (name: string, event: 'enter-full-screen' | 'leave-full-screen') => {
    await Promise.all([
      nativeWindow.evaluate((win, event) => new Promise<void>((resolve) => {
        win.once(event, () => resolve());
      }), event),
      modal.getByRole('button', { name, exact: true }).click()
    ]);
  };
  await expect.poll(nativeFullScreen).toBe(false);
  await clickAfterTransition('Full screen', 'enter-full-screen');
  await expect.poll(nativeFullScreen).toBe(true);
  await expect(modal).toHaveClass(/is-fullscreen/);
  await expect(modal.getByTestId('inspector-resize-se')).toHaveCount(0);
  // CDP clicks alone bypass native drag hit-testing. Check the actual exclusion
  // as well, so controls cannot sit in the shell's underlying draggable titlebar.
  expect(await modal.evaluate((node) => getComputedStyle(node).getPropertyValue('-webkit-app-region'))).toBe('no-drag');
  await clickAfterTransition('Exit full screen', 'leave-full-screen');
  await expect.poll(nativeFullScreen).toBe(false);
  await expect(modal).not.toHaveClass(/is-fullscreen/);
  await clickAfterTransition('Full screen', 'enter-full-screen');
  await expect.poll(nativeFullScreen).toBe(true);
  await modal.getByTestId('thread-modal-close').click();
  await expect(modal).toHaveCount(0);
  await expect.poll(nativeFullScreen).toBe(false);
});

test('pasted image previews load from the project attachment store while a turn runs (#182)', async ({ app }) => {
  const { window } = app;
  const { threadId, projectId } = await createThread(app, 'Attachment regression');
  await window.evaluate((threadId) => {
    history.pushState({}, '', `/threads/${threadId}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  const detail = window.getByTestId('thread-detail');
  const composer = detail.locator('.thread-command-composer');
  const input = composer.getByTestId('thread-command-input');
  await expect(input).toBeVisible();
  await expect(detail.getByTestId('thread-timeline')).toContainText('Response to: Initial turn');
  await input.evaluate((node) => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), (char) => char.charCodeAt(0));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(composer.getByLabel('Attached images')).toBeVisible();
  await input.fill('delay:15000 Inspect the pasted image');
  const uploadResponse = window.waitForResponse((response) =>
    response.url().includes(`/projects/${projectId}/attachments`) && response.request().method() === 'POST'
  );
  await composer.getByTestId('thread-command-send').click();
  const uploaded = await (await uploadResponse).json();
  expect(uploaded.type).toBe('localImage');
  await expect(detail.locator('.thread-status-badge.is-working')).toBeVisible();
  // Seed the same tab a Read row's Preview button opens, then exercise the real
  // renderer-to-server file read without asking the fake model to inspect it.
  const path = join(app.home, '.zcc', 'attachments', projectId, uploaded.path);
  await window.evaluate(({ threadId, path }) => {
    localStorage.setItem(`zcc.secondaryPanel.${threadId}`, JSON.stringify({
      version: 1, isOpen: true, isMaximized: false, widthPx: 450, activeId: 'attachment',
      tabs: [{ id: 'attachment', kind: 'file-preview', title: 'pasted.png', path }]
    }));
    dispatchEvent(new CustomEvent('zcc:secondary-panel-changed', { detail: { threadId } }));
  }, { threadId, path });
  const image = detail.locator('.thread-file-preview-image');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(1);
  await expect(detail.locator('.thread-status-badge.is-working')).toBeVisible();
  await expect(detail).not.toContainText('path is not inside the thread environment');
});

test('expanded model catalogs scroll without clipping rows (#183)', async ({ app }, testInfo) => {
  const { window } = app;
  await window.route('**/api/v1/system/execution-options*', async (route) => {
    await route.fulfill({ json: {
      providers: [{ id: 'acp-cursor', displayName: 'Cursor', available: true, composerActions: [], capabilities: { permissionModes: ['full'] } }],
      models: Array.from({ length: 125 }, (_, index) => ({
        id: `model-${index}`, model: `model-${index}`, displayName: `Model ${index}`,
        supportedReasoningEfforts: [], defaultReasoningEffort: null, isDefault: index === 0
      })), selectedOnlyModels: [], permissionCeiling: 'full', modelLoadError: null
    } });
  });
  await window.getByRole('link', { name: 'Settings' }).click();
  await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
  const row = window.getByTestId('thread-provider-catalog').locator('.opener-row').filter({ hasText: 'Cursor' });
  await row.getByRole('button', { name: 'Models for Cursor' }).click();
  await row.getByRole('button', { name: /Load|Reload/, exact: true }).click();
  await expect(row).toContainText('125 models');
  const list = row.locator('.thread-provider-models');
  await expect(list.locator('li')).toHaveCount(13);
  for (const width of [1280, 900]) {
    await window.setViewportSize({ width, height: 900 });
    const dimensions = await list.evaluate((node) => ({
      height: node.clientHeight, scrollHeight: node.scrollHeight,
      rows: [...node.children].map((child) => ({
        height: child.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(getComputedStyle(child).lineHeight)
      }))
    }));
    expect(dimensions.height).toBeLessThanOrEqual(168);
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.height);
    for (const row of dimensions.rows) expect(row.height).toBeGreaterThanOrEqual(row.lineHeight - 0.1);
    await list.locator('li').last().scrollIntoViewIfNeeded();
    await expect(list.locator('li').last()).toBeInViewport();
  }
  await window.screenshot({ path: testInfo.outputPath('model-list.png') });
});
