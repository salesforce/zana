import { openThreadToolLauncher } from './fixtures/thread-tool-panel.js';
import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test.describe('document panel resizing', () => {
  test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { dockableThreadToolsEnabled: true, sponsorPromptDismissed: true } });

  for (const width of [1440, 1000]) {
    test(`document preview follows the divider at ${width}px`, async ({ app }, testInfo) => {
      const page = app.window;
      await page.setViewportSize({ width, height: 800 });
      const root = join(app.home, 'resize-project');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'notes.md'), '# Resizable document\n\nA document opened in the thread panel.');
      const threadId = await page.evaluate(async root => {
        const project = await window.cc.projects.add(root);
        if (!project.ok) throw new Error(project.message);
        const response = await fetch('/api/v1/threads', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Panel resize regression' })
        });
        const body = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(body));
        const id = (body.thread ?? body.value).id as string;
        history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate'));
        return id;
      }, root);
      await expect(page.getByTestId('thread-detail')).toBeVisible();
      await page.evaluate(async threadId => {
        const response = await fetch(`/api/v1/threads/${threadId}/open`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file: { source: 'workspace', path: 'notes.md' } })
        });
        if (!response.ok) throw new Error(await response.text());
      }, threadId);
      const panel = page.getByTestId('thread-secondary-panel');
      await expect(panel.getByRole('heading', { name: 'Resizable document' })).toBeVisible();
      const container = await panel.evaluate(node => {
        const rect = node.parentElement!.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      });
      const panelWidth = () => panel.evaluate(node => node.getBoundingClientRect().width);
      // Native Windows display scaling can round the pointer and layout by a pixel.
      const expectWidth = async (target: number) => {
        await expect.poll(async () => Math.abs(await panelWidth() - target)).toBeLessThan(2);
      };
      const dragToWidth = async (target: number) => {
        const divider = (await panel.getByRole('separator', { name: 'Resize right panel' }).boundingBox())!;
        await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
        await page.mouse.down();
        await page.mouse.move(container.right - target, divider.y + divider.height / 2, { steps: 10 });
        await page.mouse.up();
      };
      const initialWidth = await panelWidth();
      const expandedWidth = Math.floor(container.width * 0.65);
      await dragToWidth(expandedWidth);
      await expect.poll(panelWidth).toBeGreaterThan(initialWidth + 20);
      await expectWidth(expandedWidth);
      await dragToWidth(container.width * 0.9);
      await expectWidth(Math.floor(container.width * 0.7));
      await dragToWidth(100);
      await expectWidth(288);
      await dragToWidth(expandedWidth);
      await page.reload();
      await expect(panel.getByRole('heading', { name: 'Resizable document' })).toBeVisible();
      await expectWidth(expandedWidth);
      await captureElectronScreenshot(app.electron, page, testInfo.outputPath(`document-resized-${width}.png`));
    });
  }
});

test('panel menus close tab groups without affecting the other dock or pinned views', async ({ app }, testInfo) => {
  const page = app.window;
  await page.evaluate(() => {
    const owner = 'e2e-panel-bulk-close';
    localStorage.setItem(`zcc.secondaryPanel.${owner}`, JSON.stringify({
      version: 1, isOpen: true, isMaximized: false, widthPx: 500, activeId: 'first',
      tabs: ['first', 'middle', 'last', 'bottom-first', 'bottom-last'].map(id => ({ id, kind: 'new-tab', title: id }))
    }));
    localStorage.setItem('zcc.thread-tool-docks.v1', JSON.stringify([{ owner, dock: {
      bottomIds: ['bottom-first', 'bottom-last'], bottomActiveId: 'bottom-last', rightActiveId: 'first',
      heightPx: 240, collapsed: false, maximized: false
    } }]));
    history.pushState({}, '', `/threads/${owner}`); dispatchEvent(new PopStateEvent('popstate'));
  });
  const right = page.getByTestId('thread-secondary-panel'), bottom = page.getByTestId('thread-bottom-panel');
  const tools = (panel: typeof right) => panel.locator('.thread-secondary-tab:not(.is-pinned)');
  await expect(tools(right)).toHaveCount(3); await expect(tools(bottom)).toHaveCount(2);
  await right.getByRole('button', { name: 'middle', exact: true }).click({ button: 'right' });
  await expect(right.getByRole('button', { name: 'first', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('panel-bulk-close-menu.png'));
  await page.getByRole('menuitem', { name: 'Close tabs to the right', exact: true }).click();
  await expect(tools(right)).toHaveCount(2); await expect(right.getByRole('button', { name: 'last', exact: true })).toHaveCount(0);
  await expect(tools(bottom)).toHaveCount(2);
  await right.getByRole('button', { name: 'middle', exact: true }).press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Close tabs to the right', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Close tabs to the left', exact: true }).click();
  await expect(tools(right)).toHaveCount(1); await expect(right.getByTestId('thread-info-pin')).toBeVisible();
  await bottom.getByRole('button', { name: 'Bottom panel actions' }).click();
  await page.getByRole('menuitem', { name: 'Close other tabs', exact: true }).click();
  await expect(tools(bottom)).toHaveCount(1); await expect(bottom.getByRole('button', { name: 'bottom-last', exact: true })).toBeVisible();
  await right.getByRole('button', { name: 'Right panel actions' }).click();
  await page.getByRole('menuitem', { name: 'Close all tabs', exact: true }).click();
  await expect(tools(right)).toHaveCount(0); await expect(tools(bottom)).toHaveCount(1);
  await right.getByRole('button', { name: 'Right panel actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Close all tabs', exact: true })).toBeDisabled();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: /^Hide right panel/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await bottom.getByRole('button', { name: 'Bottom panel actions' }).click();
  await page.getByRole('menuitem', { name: 'Close all tabs', exact: true }).click();
  await expect(bottom).toHaveCount(0);
  await page.reload(); await expect(tools(right)).toHaveCount(0);
  await expect(right.getByTestId('thread-info-pin')).toBeVisible(); await expect(bottom).toHaveCount(0);
});

