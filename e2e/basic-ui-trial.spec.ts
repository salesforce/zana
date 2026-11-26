import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, dismissConsentOverlays, type AppHandle } from './fixtures/app.js';
import { waitForThreadProvider } from './fixtures/thread-providers.js';
import { openThreadToolLauncher } from './fixtures/thread-tool-panel.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import { pickComposerSetting, expectComposerSetting } from './fixtures/composer-settings.js';

test.use({
  e2e: true,
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  isolateBundledCatalog: true,
  initialConfig: {
    sponsorPromptDismissed: true, theme: 'light',
    composerShowModern: true, composerShowCliAgent: true,
    dockableThreadToolsEnabled: false
  }
});

const basic = (page: Page) => page.getByTestId('basic-ui-mode-basic');
const advanced = (page: Page) => page.getByTestId('basic-ui-mode-advanced');
const sidebar = (page: Page) => page.getByTestId('basic-ui-sidebar');

async function navigate(page: Page, path: string) {
  await page.evaluate(path => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

async function projectAndThreads(app: AppHandle, titles: string[], input = 'A useful result', projectName = 'Basic UI project') {
  const root = join(app.home, projectName);
  mkdirSync(root);
  const path = realpathSync(root);
  writeFileSync(join(path, 'result.html'), '<!doctype html><html><title>Basic result</title><body><h1>A result worth keeping</h1><label>Review notes <input id="notes"></label><script>document.body.dataset.previewSession=String(Math.random())</script></body></html>');
  await waitForThreadProvider(app.window, 'fake');
  const result = await app.window.evaluate(async ({ path, titles, input }) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    const ids: string[] = [];
    for (const title of titles) {
      const response = await fetch('/api/v1/threads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', title, input })
      });
      if (!response.ok) throw new Error(await response.text());
      const body = await response.json();
      ids.push((body.thread ?? body.value).id);
    }
    return { ids, projectId: project.value.id };
  }, { path, titles, input });
  return { ...result, path };
}

async function resize(app: AppHandle, width: number, height: number) {
  const native = await app.electron.browserWindow(app.window);
  await native.evaluate((win, size) => {
    win.webContents.setZoomFactor(1);
    win.setMinimumSize(640, 480);
    win.setContentSize(size.width, size.height);
  }, { width, height });
  await expect.poll(() => app.window.evaluate(() => innerWidth)).toBe(width);
}

async function openResult(page: Page, threadId: string, path: string) {
  await page.evaluate(async ({ threadId, path }) => {
    const response = await fetch(`/api/v1/threads/${threadId}/open`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: { source: 'workspace', path } })
    });
    if (!response.ok) throw new Error(await response.text());
  }, { threadId, path });
}

async function captureTrialScreenshot(app: AppHandle, outputPath: string) {
  // A successful click can precede React's mode commit and the next paint.
  await app.window.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await captureElectronScreenshot(app.electron, app.window, outputPath);
}

