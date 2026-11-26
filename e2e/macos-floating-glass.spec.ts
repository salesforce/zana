import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures/app.js';

test.skip(process.platform !== 'darwin', 'macOS desktop material');
test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: {
    agentsBoardView: 'board',
    sponsorPromptDismissed: true,
    theme: 'light'
  }
});

test('Glass Mode is off by default and updates the native workspace from Experimental settings', async ({ app }) => {
  const page = app.window;
  await page.evaluate(() => {
    history.pushState({}, '', '/settings/experimental');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  const toggle = page.getByRole('switch', { name: 'Glass Mode' });
  const shell = page.locator('.app-shell');
  const nativeWindow = await app.electron.browserWindow(page);
  const backing = () => nativeWindow.evaluate(win => win.getBackgroundColor().toLowerCase());
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(shell).toHaveAttribute('data-glass-mode', 'false');
  const initialBacking = await backing();
  expect(initialBacking).not.toBe('#000000');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(shell).toHaveAttribute('data-glass-mode', 'true');
  await expect.poll(backing).toBe('#000000');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(shell).toHaveAttribute('data-glass-mode', 'true');
  await toggle.click();
  await expect(shell).toHaveAttribute('data-glass-mode', 'false');
  await expect.poll(backing).toBe(initialBacking);
});

for (const glass of [false, true]) {
  test(`${glass ? 'Glass Mode in Basic' : 'Classic'} aligns the sidebar and resizes from the gutter`, async ({ app }) => {
    const { window: page } = app;
    if (glass) {
      await page.evaluate(() => window.cc.config.set({ glassModeEnabled: true }));
      await page.getByTestId('basic-ui-mode-basic').click();
    }
    const shell = page.locator('.app-shell');
    const sidebar = shell.locator(':scope > .sidebar');
    const sheet = shell.locator('.shell-main > :is(.split-workspace, .new-thread-view, .home-panel)');
    const divider = sidebar.getByRole('separator');
    await expect(shell).toHaveAttribute('data-glass-mode', String(glass));
    await expect(divider).toBeVisible();
    await expect(sheet).toBeVisible();
    const shellBox = (await shell.boundingBox())!;
    const sidebarBox = (await sidebar.boundingBox())!;
    const sheetBox = (await sheet.boundingBox())!;
    const titlebarBox = (await shell.locator('.titlebar').boundingBox())!;
    expect(sheetBox.y - titlebarBox.y - titlebarBox.height).toBeCloseTo(8, 1);
    const outerInset = sidebarBox.x - shellBox.x;
    expect(outerInset).toBeGreaterThan(0);
    expect(Math.abs(outerInset - (shellBox.x + shellBox.width - sheetBox.x - sheetBox.width))).toBeLessThan(1);
    expect(Math.abs(sidebarBox.y - sheetBox.y)).toBeLessThan(1);
    expect(Math.abs(sidebarBox.y + sidebarBox.height - sheetBox.y - sheetBox.height)).toBeLessThan(1);

    const grip = () => divider.evaluate((element) => {
      const mark = getComputedStyle(element, '::after');
      return { color: mark.backgroundColor, height: parseFloat(mark.height) };
    });
    await page.mouse.move(sheetBox.x + 40, sheetBox.y + 40);
    expect((await grip()).color).toBe('rgba(0, 0, 0, 0)');
    const gutterX = (sidebarBox.x + sidebarBox.width + sheetBox.x) / 2;
    const gutterY = sidebarBox.y + sidebarBox.height / 2;
    await page.mouse.move(gutterX, gutterY);
    expect((await grip()).height).toBeCloseTo(36, 1);
    expect((await grip()).color).not.toBe('rgba(0, 0, 0, 0)');

    await page.mouse.down();
    await page.mouse.move(gutterX + 45, gutterY, { steps: 5 });
    await page.mouse.up();
    expect((await sidebar.boundingBox())!.width).toBeGreaterThan(sidebarBox.width + 30);
    await expect(page.locator('body')).not.toHaveClass(/resizing-col/);
  });
}

test('floating chrome keeps the Agents board readable and interactive', async ({ app }) => {
  const { window: page, home } = app;
  await page.evaluate(() => window.cc.config.set({ glassModeEnabled: true }));
  const projectPath = join(home, 'Floating project');
  mkdirSync(projectPath);
  const titles = ['Review the toolbar', 'Check the matte cards'];
  await page.evaluate(async ({ projectPath, titles }) => {
    const project = await window.cc.projects.add(projectPath);
    if (!project.ok) throw new Error(project.message);
    for (const title of titles) {
      const response = await fetch('/api/v1/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', title, input: 'Preview the Agents board' })
      });
      if (!response.ok) throw new Error(await response.text());
    }
  }, { projectPath, titles });

  await page.getByTestId('nav-agents').click();
  const shell = page.locator('.app-shell');
  const sidebar = shell.locator('.sidebar');
  const board = shell.locator('.agents-board--global');
  const boardSheet = shell.locator('.shell-main > :is(.agents-board--global, .split-workspace)');
  const filter = board.getByRole('textbox', { name: 'Filter agents' });
  const cards = board.locator('.agent-card.is-thread');
  await expect(shell).toHaveAttribute('data-surface', 'desktop');
  await expect(shell).toHaveAttribute('data-platform', 'macos');
  await expect(shell).toHaveAttribute('data-traffic-lights', 'true');
  await expect(sidebar).toHaveCSS('border-top-left-radius', '14px');
  await expect(boardSheet).toHaveCSS('border-top-left-radius', '16px');
  await expect(board.getByRole('button', { name: 'New agent', exact: true })).toHaveCSS('border-top-left-radius', '999px');
  await expect(board.locator('.agents-lane').first()).toHaveCSS('border-top-left-radius', '14px');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toHaveCSS('border-top-left-radius', '11px');
  await expect(cards.first().locator('.agent-card-title')).toHaveCSS('white-space', 'normal');
  const footer = await cards.first().evaluate((card) => {
    const title = card.querySelector('.agent-card-title')!.getBoundingClientRect();
    const runtime = card.querySelector('.agent-card-sub')!.getBoundingClientRect();
    const chip = card.querySelector('.fleet-kind-thread')!.getBoundingClientRect();
    return { underTitle: chip.top >= title.bottom, besideRuntime: chip.left >= runtime.right };
  });
  expect(footer).toEqual({ underTitle: true, besideRuntime: true });

  await filter.fill('toolbar');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText(titles[0]);
  await board.getByRole('button', { name: 'Clear filter' }).click();
  await expect(cards).toHaveCount(2);

  const cdp = await page.context().newCDPSession(page);
  async function setTransparency(value: 'reduce' | 'no-preference') {
    await cdp.send('Emulation.setEmulatedMedia', { features: [
      { name: 'prefers-reduced-transparency', value },
      { name: 'prefers-contrast', value: 'no-preference' }
    ] });
  }
  const backgroundAlpha = (locator: Locator) => locator.evaluate((element) => {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = getComputedStyle(element).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data[3];
  });
  await setTransparency('no-preference');
  await expect.poll(() => backgroundAlpha(sidebar)).toBeLessThan(255);
  await expect.poll(() => backgroundAlpha(sidebar.getByTestId('nav-agents'))).toBeLessThan(255);
  await setTransparency('reduce');
  await expect.poll(() => backgroundAlpha(sidebar)).toBe(255);
  await expect(sidebar).toHaveCSS('border-top-left-radius', '14px');

  await page.evaluate(() => window.cc.config.set({ theme: 'dark' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(cards).toHaveCount(2);
  await expect.poll(() => backgroundAlpha(sidebar)).toBe(255);
});
