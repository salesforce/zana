import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test, expect, dismissConsentOverlays } from './fixtures/app.js';
import { openThreadToolLauncher } from './fixtures/thread-tool-panel.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { tmuxScope: 'off', sponsorPromptDismissed: true }, isolateBundledCatalog: true });
test.setTimeout(180_000);

test('thread tabs and tool docks preserve live terminals, browser documents, drafts and layouts', async ({ app }, testInfo) => {
  const { window: page, home, electron } = app;
  await dismissConsentOverlays(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html><title>Docking preview</title><body style="background:#e0f2fe;padding:24px"><h1>Live docking preview</h1><script>window.dockMarker = Math.random()</script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing preview port');
  const url = `http://127.0.0.1:${address.port}/`;
  const root = join(home, 'docking-project'); mkdirSync(root);
  const route = async (path: string) => page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
  const { projectId, ids } = await page.evaluate(async root => {
    const project = await window.cc.projects.add(root); if (!project.ok) throw new Error(project.message);
    const ids: string[] = [];
    for (const title of ['Thread docking', 'Another task']) {
      const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', title, input: 'Hello' }) });
      if (!response.ok) throw new Error(await response.text()); ids.push((await response.json()).thread.id);
    }
    return { projectId: project.value.id, ids };
  }, root);
  const nativeWindow = await electron.browserWindow(page);
  const browserState = () => nativeWindow.evaluate(async (win, url) => {
    const view = win.contentView.children.find(child => 'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === url) as Electron.WebContentsView | undefined;
    return view ? { visible: view.getVisible(), marker: await view.webContents.executeJavaScript('window.dockMarker'), bounds: view.getBounds() } : null;
  }, url);
  const expectBrowserBehindMenu = async (dock: ReturnType<typeof page.getByTestId>) => {
    await expect.poll(async () => (await browserState())?.visible).toBe(false);
    const snapshot = dock.locator('.thread-browser-snapshot');
    await expect(snapshot).toBeVisible();
    // Prove the placeholder contains the rendered blue page, rather than an empty capture.
    await expect.poll(() => snapshot.evaluate((element: HTMLImageElement) => {
      if (!element.complete || !element.naturalWidth) return null;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.drawImage(element, element.naturalWidth / 2, element.naturalHeight - 10, 1, 1, 0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return Math.abs(r - 224) < 4 && Math.abs(g - 242) < 4 && Math.abs(b - 254) < 4;
    })).toBe(true);
    expect((await browserState())?.marker).toBe(marker);
  };
  let marker: number;
  try {
    await route(`/threads/${ids[0]}`);
    const right = page.getByTestId('thread-secondary-panel');
    const bottom = page.getByTestId('thread-bottom-panel');
    const draft = page.getByTestId('thread-command-input');
    await expect(page.getByTestId('titlebar-thread-tabs')).toBeVisible();
    await draft.fill('Keep my docking notes');
    const show = page.getByTestId('thread-secondary-show'); if (await show.isVisible()) await show.click();
    await expect(page.getByTestId('thread-bottom-drop-target')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show bottom panel', exact: true })).toBeVisible();
    await expect(right.getByTestId('thread-info-pin')).toHaveText('Info');
    await expect(right.locator('.thread-secondary-context')).toHaveCount(0);
    await expect(right.getByRole('toolbar', { name: 'Panel tabs' }).getByTestId('thread-info-pin')).toBeVisible();
    // Fixed thread views participate in docking without inventing a closable tool.
    await right.getByTestId('thread-info-pin').press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: 'Close Info', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Move Info to bottom panel' }).click();
    await expect(bottom.getByTestId('thread-info-pin')).toHaveAttribute('aria-pressed', 'true');
    await expect(bottom.locator('.thread-secondary-tab-close')).toHaveCount(0);
    await expect(right.getByTestId('thread-info-pin')).toHaveCount(0);
    await bottom.getByRole('button', { name: 'Hide bottom panel', exact: true }).click();
    await page.getByRole('button', { name: 'Show bottom panel', exact: true }).click();
    await expect(bottom.getByTestId('thread-info-pin')).toHaveAttribute('aria-pressed', 'true');
    await expect(bottom.locator('.thread-secondary-tab')).toHaveCount(1);
    await bottom.getByTestId('thread-info-pin').locator('..').dragTo(right.getByTestId('thread-secondary-chrome'));
    await expect(bottom).toHaveCount(0);
    await expect(right.getByTestId('thread-info-pin')).toHaveAttribute('aria-pressed', 'true');
    await right.getByTestId('thread-secondary-new-tab').click();
    await page.getByRole('menuitem', { name: 'Browser', exact: true }).click();
    await right.getByTestId('thread-browser-address').fill(url);
    await right.getByTestId('thread-browser-address').press('Enter');
    await expect.poll(async () => (await browserState())?.visible).toBe(true);
    marker = (await browserState())!.marker;
    const expectUnifiedTabs = async () => {
      const geometry = await right.locator('.thread-secondary-tabs').evaluate(element => {
        const tabs = Array.from(element.querySelectorAll<HTMLElement>('.thread-secondary-tab'));
        const chrome = element.closest('.thread-secondary-chrome')!.getBoundingClientRect();
        const controls = element.parentElement!.querySelector('.thread-secondary-controls')!.getBoundingClientRect();
        return { tops: tabs.map(tab => Math.round(tab.getBoundingClientRect().top)),
          heights: tabs.map(tab => Math.round(tab.getBoundingClientRect().height)),
          controlsInside: controls.right <= chrome.right + 1,
          active: element.querySelectorAll('.thread-secondary-tab.is-active').length };
      });
      expect(new Set(geometry.tops).size).toBe(1); expect(new Set(geometry.heights).size).toBe(1);
      expect(geometry.controlsInside).toBe(true); expect(geometry.active).toBe(1);
    };
    await expectUnifiedTabs();
    await right.getByTestId('thread-info-pin').click();
    await expect.poll(async () => (await browserState())?.visible).toBe(false);
    await expectUnifiedTabs();
    await right.getByRole('button', { name: 'Docking preview', exact: true }).click();
    await expect.poll(async () => (await browserState())?.visible).toBe(true);
    expect((await browserState())?.marker).toBe(marker);

    await right.getByTestId('thread-secondary-new-tab').click();
    await expectBrowserBehindMenu(right);
    await page.getByRole('menuitem', { name: 'Terminal', exact: true }).click();
    const firstTerminal = right.getByTestId('thread-terminal-tab');
    await expect(firstTerminal.locator('.xterm')).toBeVisible();
    const sessionId = (await firstTerminal.getAttribute('data-terminal-session'))!;
    // Thread shells belong to the thread's recorded host. Exercise the UI's
    // routed transport instead of the legacy desktop-only PTY IPC surface.
    await firstTerminal.locator('.xterm-helper-textarea').fill('echo DOCK_SCROLLBACK_MARKER');
    await page.keyboard.press('Enter');
    const output = () => page.evaluate(async id => (await (await fetch(`/api/v1/terminals/${id}/output`)).json()).text as string, sessionId);
    await expect.poll(output).toContain('DOCK_SCROLLBACK_MARKER\r\n');
    await firstTerminal.locator('.xterm').evaluate(element => { (window as any).dockingXterm = element; });
    await right.getByRole('button', { name: 'Right panel actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Close Terminal' })).toContainText('Stops this terminal session');
    await page.getByRole('menuitem', { name: 'Move Terminal to bottom panel' }).click();
    await expect(bottom.locator('.xterm')).toBeVisible();
    expect(await bottom.locator('.xterm').evaluate(element => element === (window as any).dockingXterm)).toBe(true);
    await expect.poll(async () => (await browserState())?.visible).toBe(true);
    expect((await browserState())?.marker).toBe(marker);

    // Actual drag gestures, including a drop above a native browser view.
    await bottom.locator('.thread-secondary-tab').filter({ hasText: 'Terminal' }).dragTo(right.locator('.thread-secondary-body'));
    await expect(bottom).toHaveCount(0);
    await expect(right.locator('.xterm')).toBeVisible();
    await expect(page.getByTestId('thread-bottom-drop-target')).toHaveCount(0);
    const terminalBounds = await right.locator('.thread-secondary-tab').filter({ hasText: 'Terminal' }).boundingBox();
    if (!terminalBounds) throw new Error('Missing terminal tab');
    await page.mouse.move(terminalBounds.x + terminalBounds.width / 2, terminalBounds.y + terminalBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(terminalBounds.x + terminalBounds.width / 2, terminalBounds.y + terminalBounds.height + 20, { steps: 5 });
    const drop = page.getByTestId('thread-bottom-drop-target');
    await expect(drop).toBeVisible();
    const dropBounds = (await drop.boundingBox())!;
    await page.mouse.move(dropBounds.x + dropBounds.width / 2, dropBounds.y + dropBounds.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(bottom.locator('.xterm')).toBeVisible();
    expect(await bottom.locator('.xterm').evaluate(element => element === (window as any).dockingXterm)).toBe(true);
    await expect(draft).toHaveText('Keep my docking notes');

    const resize = bottom.getByRole('separator', { name: 'Resize bottom panel' });
    await resize.focus(); await resize.press('ArrowUp');
    await expect(resize).toHaveAttribute('aria-valuenow', '256');
    const bounds = await resize.boundingBox(); if (!bounds) throw new Error('Missing dock resizer');
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2, bounds.y - 32, { steps: 5 }); await page.mouse.up();
    const savedHeight = await resize.getAttribute('aria-valuenow'); expect(Number(savedHeight)).toBeGreaterThan(256);
    await bottom.getByRole('button', { name: 'Hide bottom panel' }).click(); await expect(bottom.locator('.xterm')).toHaveCount(0);
    await bottom.getByRole('button', { name: 'Expand bottom panel' }).click(); await expect(bottom.locator('.xterm')).toBeVisible();
    expect(await bottom.locator('.xterm').evaluate(element => element === (window as any).dockingXterm)).toBe(true);

    // A second terminal may be visible independently in the right group.
    await right.getByTestId('thread-secondary-new-tab').click(); await page.getByRole('menuitem', { name: 'Terminal', exact: true }).click();
    await expect(right.locator('.xterm')).toBeVisible(); await expect(bottom.locator('.xterm')).toBeVisible();
    expect(await right.getByTestId('thread-terminal-tab').getAttribute('data-terminal-session')).not.toBe(sessionId);
    await right.getByRole('button', { name: 'Close Terminal', exact: true }).click();
    await right.getByRole('button', { name: 'Docking preview', exact: true }).click();
    await expect.poll(async () => (await browserState())?.visible).toBe(true);

    // Moving a native browser changes its placement without reloading its page.
    await right.getByRole('button', { name: 'Docking preview', exact: true }).press('Shift+F10');
    await expectBrowserBehindMenu(right);
    await captureElectronScreenshot(electron, page, testInfo.outputPath('browser-right-menu.png'));
    await page.getByRole('menuitem', { name: 'Move Docking preview to bottom panel' }).click();
    await expect.poll(async () => (await browserState())?.visible).toBe(true);
    expect((await browserState())?.marker).toBe(marker);
    await right.getByRole('button', { name: 'Maximize panel', exact: true }).click();
    await expect.poll(async () => (await browserState())?.visible).toBe(false);
    await right.getByRole('button', { name: 'Restore conversation', exact: true }).click();
    await expect.poll(async () => (await browserState())?.visible).toBe(true);
    await bottom.getByRole('button', { name: 'Maximize panel', exact: true }).click();
    await expect.poll(async () => (await browserState())?.visible).toBe(true);
    await bottom.getByRole('button', { name: 'Restore conversation', exact: true }).click();
    await bottom.getByRole('button', { name: 'Bottom panel actions' }).click();
    await expectBrowserBehindMenu(bottom);
    await captureElectronScreenshot(electron, page, testInfo.outputPath('browser-bottom-menu.png'));
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await browserState())?.visible).toBe(true);
    await expect(bottom.locator('.thread-browser-snapshot')).toHaveCount(0);
    expect((await browserState())?.marker).toBe(marker);
    await bottom.getByRole('button', { name: 'Bottom panel actions' }).click();
    await expectBrowserBehindMenu(bottom);
    await page.getByRole('menuitem', { name: 'Move Docking preview to right panel' }).click();
    await expect(bottom.locator('.xterm')).toBeVisible();
    expect((await browserState())?.marker).toBe(marker);

    // Direct add targets its own dock without consuming the other dock's launcher.
    await openThreadToolLauncher(right);
    await bottom.getByTestId('thread-secondary-new-tab').click();
    await page.getByRole('menuitem', { name: 'Files', exact: true }).click();
    await expect(bottom.getByRole('button', { name: 'Explorer', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(right.getByTestId('thread-new-tab-terminal')).toBeVisible();
    await bottom.getByRole('button', { name: 'Close Explorer', exact: true }).click();
    await right.getByRole('button', { name: 'Close New Tab', exact: true }).click();
    await right.getByRole('button', { name: 'Docking preview', exact: true }).click();

    // A tool launched in the bottom group replaces that group's launcher.
    await openThreadToolLauncher(bottom);
    await bottom.getByTestId('thread-new-tab-terminal').click();
    await expect(bottom.locator('.xterm')).toBeVisible();
    await expect.poll(async () => (await browserState())?.visible).toBe(true);
    await bottom.getByRole('button', { name: 'Close Terminal', exact: true }).last().click();
    await expect(bottom.getByTestId('thread-terminal-tab')).toHaveAttribute('data-terminal-session', sessionId);

    await route(`/threads/${ids[1]}`); await expect(bottom).toHaveCount(0);
    await page.getByTestId('titlebar-thread-tabs').getByRole('tab', { name: /Thread docking/ }).click();
    await expect(bottom.locator('.xterm')).toBeVisible(); await expect(resize).toHaveAttribute('aria-valuenow', savedHeight!);
    await expect(draft).toHaveText('Keep my docking notes');
    expect(await bottom.locator('.xterm').evaluate(element => element === (window as any).dockingXterm)).toBe(true);
    await expect.poll(async () => (await browserState())?.visible).toBe(true); expect((await browserState())?.marker).toBe(marker);

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(theme => window.cc.config.set({ theme }), theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await captureElectronScreenshot(electron, page, testInfo.outputPath(`thread-tool-docking-${theme}.png`));
    }
    for (const width of [1180, 980]) {
      await nativeWindow.evaluate((win, width) => win.setSize(width, 800), width);
      await expect.poll(() => page.evaluate(() => {
        const bottom = document.querySelector('[data-testid="thread-bottom-panel"]')!.getBoundingClientRect();
        const right = document.querySelector('[data-testid="thread-secondary-panel"]')!.getBoundingClientRect();
        return { usable: bottom.width > 0 && bottom.height >= 120, separated: bottom.right <= right.left + 1,
          insideViewport: bottom.bottom <= innerHeight + 1,
          geometry: { width: innerWidth, height: innerHeight, bottom: bottom.toJSON(), right: right.toJSON() } };
      })).toMatchObject({ usable: true, separated: true, insideViewport: true });
      await expect(draft).toBeVisible();
      await expectUnifiedTabs();
      expect((await draft.boundingBox())!.width).toBeGreaterThan(300);
      await captureElectronScreenshot(electron, page, testInfo.outputPath(`thread-tool-docking-${width}.png`));
    }
    // A pinned tab and a live terminal share the bottom strip and restore together.
    await right.getByTestId('thread-info-pin').press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Move Info to bottom panel' }).click();
    await expect(bottom.getByTestId('thread-info-pin')).toHaveAttribute('aria-pressed', 'true');
    await bottom.getByRole('button', { name: 'Terminal', exact: true }).click();
    expect(await bottom.locator('.xterm').evaluate(element => element === (window as any).dockingXterm)).toBe(true);
    await page.reload(); await expect(bottom.locator('.xterm')).toBeVisible(); await expect(resize).toHaveAttribute('aria-valuenow', savedHeight!);
    await expect(bottom.getByTestId('thread-info-pin')).toBeVisible();
    await expect(right.getByTestId('thread-info-pin')).toHaveCount(0);
    await route('/settings/experimental');
    const toggle = page.getByRole('switch', { name: 'Dockable thread tools', exact: true });
    await expect(toggle).toHaveAttribute('aria-checked', 'true'); await toggle.click();
    await route(`/threads/${ids[0]}`); await expect(bottom).toHaveCount(0);
    await expect(page.getByTestId('titlebar-thread-tabs')).toBeVisible();
    await right.getByRole('button', { name: 'Terminal', exact: true }).click(); await expect(right.locator('.xterm:visible')).toHaveCount(1);
    await route('/settings/experimental'); await toggle.click(); await route(`/threads/${ids[0]}`); await expect(bottom.locator('.xterm')).toBeVisible();
    await expect.poll(() => page.evaluate(async id => {
      const { sessions } = await (await fetch('/api/v1/terminals')).json();
      return sessions.filter((row: { projectId: string; status: string }) => row.projectId === id && row.status !== 'exited').length;
    }, projectId)).toBe(1);
    // Bulk close follows the real terminal shutdown and native browser cleanup paths.
    await bottom.getByRole('button', { name: 'Bottom panel actions' }).click();
    await page.getByRole('menuitem', { name: /^Close all tabs/ }).click();
    await expect(bottom.locator('.thread-secondary-tab:not(.is-pinned)')).toHaveCount(0);
    await expect(bottom.getByTestId('thread-info-pin')).toBeVisible();
    await expect.poll(() => page.evaluate(async id => {
      const { sessions } = await (await fetch('/api/v1/terminals')).json();
      return sessions.find((session: { id: string }) => session.id === id)?.status ?? 'exited';
    }, sessionId)).toBe('exited');
    await expect.poll(async () => (await browserState())?.visible).toBe(true);
    await right.getByRole('button', { name: 'Right panel actions' }).click();
    await page.getByRole('menuitem', { name: 'Close all tabs', exact: true }).click();
    await expect(right.locator('.thread-secondary-tab:not(.is-pinned)')).toHaveCount(0);
    await expect.poll(browserState).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(async id => {
      const { sessions } = await (await fetch('/api/v1/terminals')).json();
      for (const session of sessions.filter((row: { projectId: string }) => row.projectId === id)) await fetch(`/api/v1/terminals/${session.id}/close`, { method: 'POST' });
    }, projectId);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