test('secondary panel tabs scroll without overlapping fixed controls in small windows', async ({ app }, testInfo) => {
  const { window, electron } = app;
  const titles = ['browser-with-a-very-long-title-that-should-stay-compact.html', 'native-build-configuration.ts', 'deployment-notes.md', 'integration-results.md'];
  await window.evaluate((titles) => {
    localStorage.setItem('zcc.secondaryPanel.e2e-panel-layout', JSON.stringify({
      version: 1, isOpen: true, isMaximized: false, widthPx: 352, activeId: 'tab-3',
      tabs: titles.map((title, index) => ({ id: `tab-${index}`, kind: 'new-tab', title }))
    }));
    history.pushState({}, '', '/threads/e2e-panel-layout');
    dispatchEvent(new PopStateEvent('popstate'));
  }, titles);
  const panel = window.getByTestId('thread-secondary-panel');
  const chrome = panel.getByTestId('thread-secondary-chrome');
  const tabs = panel.locator('.thread-secondary-tabs');
  await expect(panel).toBeVisible();
  await expect.poll(() => tabs.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);

  for (const width of [1280, 900, 800]) {
    await window.setViewportSize({ width, height: 740 });
    await expect.poll(() => chrome.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const groups = [...node.children].map((child) => child.getBoundingClientRect());
      return node.scrollWidth <= node.clientWidth
        && groups.every((group, index) => group.left >= bounds.left && group.right <= bounds.right
          && (index === 0 || group.left >= groups[index - 1].right));
    })).toBe(true);
    expect(await tabs.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    for (const button of await chrome.locator('.thread-secondary-pin').all()) {
      expect(await button.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        return bounds.width >= 27 && node.contains(document.elementFromPoint(
          bounds.x + bounds.width / 2, bounds.y + bounds.height / 2
        ));
      })).toBe(true);
    }
    await captureElectronScreenshot(electron, window, testInfo.outputPath(`secondary-panel-${width}.png`));
  }

  // Keyboard focus scrolls offscreen tabs into view; their close buttons stay reachable.
  for (const title of titles) {
    const label = tabs.getByRole('button', { name: title, exact: true });
    await label.focus();
    await label.press('Enter');
    await expect(label.locator('..')).toHaveClass(/is-active/);
    const close = tabs.getByRole('button', { name: `Close ${title}`, exact: true });
    await close.focus();
    await expect.poll(() => close.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
    })).toBe(true);
  }
  for (const title of titles.slice(1)) await tabs.getByRole('button', { name: `Close ${title}`, exact: true }).click();
  await expect(tabs.locator('.thread-secondary-tab:not(.is-pinned)')).toHaveCount(1);
  await expect(tabs.locator('.thread-secondary-tab.is-pinned')).toHaveCount(1);
  const tabBounds = (await tabs.locator('.thread-secondary-tab:not(.is-pinned)').boundingBox())!;
  const add = panel.getByTestId('thread-secondary-new-tab');
  const addBounds = (await add.boundingBox())!;
  expect(addBounds.x - tabBounds.x - tabBounds.width).toBeLessThanOrEqual(8);
  await add.click();
  await expect(window.getByRole('menuitem', { name: 'Terminal', exact: true })).toBeFocused();
  await window.keyboard.press('End');
  await expect(window.getByRole('menuitem', { name: 'More tools…' })).toBeFocused();
  await window.keyboard.press('Escape');
  await expect(add).toBeFocused();
  await openThreadToolLauncher(panel);
  await expect(tabs.locator('.thread-secondary-tab.is-active')).toContainText('New Tab');
  await expect(panel.getByTestId('thread-new-tab-page')).toBeVisible();
  await panel.getByTestId('thread-secondary-maximize').click();
  await expect(panel).toHaveClass(/is-maximized/);
  await panel.getByRole('button', { name: 'Restore conversation' }).click();
  await expect(panel).not.toHaveClass(/is-maximized/);
  await panel.getByTestId('thread-secondary-hide').click();
  await expect(panel).toHaveCount(0);
  await window.getByTestId('thread-secondary-show').click();
  await expect(panel).toBeVisible();
  await expect(tabs.locator('.thread-secondary-tab:not(.is-pinned)')).toHaveCount(2);
  await window.evaluate(() => window.cc.config.set({ theme: 'light' }));
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'light');
  await captureElectronScreenshot(electron, window, testInfo.outputPath('secondary-panel-header-light.png'));
});