async function pasteImage(page: Page) {
  await page.getByTestId('thread-command-input').evaluate(element => {
    const data = new DataTransfer();
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), char => char.charCodeAt(0));
    data.items.add(new File([bytes], 'keep-this.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(page.getByLabel('Attached images')).toBeVisible();
}

test('theme icon sits between the bell and view switch in both desktop views', async ({ app }, testInfo) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  const group = page.getByRole('group', { name: 'Interface view' });
  const bell = page.locator('.titlebar-bell');
  await expect(basic(page)).toHaveAccessibleName('Basic view');
  await expect(advanced(page)).toHaveAccessibleName('Advanced view');

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(theme => window.cc.config.set({ theme }), theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const width of [1440, 640]) {
      await resize(app, width, 900);
      for (const mode of ['advanced', 'basic'] as const) {
        await (mode === 'basic' ? basic(page) : advanced(page)).click();
        await expect(page.locator('.app-shell')).toHaveAttribute('data-ui-mode', mode);
        await expect(bell).toBeVisible();
        await expect(group).toBeInViewport();
        const paint = await group.evaluate(node => {
          const active = node.querySelector('[aria-pressed="true"]')!;
          return {
            background: getComputedStyle(node).backgroundColor,
            titlebar: getComputedStyle(node.parentElement!).backgroundColor,
            selected: getComputedStyle(active).backgroundColor,
            selectedIcon: getComputedStyle(active).color
          };
        });
        expect(paint.background).not.toBe('rgba(0, 0, 0, 0)');
        expect(paint.background).not.toBe(paint.titlebar);
        expect(paint.selected).not.toBe(paint.background);
        expect(paint.selectedIcon).toBe('rgb(255, 255, 255)');
        const switchBox = (await group.boundingBox())!;
        const bellBox = (await bell.boundingBox())!;
        expect(Math.abs((switchBox.y + switchBox.height / 2) - (bellBox.y + bellBox.height / 2))).toBeLessThan(1);
        expect(switchBox.width).toBeLessThanOrEqual(64);
        const appearance = page.getByRole('button', { name: theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode' });
        await expect(appearance).toBeInViewport();
        const themeBox = (await appearance.boundingBox())!;
        expect(themeBox.x - (bellBox.x + bellBox.width)).toBeCloseTo(8, 0);
        expect(switchBox.x - (themeBox.x + themeBox.width)).toBeCloseTo(6, 0);
        expect(Math.abs((themeBox.y + themeBox.height / 2) - (bellBox.y + bellBox.height / 2))).toBeLessThan(1);
        if (mode === 'advanced') {
          const star = (await page.locator('.titlebar-fav').boundingBox())!;
          const help = (await page.getByTestId('titlebar-help-toggle').boundingBox())!;
          expect(star.x + star.width).toBeLessThan(bellBox.x);
          expect(help.x + help.width).toBeLessThan(star.x);
        } else {
          await expect(page.locator('.basic-ui-sidebar-brand')).toHaveCount(0);
          await expect(page.locator('.conversation-welcome > .zana-brand-icon')).toBeVisible();
          await expect(basic(page).locator('.zana-brand-icon')).toBeVisible();
          expect(await basic(page).locator('.zana-brand-icon').evaluate(node => getComputedStyle(node).maskImage)).not.toBe('none');
        }
        await captureTrialScreenshot(app, testInfo.outputPath(`icon-switch-${theme}-${mode}-${width}.png`));
      }
    }
  }

  // The existing bell remains usable from Basic without changing view.
  await bell.click();
  await expect(page.locator('.quick-access-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bell).toBeFocused();
  await expect(basic(page)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(basic(page)).toBeFocused();
  await advanced(page).focus();
  await page.keyboard.press('Enter');
  await expect(advanced(page)).toHaveAttribute('aria-pressed', 'true');
  await basic(page).focus();
  await page.keyboard.press('Space');
  await expect(basic(page)).toHaveAttribute('aria-pressed', 'true');

  // Validate the CSS caption reserve without claiming a native Windows run.
  await page.locator('.app-shell').evaluate(node => {
    node.setAttribute('data-windows-caption', 'true');
    (node as HTMLElement).style.setProperty('--windows-caption-reserve', '142px');
  });
  const reservedSwitch = (await group.boundingBox())!;
  const reservedBell = (await bell.boundingBox())!;
  const reservedTheme = (await page.locator('.titlebar-theme').boundingBox())!;
  expect(reservedTheme.x - (reservedBell.x + reservedBell.width)).toBeCloseTo(8, 0);
  expect(reservedSwitch.x - (reservedTheme.x + reservedTheme.width)).toBeCloseTo(6, 0);
  expect(await group.evaluate(node => innerWidth - node.getBoundingClientRect().right)).toBeGreaterThanOrEqual(142);
});

test('theme shortcut persists across both views and search focus surrounds the rounded field', async ({ app }, testInfo) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await resize(app, 1440, 900);
  await basic(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const search = page.getByRole('searchbox', { name: 'Search chats' });
  await search.fill('no matching conversations');
  const field = page.locator('.basic-ui-chat-search');
  const geometry = await field.evaluate(node => {
    const input = node.querySelector('input')!;
    const field = node.getBoundingClientRect();
    const icon = node.querySelector('svg')!.getBoundingClientRect();
    return { radius: getComputedStyle(node).borderRadius, outline: getComputedStyle(input).outlineStyle,
      shadow: getComputedStyle(node).boxShadow, left: icon.left - field.left, top: icon.top - field.top,
      center: Math.abs(icon.top + icon.height / 2 - field.top - field.height / 2) };
  });
  expect(geometry.radius).toBe('6px');
  expect(geometry.outline).toBe('none');
  expect(geometry.shadow).not.toBe('none');
  expect(geometry.left).toBeGreaterThan(0);
  expect(geometry.top).toBeGreaterThan(0);
  expect(geometry.center).toBeLessThan(1);
  await captureTrialScreenshot(app, testInfo.outputPath('basic-rounded-search-light.png'));
  await page.getByRole('button', { name: 'Clear chat search' }).click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await search.fill('clear with Escape');
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate(async () => (await window.cc.config.get()).theme)).toBe('dark');
  await advanced(page).click();
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => page.evaluate(async () => (await window.cc.config.get()).theme)).toBe('light');
  await captureTrialScreenshot(app, testInfo.outputPath('advanced-theme-shortcut-light.png'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();
  await basic(page).click();
  await expect(page.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();
});

test('Files tab alignment centers the icon and label in Basic without changing other tabs', async ({ app }, testInfo) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await resize(app, 1440, 900);
  const { ids, path } = await projectAndThreads(app, ['Review the Files tab']);
  await navigate(page, `/threads/${ids[0]}`);
  await basic(page).click();
  await openResult(page, ids[0]!, join(path, 'result.html'));
  const files = page.getByTestId('thread-info-pin');
  await expect(files).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const geometry = await files.evaluate(node => {
      const icon = node.querySelector('svg')!.getBoundingClientRect();
      const label = node.querySelector('span')!.getBoundingClientRect();
      const button = node.getBoundingClientRect();
      return { gap: label.left - icon.right, width: icon.width, height: icon.height,
        centers: Math.abs(icon.top + icon.height / 2 - label.top - label.height / 2),
        buttonCenter: Math.abs(button.top + button.height / 2 - icon.top - icon.height / 2) };
    });
    expect(geometry.gap).toBeCloseTo(6, 0);
    expect(geometry.width).toBe(14);
    expect(geometry.height).toBe(14);
    expect(geometry.centers).toBeLessThan(1);
    expect(geometry.buttonCenter).toBeLessThan(1);
    await files.click();
    await expect(files).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'result.html', exact: true })).toBeVisible();
    await captureTrialScreenshot(app, testInfo.outputPath(`basic-files-aligned-${theme}.png`));
  }
});

test('Basic sidebar collapses beside the window controls and restores its state independently of Advanced', async ({ app }, testInfo) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await resize(app, 1440, 900);
  const { ids } = await projectAndThreads(app, ['Keep the project history together', 'Another project conversation']);
  await navigate(page, '/');
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await basic(page).click();
  await expect(sidebar(page)).toBeVisible();
  const draft = page.getByTestId('thread-command-input');
  await draft.fill('Keep this draft while collapsing');
  const search = sidebar(page).getByRole('searchbox', { name: 'Search chats' });
  await search.fill('Keep the project');
  const toggle = page.locator('.basic-ui-shell-heading button');
  await expect(toggle).toHaveAccessibleName('Collapse sidebar');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.basic-ui-shell-heading')).toHaveText('');
  const position = await toggle.evaluate(button => {
    const bounds = button.getBoundingClientRect();
    return { x: bounds.x, trafficLights: button.closest('.app-shell')!.getAttribute('data-traffic-lights'), appRegion: getComputedStyle(button).getPropertyValue('-webkit-app-region') };
  });
  expect(position.x).toBeGreaterThanOrEqual(position.trafficLights === 'true' ? 80 : 8);
  expect(position.appRegion).toBe('no-drag');
  const expandedWidth = (await page.locator('.home-panel').boundingBox())!.width;
  await captureTrialScreenshot(app, testInfo.outputPath('basic-sidebar-toggle-expanded.png'));
  await toggle.click();
  await expect(toggle).toHaveAccessibleName('Expand sidebar');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar(page)).toBeHidden();
  await expect(draft).toHaveText('Keep this draft while collapsing');
  await expect.poll(async () => (await page.locator('.home-panel').boundingBox())!.width).toBeGreaterThan(expandedWidth + 200);
  await captureTrialScreenshot(app, testInfo.outputPath('basic-sidebar-toggle-collapsed.png'));

  await toggle.focus();
  await toggle.press('Enter');
  await expect(sidebar(page)).toBeVisible();
  await expect(search).toHaveValue('Keep the project');
  await expect(sidebar(page).getByRole('link', { name: 'Keep the project history together' })).toBeVisible();
  await expect(sidebar(page).getByRole('link', { name: 'Another project conversation' })).toBeHidden();
  await expect(draft).toHaveText('Keep this draft while collapsing');
  await toggle.click();
  await advanced(page).click();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-is-collapsed/);
  await basic(page).click();
  await expect(sidebar(page)).toBeHidden();
  await resize(app, 640, 800);
  await page.evaluate(() => window.cc.config.set({ theme: 'dark' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toBeInViewport();
  await expect(draft).toBeInViewport();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await captureTrialScreenshot(app, testInfo.outputPath('basic-sidebar-toggle-collapsed-dark-narrow.png'));
  await navigate(page, '/settings');
  await expect(page.getByTestId('basic-ui-unsupported')).toBeVisible();
  expect((await page.getByTestId('basic-ui-unsupported').boundingBox())!.width).toBeGreaterThan(600);
  await toggle.click();
  await expect(sidebar(page)).toBeVisible();
  await expect(toggle).toHaveAccessibleName('Collapse sidebar');
  await navigate(page, `/threads/${ids[0]}`);
  await expect(page.getByTestId('thread-timeline')).toContainText('Response to: A useful result');
  await toggle.click();
  await expect(sidebar(page)).toBeHidden();
  await expect(page.getByTestId('thread-timeline')).toBeInViewport();
  await captureTrialScreenshot(app, testInfo.outputPath('basic-sidebar-toggle-collapsed-conversation.png'));
});

test('Basic sidebar resizes, persists and resets with the same width as Advanced', async ({ app }, testInfo) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await resize(app, 1440, 900);
  await page.evaluate(() => window.cc.config.set({ sidebarWidth: 320 }));
  const shellWidth = () => page.locator('.app-shell').evaluate(node => getComputedStyle(node).getPropertyValue('--col-nav').trim());
  await expect.poll(shellWidth).toBe('320px');
  await projectAndThreads(app, ['A longer conversation title that benefits from a wider sidebar', 'Keep the project history together']);
  await basic(page).click();
  const handle = sidebar(page).getByRole('separator');
  const width = async () => Math.round((await sidebar(page).boundingBox())!.width);
  await expect(handle).toBeVisible();
  await expect.poll(width).toBe(320);
  const dragTo = async (x: number) => {
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(100, box.height / 2));
    await page.mouse.down();
    await page.mouse.move(x, box.y + Math.min(100, box.height / 2), { steps: 8 });
    await page.mouse.up();
  };
  await page.getByTestId('thread-command-input').fill('Keep this draft while resizing');
  await dragTo(390);
  await expect.poll(width).toBe(390);
  await expect.poll(() => page.evaluate(async () => (await window.cc.config.get()).sidebarWidth)).toBe(390);
  await expect(page.locator('body')).not.toHaveClass(/resizing-col/);
  await expect(page.getByTestId('thread-command-input')).toHaveText('Keep this draft while resizing');
  await captureTrialScreenshot(app, testInfo.outputPath('basic-sidebar-resized-390.png'));
  await advanced(page).click();
  await expect.poll(shellWidth).toBe('390px');
  await expect.poll(() => page.locator('aside.sidebar').evaluate(node => Math.round(node.getBoundingClientRect().width))).toBe(390);
  await basic(page).click();
  await expect.poll(width).toBe(390);
  await page.reload();
  await expect(basic(page)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(width).toBe(390);
  await dragTo(600);
  await expect.poll(width).toBe(480);
  await expect.poll(() => page.evaluate(async () => (await window.cc.config.get()).sidebarWidth)).toBe(480);
  await handle.dblclick();
  await expect.poll(width).toBe(256);
  await expect.poll(() => page.evaluate(async () => (await window.cc.config.get()).sidebarWidth)).toBe(256);
  await dragTo(180);
  await expect.poll(width).toBe(256);
  await resize(app, 640, 800);
  await expect(handle).toBeInViewport();
  await expect(page.getByTestId('thread-command-input')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Basic lists conversations in one list, labelled by project, with search and older history', async ({ app }, testInfo) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await resize(app, 1440, 900);
  const release = await projectAndThreads(app, ['Weekly release plan', 'Prepare release notes'], 'A useful result', 'Zana release');
  const website = await projectAndThreads(app, ['Homepage introduction', ...Array.from({ length: 30 }, (_, i) => `Website follow-up ${i + 1}`)], 'A useful result', 'Website');
  await page.evaluate(async ({ releaseId, websiteId }) => {
    const [release, website] = await Promise.all([
      window.cc.projects.update(releaseId, { color: '#39c5cf' }),
      window.cc.projects.update(websiteId, { color: '#2f81f7' })
    ]);
    if (!release || !website) throw new Error('Could not set the project colors');
  }, { releaseId: release.projectId, websiteId: website.projectId });
  await basic(page).click();
  const rows = sidebar(page).locator('.basic-ui-chat-row');
  const search = sidebar(page).getByRole('searchbox', { name: 'Search chats' });
  await expect(sidebar(page).getByRole('button', { name: 'Website', exact: true })).toHaveCount(0);
  await expect(rows).toHaveCount(30);
  const releaseRow = sidebar(page).getByTestId(`basic-chat-row-${release.ids[0]}`);
  const releasePill = releaseRow.locator('.basic-ui-chat-project');
  const websitePill = sidebar(page).getByTestId(`basic-chat-row-${website.ids[0]}`).locator('.basic-ui-chat-project');
  await search.fill('release');
  await expect(rows).toHaveCount(2);
  await expect(releasePill).toHaveText('Zana release');
  await expect(releasePill).toHaveCSS('--basic-chat-project-color', '#39c5cf');
  await expect(releasePill).toHaveCSS('border-radius', '999px');
  const releaseFill = await releasePill.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(releaseFill).not.toBe('rgba(0, 0, 0, 0)');
  await search.fill('');
  const roster = sidebar(page).getByRole('navigation', { name: 'Recent conversations' });
  await resize(app, 1440, 500);
  await expect(roster).toHaveCSS('scrollbar-width', 'none');
  const initialScroll = await roster.evaluate(node => node.scrollTop);
  await roster.hover();
  await page.mouse.wheel(0, 250);
  await expect.poll(() => roster.evaluate(node => node.scrollTop)).toBeGreaterThan(initialScroll);
  await resize(app, 1440, 900);
  await sidebar(page).getByRole('button', { name: 'Show more conversations' }).click();
  await expect(rows).toHaveCount(33);
  await releaseRow.click();
  await expect(page).toHaveURL(new RegExp(`/threads/${release.ids[0]}$`));
  await page.getByTestId('thread-command-input').fill('Keep this draft while searching');
  await search.fill('INTRODUCTION');
  await expect(rows).toHaveCount(1);
  await expect(websitePill).toHaveText('Website');
  await expect(websitePill).toHaveCSS('--basic-chat-project-color', '#2f81f7');
  const websiteFill = await websitePill.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(websiteFill).not.toBe(releaseFill);
  expect(websiteFill).not.toBe('rgba(0, 0, 0, 0)');
  await search.fill('no project matches');
  await expect(sidebar(page).getByRole('status')).toHaveText('No matching conversations.');
  await search.fill('  WEBSITE  ');
  await expect(rows).toHaveCount(30);
  await sidebar(page).getByTestId(`basic-chat-row-${website.ids[0]}`).click();
  await expect(page).toHaveURL(new RegExp(`/threads/${website.ids[0]}$`));
  await search.fill('');
  await expect(page.getByTestId('thread-command-input')).toBeVisible();
  await captureTrialScreenshot(app, testInfo.outputPath('basic-conversations-light-wide.png'));
  await page.evaluate(() => window.cc.config.set({ theme: 'dark' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await resize(app, 640, 800);
  await expect(websitePill).not.toHaveCSS('background-color', websiteFill);
  await expect(page.getByTestId('thread-command-input')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await captureTrialScreenshot(app, testInfo.outputPath('basic-conversations-dark-narrow.png'));
  await advanced(page).click();
  await expect(sidebar(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/threads/${website.ids[0]}$`));
});

test('Basic conversation menu sorts, shows archived history and keeps the choice after reload', async ({ app }, testInfo) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await resize(app, 1440, 900);
  const project = await projectAndThreads(app, ['Zebra roadmap', 'Alpha checklist', 'Retired spike'], 'A useful result', 'Menu project');
  await page.evaluate(async id => {
    const response = await fetch(`/api/v1/threads/${id}/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error(await response.text());
  }, project.ids[2]);
  await basic(page).click();
  const names = () => sidebar(page).locator('.basic-ui-chat-name').allTextContents();
  await expect.poll(async () => (await names()).sort()).toEqual(['Alpha checklist', 'Zebra roadmap']);
  const options = sidebar(page).getByRole('button', { name: 'Conversation view options' });
  const menu = sidebar(page).getByRole('menu', { name: 'Conversation view options' });
  await options.click();
  await menu.getByRole('menuitem', { name: /^Sort by/ }).click();
  await menu.getByRole('menuitemradio', { name: 'Title' }).click();
  await expect.poll(names).toEqual(['Alpha checklist', 'Zebra roadmap']);
  await menu.getByRole('menuitem', { name: /^Status/ }).click();
  await menu.getByRole('menuitemradio', { name: 'All' }).click();
  await expect.poll(names).toEqual(['Alpha checklist', 'Retired spike', 'Zebra roadmap']);
  await menu.getByRole('menuitem', { name: /^Status/ }).click();
  await menu.getByRole('menuitemradio', { name: 'Archived' }).click();
  await expect.poll(names).toEqual(['Retired spike']);
  await expect(sidebar(page).getByTestId('basic-conversation-filter')).toHaveText('Archived');
  await captureElectronScreenshot(app.electron, page, testInfo.outputPath('basic-conversation-menu.png'));
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.reload();
  await expect.poll(names).toEqual(['Retired spike']);
  await options.click();
  await menu.getByRole('menuitem', { name: /^Status/ }).click();
  await menu.getByRole('menuitemradio', { name: 'Active' }).click();
  await expect(sidebar(page).getByTestId('basic-conversation-filter')).toHaveCount(0);
  await expect.poll(names).toEqual(['Alpha checklist', 'Zebra roadmap']);
  await page.evaluate(() => localStorage.removeItem('zana.basicSidebar.conversationView'));
});

test('Basic conversation row actions pin, rename, archive and restore a chat', async ({ app }) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await resize(app, 900, 640);
  const { ids: [first, second] } = await projectAndThreads(app, ['Release checklist', 'Deployment notes']);
  await basic(page).click();

  const row = sidebar(page).getByTestId(`basic-chat-row-${first}`);
  const actions = (name: string) => sidebar(page).getByRole('button', { name: `Actions for ${name}`, exact: true });
  const item = (name: string) => page.getByRole('menuitem', { name, exact: true });
  await sidebar(page).getByTestId(`basic-chat-row-${second}`).click();
  await expect(page).toHaveURL(new RegExp(`/threads/${second}$`));
  const releaseActions = actions('Release checklist');
  await expect(releaseActions).toHaveCSS('opacity', '0');
  await row.hover();
  await expect(releaseActions).toHaveCSS('opacity', '1');
  const heading = sidebar(page).getByRole('heading', { name: 'Conversations', exact: true });
  await heading.hover();
  await expect(releaseActions).toHaveCSS('opacity', '0');
  await row.press('Tab');
  await expect(releaseActions).toBeFocused();
  await expect(releaseActions).toHaveCSS('opacity', '1');
  await page.keyboard.press('ArrowDown');
  await expect(item('Pin')).toBeFocused();
  await expect(releaseActions).toHaveCSS('opacity', '1');
  await page.keyboard.press('Escape');
  await expect(actions('Release checklist')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await item('Pin').click();
  await expect(sidebar(page).locator('.basic-ui-chat-row').first()).toHaveAttribute('aria-label', /Release checklist.*pinned/);
  await expect(page).toHaveURL(new RegExp(`/threads/${second}$`));

  await row.hover();
  await releaseActions.click();
  await item('Rename').click();
  const rename = page.getByRole('dialog', { name: 'Rename conversation' });
  await rename.getByRole('textbox', { name: 'Title' }).fill('Release handoff');
  await rename.getByRole('button', { name: 'Rename' }).click();
  await expect(row).toContainText('Release handoff');
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/threads/${first}$`));
  await actions('Release handoff').click();
  page.once('dialog', dialog => dialog.accept());
  await item('Archive').click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Advanced view' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page).not.toHaveURL(new RegExp(`/threads/${first}$`));

  const selectStatus = async (name: string) => {
    await sidebar(page).getByRole('button', { name: 'Conversation view options' }).click();
    await page.getByRole('menuitem', { name: /^Status/ }).click();
    await page.getByRole('menuitemradio', { name, exact: true }).click();
    await page.keyboard.press('Escape');
  };
  await selectStatus('Archived');
  await expect(row).toContainText('Archived');
  await row.hover();
  await actions('Release handoff').click();
  await item('Restore').click();
  await expect(row).toHaveCount(0);
  await selectStatus('Active');
  await expect(row).toContainText('Release handoff');
});

test('Basic is opt-in, keeps a full searchable conversation list, and restores Advanced splits', async ({ app }, testInfo) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await resize(app, 1440, 900);
  await expect(advanced(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(sidebar(page)).toHaveCount(0);
  const { ids } = await projectAndThreads(app, ['Weekly update to find', 'A second conversation']);
  await navigate(page, '/');
  const input = page.getByTestId('thread-command-input');
  await input.fill('Keep the home draft while changing views');

  // An existing Advanced split is presentation state, never disposable when
  // Basic focuses one conversation. Exercise the real drag and split store.
  const workspace = page.getByTestId('split-workspace');
  const from = (await page.getByTestId('nav-inbox').boundingBox())!;
  const to = (await workspace.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width * .9, to.y + to.height * .5, { steps: 12 });
  await expect(page.locator('.split-drag-overlay-label')).toHaveText('Split right');
  await page.mouse.up();
  await expect(workspace.locator('.split-pane')).toHaveCount(2);
  await input.click();
  await basic(page).click();
  await expect(sidebar(page)).toBeVisible();
  await expect(input).toHaveText('Keep the home draft while changing views');
  await advanced(page).click();
  await expect(workspace.locator('.split-pane')).toHaveCount(2);
  await expect(workspace.locator('.split-pane-bar-title')).toHaveText(['Home', 'Inbox']);
  await expect(input).toHaveText('Keep the home draft while changing views');
  await captureTrialScreenshot(app, testInfo.outputPath('advanced-restored-splits.png'));
  await workspace.getByRole('button', { name: 'Close pane', exact: true }).last().click();

  await basic(page).click();
  await expect(sidebar(page).getByRole('link', { name: /Weekly update to find/ })).toBeVisible();
  await expect(sidebar(page).getByRole('link', { name: /A second conversation/ })).toBeVisible();
  const search = sidebar(page).getByRole('searchbox', { name: 'Search chats' });
  await search.fill('Weekly update to find');
  await expect(sidebar(page).getByRole('link', { name: /A second conversation/ })).toHaveCount(0);
  await sidebar(page).getByRole('link', { name: /Weekly update to find/ }).click();
  await expect(page).toHaveURL(new RegExp(`/threads/${ids[0]}$`));
  await expect(page.getByTestId('thread-timeline')).toContainText('Response to: A useful result');
  await search.fill('nothing matches this search');
  await expect(sidebar(page)).toContainText(/No .*chats|No .*conversations/i);
  await search.fill('');
  await sidebar(page).getByRole('link', { name: 'New chat', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(input).toHaveText('Keep the home draft while changing views');
  await input.fill('A real first request from Basic');
  await page.getByTestId('thread-command-send').click();
  await expect(page).toHaveURL(/\/threads\/[^/]+$/);
  await expect(page.getByTestId('thread-timeline')).toContainText('Response to: A real first request from Basic');

  await resize(app, 800, 740);
  await expect(sidebar(page)).toBeVisible();
  await expect(input).toBeInViewport();
  await expect(advanced(page)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await captureTrialScreenshot(app, testInfo.outputPath('basic-native-narrow.png'));

  // Electron desktop keeps its sidebar at narrow widths; the mobile drawer
  // belongs to the separate browser/native-mobile surface contract.
  await resize(app, 640, 740);
  await expect(sidebar(page)).toBeVisible();
  await expect(sidebar(page).getByRole('searchbox', { name: 'Search chats' })).toBeInViewport();
  await sidebar(page).getByRole('searchbox', { name: 'Search chats' }).fill('Weekly update to find');
  await sidebar(page).getByRole('link', { name: /Weekly update to find/ }).click();
  await expect(page).toHaveURL(new RegExp(`/threads/${ids[0]}$`));
  await expect(sidebar(page)).toBeVisible();
  await expect(input).toBeInViewport();
  await input.fill('A narrow desktop draft');
  await expect(input).toHaveText('A narrow desktop draft');
  await expect(advanced(page)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await captureTrialScreenshot(app, testInfo.outputPath('basic-native-desktop-640.png'));

  // Check the shell's platform-reserve contract without changing the native
  // window or pretending this macOS run validates Windows caption rendering.
  const shell = page.locator('.app-shell');
  await shell.evaluate(node => {
    const element = node as HTMLElement;
    element.style.setProperty('--shell-leading-reserve', '184px');
    element.style.setProperty('--windows-caption-reserve', '142px');
  });
  await expect.poll(() => page.locator('.basic-ui-shell-heading').evaluate(node => node.getBoundingClientRect().left)).toBeGreaterThanOrEqual(184);
  await expect.poll(() => page.getByRole('group', { name: 'Interface view' }).evaluate(node => innerWidth - node.getBoundingClientRect().right)).toBeGreaterThanOrEqual(142);
  await shell.evaluate(node => {
    const element = node as HTMLElement;
    element.style.removeProperty('--shell-leading-reserve');
    element.style.removeProperty('--windows-caption-reserve');
  });

  // Query opt-in initializes the window. The same query on reload honors
  // the user's later choice saved in this window's session storage.
  await navigate(page, '/?ui=basic');
  await page.reload();
  await expect(basic(page)).toHaveAttribute('aria-pressed', 'true');
  await advanced(page).click();
  await page.reload();
  await expect(advanced(page)).toHaveAttribute('aria-pressed', 'true');
});

test('switching preserves a live turn, pending decision, input and image without sending or stopping', async ({ app }) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  const { ids: [threadId] } = await projectAndThreads(app, ['Live work requiring a decision'], 'delay:60000 Keep the turn alive');
  const auth = JSON.parse(readFileSync(join(app.home, '.zcc', 'auth.json'), 'utf8'));
  const hostRequest = async (path: string, body: unknown) => {
    const response = await fetch(new URL(`/internal/hosts/${path}`, page.url()), {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-zcc-host-id': auth.hostId, authorization: `Bearer ${auth.hostKey}` },
      body: JSON.stringify(body)
    });
    expect(response.ok).toBe(true);
    const result = await response.json();
    expect(result.outcome).not.toBe('rejected');
    return result;
  };
  const pending = await hostRequest('interactive-request', {
    sessionId: threadId,
    interaction: {
      threadId, turnId: 'basic-turn', providerId: 'fake', providerThreadId: 'basic-provider', providerRequestId: 'basic-request',
      payload: {
        kind: 'approval', reason: 'Review the exact command before continuing',
        availableDecisions: ['allow_once', 'deny'],
        subject: { kind: 'command', itemId: 'basic-command', command: 'printf BASIC_REVIEW', cwd: '/tmp/basic-review', actions: [], sessionGrant: null }
      }
    }
  });
  await navigate(page, `/threads/${threadId}`);
  const detail = page.getByTestId('thread-detail');
  const input = detail.getByTestId('thread-command-input');
  await input.fill('An unsent follow-up with an attached image');
  await pasteImage(page);
  const banner = page.getByTestId('thread-pending-banner');
  await expect(banner).toBeVisible();
  await expect(banner.getByLabel('Command', { exact: true })).toContainText('printf BASIC_REVIEW');
  const stop = page.getByRole('button', { name: 'Stop', exact: true });
  await expect(stop).toBeVisible();
  const mutations: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new RegExp(`/threads/${threadId}/(send|stop)$`).test(new URL(request.url()).pathname)) mutations.push(request.url());
  });
  await input.evaluate(node => { node.setAttribute('data-basic-continuity', 'kept'); });
  for (const mode of ['basic', 'advanced', 'basic'] as const) {
    const toggle = mode === 'basic' ? basic(page) : advanced(page);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(new RegExp(`/threads/${threadId}$`));
    await expect(input).toHaveText('An unsent follow-up with an attached image');
    await expect(input).toHaveAttribute('data-basic-continuity', 'kept');
    await expect(page.getByLabel('Attached images')).toBeVisible();
    await expect(banner).toBeVisible();
    await expect(stop).toBeVisible();
    await expect(detail.getByTestId('thread-command-input')).toHaveCount(1);
  }
  expect(mutations).toEqual([]);
  let decision: unknown;
  await page.route(`**/api/v1/threads/${threadId}/interactions/${pending.interactionId}/resolve`, async route => {
    decision = route.request().postDataJSON();
    await hostRequest('interactive-request/interrupt', { sessionId: threadId, providerId: 'fake', threadIds: [threadId], reason: 'Fixture decision received' });
    await route.fulfill({ json: {} });
  });
  await banner.getByTestId('thread-pending-decision-deny').click();
  await expect.poll(() => decision).toEqual({ decision: 'deny' });
  await expect(banner).toHaveCount(0);
  const stopped = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/threads/${threadId}/stop`));
  await stop.click();
  expect((await stopped).ok()).toBe(true);
  await expect(stop).toHaveCount(0);
  await expect(input).toHaveText('An unsent follow-up with an attached image');
  await expect(page.getByLabel('Attached images')).toBeVisible();
  expect(mutations).toHaveLength(1);
});

test('file previews and a real native browser keep their tabs and page state across views', async ({ app }, testInfo) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await resize(app, 1440, 900);
  const { ids: [threadId], path } = await projectAndThreads(app, ['Keep my open result']);
  await navigate(page, `/threads/${threadId}`);
  await basic(page).click();
  await page.evaluate(async ({ threadId, path }) => {
    const response = await fetch(`/api/v1/threads/${threadId}/open`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: { source: 'workspace', path } })
    });
    if (!response.ok) throw new Error(await response.text());
  }, { threadId, path: join(path, 'result.html') });
  const panel = page.getByTestId('thread-secondary-panel');
  const frame = panel.frameLocator('[data-testid="thread-file-preview-html"]');
  await expect(frame.getByRole('heading', { name: 'A result worth keeping' })).toBeVisible();
  await frame.locator('#notes').fill('Preserve the review in the preview');
  for (const toggle of [advanced(page), basic(page)]) {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(panel).toBeVisible();
    await expect(frame.locator('#notes')).toHaveValue('Preserve the review in the preview');
  }
  await captureTrialScreenshot(app, testInfo.outputPath('basic-native-result.png'));

  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><html><title>Basic browser continuity</title><body><h1>A living page</h1><input id="notes"><script>window.basicMarker=Math.random()</script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local fixture port');
  const url = `http://127.0.0.1:${address.port}/`;
  const native = await app.electron.browserWindow(page);
  const browserState = () => native.evaluate(async (win, url) => {
    const view = win.contentView.children.find((child: Electron.View) => 'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === url) as Electron.WebContentsView | undefined;
    return view ? { visible: view.getVisible(), id: view.webContents.id, marker: await view.webContents.executeJavaScript('window.basicMarker'), notes: await view.webContents.executeJavaScript('document.getElementById("notes").value') } : null;
  }, url);
  try {
    // Browser creation stays in Advanced. A contextual browser already open
    // beside this chat remains usable in Basic through the same native host.
    await advanced(page).click();
    await openThreadToolLauncher(page);
    await page.getByTestId('thread-new-tab-browser').click();
    const browserAddress = panel.getByTestId('thread-browser-address');
    await browserAddress.fill(url);
    await browserAddress.press('Enter');
    await expect.poll(async () => (await browserState())?.visible).toBe(true);
    const before = (await browserState())!;
    await native.evaluate(async (win, url) => {
      const view = win.contentView.children.find((child: Electron.View) => 'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === url) as Electron.WebContentsView;
      await view.webContents.executeJavaScript('document.getElementById("notes").value="Keep this native page alive"');
    }, url);
    for (const toggle of [basic(page), advanced(page), basic(page)]) {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(async () => (await browserState())?.visible).toBe(true);
      expect(await browserState()).toMatchObject({ id: before.id, marker: before.marker, notes: 'Keep this native page alive' });
      await expect(panel.getByRole('button', { name: 'Basic browser continuity', exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    await captureTrialScreenshot(app, testInfo.outputPath('basic-native-browser.png'));
    await panel.getByRole('button', { name: 'result.html', exact: true }).click();
    await expect(frame.getByRole('heading', { name: 'A result worth keeping' })).toBeVisible();

    // A hidden Advanced bottom dock keeps its browser alive without letting
    // native web content float above Basic or its unavailable-feature card.
    await advanced(page).click();
    await page.evaluate(() => window.cc.config.set({ dockableThreadToolsEnabled: true }));
    await panel.getByRole('button', { name: 'Basic browser continuity', exact: true }).click();
    await panel.getByRole('button', { name: 'Right panel actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Move Basic browser continuity to bottom panel', exact: true }).click();
    const bottom = page.getByTestId('thread-bottom-panel');
    await expect(bottom).toBeVisible();
    await expect.poll(async () => (await browserState())?.visible).toBe(true);
    await basic(page).click();
    await expect(bottom).toBeHidden();
    await expect.poll(async () => (await browserState())?.visible).toBe(false);
    expect(await browserState()).toMatchObject({ id: before.id, marker: before.marker, notes: 'Keep this native page alive' });
    await navigate(page, '/scheduler');
    await expect(page.getByTestId('basic-ui-unsupported')).toBeVisible();
    await expect.poll(async () => (await browserState())?.visible).toBe(false);
    await advanced(page).click();
    await navigate(page, `/threads/${threadId}`);
    await expect(bottom).toBeVisible();
    await expect.poll(async () => (await browserState())?.visible).toBe(true);
    expect(await browserState()).toMatchObject({ id: before.id, marker: before.marker, notes: 'Keep this native page alive' });
    await captureTrialScreenshot(app, testInfo.outputPath('advanced-native-browser-restored.png'));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('entering Basic opens New chat from a workspace page and keeps an open thread', async ({ app }) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  const { ids } = await projectAndThreads(app, ['Conversation to keep']);
  await navigate(page, '/scheduler');
  await basic(page).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('thread-command-input')).toBeVisible();
  await expect(page.getByTestId('basic-ui-unsupported')).toHaveCount(0);

  await advanced(page).click();
  await navigate(page, `/threads/${ids[0]}`);
  const input = page.getByTestId('thread-command-input');
  await input.fill('Keep this unsent reply');
  await basic(page).click();
  await expect(page).toHaveURL(new RegExp(`/threads/${ids[0]}$`));
  await expect(input).toHaveText('Keep this unsent reply');
});

test('Basic hands unsupported routes and an existing CLI launch draft back to Advanced', async ({ app }) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await navigate(page, '/');
  const modes = page.getByRole('group', { name: 'Launch mode' });
  await modes.getByRole('button', { name: 'CLI Agent', exact: true }).click();
  const input = page.getByTestId('legacy-agent-command-input');
  await input.fill('Keep the saved CLI launch draft');
  const launches: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/v1\/(threads|cli-agents|terminals)$/.test(new URL(request.url()).pathname)) launches.push(request.url());
  });
  await basic(page).click();
  await expect(page.getByRole('button', { name: 'Continue in Advanced', exact: true })).toBeVisible();
  await expect(page.getByTestId('thread-command-send')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue in Advanced', exact: true }).click();
  await expect(advanced(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(input).toHaveText('Keep the saved CLI launch draft');
  expect(launches).toEqual([]);

  await basic(page).click();
  await navigate(page, '/scheduler');
  await expect(page.getByTestId('basic-ui-unsupported')).toBeVisible();
  await resize(app, 640, 740);
  await expect(page.getByRole('button', { name: 'Open in Advanced', exact: true })).toBeInViewport();
  await expect(sidebar(page).getByRole('searchbox', { name: 'Search chats' })).toBeInViewport();
  await page.getByRole('button', { name: 'Open in Advanced', exact: true }).click();
  await expect(page).toHaveURL(/\/scheduler$/);
  await expect(advanced(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('basic-ui-unsupported')).toHaveCount(0);
  await navigate(page, '/');
  await expect(input).toHaveText('Keep the saved CLI launch draft');
  expect(launches).toEqual([]);

  await resize(app, 1440, 900);
  const { projectId } = await projectAndThreads(app, []);
  await navigate(page, `/projects/${projectId}/threads/new`);
  const draft = page.getByTestId('new-thread-view');
  await draft.getByRole('group', { name: 'Launch mode' }).getByRole('button', { name: 'Modern', exact: true }).click();
  const projectInput = draft.getByTestId('thread-command-input');
  await projectInput.fill('Keep this project-specific new chat draft');
  await projectInput.evaluate(node => node.setAttribute('data-basic-project-draft', 'kept'));
  await page.getByTestId('thread-secondary-show').click();
  const draftPanel = page.getByTestId('new-chat-panel-layout').getByTestId('thread-secondary-panel');
  const toolSearch = draftPanel.getByRole('searchbox', { name: 'Search tools and files' });
  await toolSearch.fill('result.html');
  await basic(page).click();
  await expect(basic(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(projectInput).toBeVisible();
  await expect(projectInput).toHaveText('Keep this project-specific new chat draft');
  await expect(projectInput).toHaveAttribute('data-basic-project-draft', 'kept');
  await expect(draft.getByRole('group', { name: 'Launch mode' })).toHaveCount(0);
  await expect(draft.locator('.basic-new-thread-actions')).toBeHidden();
  await expect(draftPanel.getByRole('heading', { name: 'Available in Advanced' })).toBeVisible();
  await expect(toolSearch).toBeHidden();
  await expect(draftPanel.getByTestId('thread-secondary-new-tab')).toHaveCount(0);
  await advanced(page).click();
  await expect(advanced(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(projectInput).toHaveText('Keep this project-specific new chat draft');
  await expect(projectInput).toHaveAttribute('data-basic-project-draft', 'kept');
  await expect(toolSearch).toBeVisible();
  await expect(toolSearch).toHaveValue('result.html');
  expect(launches).toEqual([]);
});

test('Basic reuses the merged composer and keeps drafts and attachments usable at narrow widths', async ({ app }, testInfo) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await resize(app, 1440, 900);
  await projectAndThreads(app, []);
  await navigate(page, '/');
  const input = page.getByTestId('thread-command-input');
  const card = page.locator('.thread-command-card');
  const send = page.getByTestId('thread-command-send');
  const attach = page.getByRole('button', { name: 'Attach files', exact: true });
  const expand = page.getByTestId('thread-command-expand');
  await expect(input).toBeVisible();
  const advancedHeight = (await card.boundingBox())!.height;
  await basic(page).click();
  await expect(basic(page)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await card.boundingBox())!.height).toBe(advancedHeight);
  await expect(page.getByTestId('composer-settings-pill')).toBeVisible();
  expect((await input.boundingBox())!.y).toBeLessThan((await attach.boundingBox())!.y);
  expect((await input.boundingBox())!.y).toBeLessThan((await send.boundingBox())!.y + (await send.boundingBox())!.height);
  await captureTrialScreenshot(app, testInfo.outputPath('basic-light-composer-home.png'));

  await input.fill('A draft that can grow\nSecond line\nThird line\nFourth line');
  await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(90);
  await expect(send).toBeEnabled();
  await expand.click();
  await expect(expand).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(150);
  await expand.click();
  await input.fill('Keep the shared editor and attachment');
  await input.evaluate(node => node.setAttribute('data-light-composer-owner', 'retained'));
  await pasteImage(page);
  const image = page.getByLabel('Attached images');
  expect((await image.boundingBox())!.y + (await image.boundingBox())!.height).toBeLessThanOrEqual((await input.boundingBox())!.y);
  await captureTrialScreenshot(app, testInfo.outputPath('basic-light-composer-attachment.png'));
  await advanced(page).click();
  await expect(input).toHaveAttribute('data-light-composer-owner', 'retained');
  await expect(image).toBeVisible();
  await basic(page).click();
  await expect(input).toHaveAttribute('data-light-composer-owner', 'retained');
  await expect(image).toBeVisible();
  // Use the editor's deletion transaction; an empty fill can bypass it on Linux.
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  await expect(input).toHaveText('');
  await expect(send).toBeEnabled();
  await page.getByRole('button', { name: 'Remove keep-this.png', exact: true }).click();
  await expect(image).toHaveCount(0);
  await send.click();
  await expect(page.getByTestId('thread-command-error')).toHaveText('Enter a message first');

  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await resize(app, 640, 700);
  // Exercise a card narrower than the viewport, as when a result sits beside chat.
  await page.locator('.home-agent-composer').evaluate(node => { (node as HTMLElement).style.maxWidth = '360px'; });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await input.fill('A narrow draft');
  await expect.poll(async () => (await send.boundingBox())!.y - (await input.boundingBox())!.y).toBeGreaterThanOrEqual(24);
  const bounds = await card.boundingBox();
  for (const action of [attach, expand, send, input]) {
    const box = (await action.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds!.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  }
  for (const setting of [page.getByTestId('model-reasoning-picker-trigger'), page.getByTestId('composer-settings-pill')]) {
    await expect(setting).toBeVisible();
    const box = (await setting.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds!.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  }
  expect(Math.abs((await page.getByTestId('model-reasoning-picker-trigger').boundingBox())!.y - (await page.getByTestId('composer-settings-pill').boundingBox())!.y)).toBeLessThan(2);
  await page.getByTestId('composer-settings-pill').click();
  await expect(page.getByTestId('composer-settings-menu')).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(input).toBeInViewport();
  await expect(send).toBeInViewport();
  await captureTrialScreenshot(app, testInfo.outputPath('basic-light-composer-dark-narrow.png'));
});

test('Basic composer keeps a simple project context and restores Advanced controls without losing the draft', async ({ app }, testInfo) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await resize(app, 1440, 900);
  const { projectId } = await projectAndThreads(app, []);
  await navigate(page, '/');
  const input = page.getByTestId('thread-command-input');
  await input.fill('A simple Basic chat with the right project');
  await input.evaluate(node => node.setAttribute('data-composer-owner', 'retained'));
  const creates: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/threads') creates.push(request.url());
  });
  await basic(page).click();
  await expect(sidebar(page).locator('.zana-brand-icon')).toHaveCount(0);
  const newChatBox = (await sidebar(page).getByRole('link', { name: 'New chat' }).boundingBox())!;
  const sidebarBox = (await sidebar(page).boundingBox())!;
  expect(newChatBox.y - sidebarBox.y).toBeLessThanOrEqual(16);
  const model = page.getByTestId('model-reasoning-picker-trigger');
  await model.click();
  await page.getByTestId('model-reasoning-model-fake-model').click();
  const thinking = page.getByTestId('composer-settings-pill');
  await pickComposerSetting(page, page, 'reasoning', 'Low');
  await expect(thinking).toContainText('Low');
  for (const toggle of [basic(page), advanced(page), basic(page)]) {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(input).toHaveText('A simple Basic chat with the right project');
    await expect(input).toHaveAttribute('data-composer-owner', 'retained');
    if (await basic(page).getAttribute('aria-pressed') === 'true') {
      await expect(page.getByRole('button', { name: 'Create plugin', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Machine and project', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toHaveCount(0);
      await expect(page.getByText('Global thread default', { exact: true })).toBeHidden();
      await expect(page.getByRole('button', { name: 'Project', exact: true })).toBeVisible();
      await expect(model).toContainText('Fake');
      await expect(thinking).toContainText('Low');
    } else {
      await expect(page.getByRole('button', { name: 'Create plugin', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Machine and project', exact: true })).toBeVisible();
      await expectComposerSetting(page, page, 'reasoning', 'Low');
    }
  }
  expect(creates).toEqual([]);
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('option', { name: 'Basic UI project', exact: true }).click();
  const create = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/threads');
  await captureTrialScreenshot(app, testInfo.outputPath('basic-polished-new-chat.png'));
  await page.getByTestId('thread-command-send').click();
  expect((await create).postDataJSON()).toMatchObject({ projectId, model: 'fake-model', reasoningLevel: 'low' });
  await expect(page).toHaveURL(/\/threads\/[^/]+$/);
  await expect(page.getByTestId('thread-timeline')).toContainText('Response to: A simple Basic chat with the right project');
  await expect(page.getByRole('button', { name: 'Thread location — start a new thread elsewhere', exact: true })).toHaveCount(0);
  await expect(thinking).toContainText('Low');
  await pickComposerSetting(page, page, 'reasoning', 'High');
  await input.fill('Use more thinking on this follow-up');
  const followUp = page.waitForRequest(request => request.method() === 'POST' && /\/api\/v1\/threads\/[^/]+\/send$/.test(new URL(request.url()).pathname));
  await page.getByTestId('thread-command-send').click();
  expect((await followUp).postDataJSON()).toMatchObject({ model: 'fake-model', reasoningLevel: 'high' });
});

test('a narrow Basic preview has a clear return to chat and never overlaps the composer', async ({ app }, testInfo) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await resize(app, 1440, 900);
  const { ids: [threadId], path } = await projectAndThreads(app, ['A result on a smaller screen']);
  await navigate(page, `/threads/${threadId}`);
  await basic(page).click();
  const input = page.getByTestId('thread-command-input');
  await input.fill('Keep the follow-up while I read the result');
  await openResult(page, threadId, join(path, 'result.html'));
  const panel = page.getByTestId('thread-secondary-panel');
  const frame = panel.frameLocator('[data-testid="thread-file-preview-html"]');
  await frame.locator('#notes').fill('Keep these narrow-screen notes');
  await expect(panel.getByRole('button', { name: 'Code', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Copy path', exact: true })).toHaveCount(0);
  for (const width of [1052, 842, 640]) {
    await resize(app, width, 800);
    await expect(panel.getByRole('button', { name: 'Back to chat', exact: true })).toBeVisible();
    await expect(input).toBeHidden();
    await expect(frame.locator('#notes')).toHaveValue('Keep these narrow-screen notes');
    await expect.poll(() => panel.evaluate(element => {
      const owner = element.closest('.thread-detail-split');
      const preview = element.querySelector('[data-testid="thread-file-preview-html"]');
      if (!owner || !preview) return false;
      const available = owner.getBoundingClientRect().width;
      return Math.abs(element.getBoundingClientRect().width - available) <= 2
        && Math.abs(preview.getBoundingClientRect().width - available) <= 2;
    })).toBe(true);
    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width + 1);
    const visibleFrame = await panel.locator('[data-testid="thread-file-preview-html"]').evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) === element;
    });
    expect(visibleFrame).toBe(true);
    await captureTrialScreenshot(app, testInfo.outputPath(`basic-polished-result-${width}.png`));
    await panel.getByRole('button', { name: 'Back to chat', exact: true }).click();
    await expect(input).toBeVisible();
    await expect(input).toHaveText('Keep the follow-up while I read the result');
    await page.getByRole('button', { name: 'Show right panel', exact: true }).click();
    await expect(input).toBeHidden();
    await expect(frame.locator('#notes')).toHaveValue('Keep these narrow-screen notes');
  }
  await resize(app, 1440, 900);
  await expect(input).toBeVisible();
  await expect(frame.locator('#notes')).toBeVisible();
  await expect(input).toHaveText('Keep the follow-up while I read the result');
  await captureTrialScreenshot(app, testInfo.outputPath('basic-polished-wide-result.png'));
});

test('interactive HTML state survives hiding, conversation navigation and tab switches until explicitly closed', async ({ app }) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await resize(app, 1440, 900);
  const { ids: [threadId, otherThreadId], path } = await projectAndThreads(app, ['Keep the interactive page', 'A different conversation']);
  await navigate(page, `/threads/${threadId}`);
  await basic(page).click();
  await openResult(page, threadId, join(path, 'result.html'));
  const panel = page.getByTestId('thread-secondary-panel');
  const frame = panel.frameLocator('[data-testid="thread-file-preview-html"]');
  await expect(frame.locator('body')).toHaveAttribute('data-preview-session', /.+/);
  const initialMarker = await frame.locator('body').getAttribute('data-preview-session');
  // Explicitly opening an existing file refreshes it. That new revision must
  // survive subsequent route restoration instead of reverting to revision0.
  await openResult(page, threadId, join(path, 'result.html'));
  await expect(frame.locator('body')).not.toHaveAttribute('data-preview-session', initialMarker!);
  const marker = await frame.locator('body').getAttribute('data-preview-session');
  await frame.locator('#notes').fill('Unsaved input belongs to this live preview');
  const retained = async () => {
    await expect(frame.locator('#notes')).toHaveValue('Unsaved input belongs to this live preview');
    await expect(frame.locator('body')).toHaveAttribute('data-preview-session', marker!);
  };
  for (const toggle of [basic(page), advanced(page), basic(page)]) {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await panel.getByRole('button', { name: 'Hide right panel', exact: true }).click();
    await page.getByRole('button', { name: 'Show right panel', exact: true }).click();
    await retained();
  }
  await sidebar(page).getByRole('link', { name: /A different conversation/ }).click();
  await expect(page).toHaveURL(new RegExp(`/threads/${otherThreadId}$`));
  await expect(page.locator('[data-testid="thread-file-preview-html"]:visible')).toHaveCount(0);
  await sidebar(page).getByRole('link', { name: /Keep the interactive page/ }).click();
  await retained();
  await sidebar(page).getByRole('link', { name: 'New chat', exact: true }).click();
  await expect(page.locator('[data-testid="thread-file-preview-html"]:visible')).toHaveCount(0);
  await sidebar(page).getByRole('link', { name: /Keep the interactive page/ }).click();
  await retained();

  writeFileSync(join(path, 'another-result.html'), '<!doctype html><html><title>Another result</title><body><h1>A second live result</h1><input></body></html>');
  await openResult(page, threadId, join(path, 'another-result.html'));
  await expect(panel.frameLocator('[data-testid="thread-file-preview-html"]').getByRole('heading', { name: 'A second live result' })).toBeVisible();
  await panel.getByRole('button', { name: 'result.html', exact: true }).click();
  await retained();
  await panel.getByRole('button', { name: 'Close result.html', exact: true }).click();
  await openResult(page, threadId, join(path, 'result.html'));
  await expect(frame.locator('#notes')).toHaveValue('');
  await expect(frame.locator('body')).not.toHaveAttribute('data-preview-session', marker!);

  // Another window can close a tab while its owner is off-route. That must
  // dispose the parked live document rather than leave its scripts running.
  const retainedSrc = await panel.locator('[data-testid="thread-file-preview-html"]').getAttribute('src');
  await expect.poll(() => page.evaluate(async threadId => {
    const response = await fetch(`/api/v1/threads/${threadId}/tabs`);
    return (await response.json()).tabs.length;
  }, threadId)).toBe(2);
  await sidebar(page).getByRole('link', { name: /A different conversation/ }).click();
  await page.evaluate(async threadId => {
    const current = await (await fetch(`/api/v1/threads/${threadId}/tabs`)).json();
    const response = await fetch(`/api/v1/threads/${threadId}/tabs`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: current.revision, tabs: [] })
    });
    if (!response.ok) throw new Error(await response.text());
  }, threadId);
  await expect.poll(() => page.locator('[data-testid="thread-file-preview-html"]').evaluateAll(
    (frames, src) => frames.filter(frame => frame.getAttribute('src') === src).length,
    retainedSrc
  )).toBe(0);
});

test('Basic marks a conversation Unread when it replies while you are elsewhere, and clears it on open', async ({ app }, testInfo) => {
  const page = app.window;
  await dismissConsentOverlays(page);
  await resize(app, 1440, 900);
  const { ids } = await projectAndThreads(app, ['Draft the launch email', 'Review the roadmap']);
  await basic(page).click();
  const [first, second] = ids.map(id => sidebar(page).getByTestId(`basic-chat-row-${id}`));
  const firstUnread = sidebar(page).getByTestId(`basic-chat-unread-${ids[0]}`);
  await first.click();
  await expect(page.getByTestId('thread-timeline')).toContainText('Response to: A useful result');
  await expect(firstUnread).toHaveCount(0);
  await second.click();
  await expect(page).toHaveURL(new RegExp(`/threads/${ids[1]}$`));
  // The reply lands while another conversation is open, as a background turn would.
  await page.evaluate(async id => {
    const response = await fetch(`/api/v1/threads/${encodeURIComponent(id)}/send`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Add a call to action', mode: 'queue-if-active' })
    });
    if (!response.ok) throw new Error(await response.text());
  }, ids[0]);
  await expect(firstUnread).toHaveText('Unread');
  await expect(first).toHaveClass(/is-unread/);
  await expect(first).toHaveAttribute('aria-label', /, unread$/);
  await expect(first.locator('.basic-ui-chat-name')).toHaveCSS('font-weight', '650');
  await expect(sidebar(page).getByTestId(`basic-chat-unread-${ids[1]}`)).toHaveCount(0);
  await captureTrialScreenshot(app, testInfo.outputPath('basic-conversations-unread.png'));
  await first.click();
  await expect(page.getByTestId('thread-timeline')).toContainText('Response to: Add a call to action');
  await expect(firstUnread).toHaveCount(0);
  await second.click();
  await expect(firstUnread).toHaveCount(0);
});
