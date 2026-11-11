import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, tutorialDiscovery: true, launchEnv: { ZCC_E2E_HELP_VIDEOS_ORIGIN: 'http://127.0.0.1:9/' },
  initialConfig: { sponsorPromptDismissed: true, walkthroughCompleted: true, setupDismissed: true, lastSeenVersion: '2.6.0' } });

test.describe('after upgrade setup', () => {
  test.use({ initialConfig: { onboarding: undefined, sponsorPromptDismissed: true,
    walkthroughCompleted: true, setupDismissed: true, lastSeenVersion: '2.6.0' } });

  test('waits for onboarding, plays tutorials with hints off, and retires the invitation', async ({ app }, testInfo) => {
    const page = app.window;
    const hint = page.getByRole('region', { name: 'Discover video tutorials' });
    const setup = page.getByRole('dialog', { name: 'Set up Zana', exact: true });
    await expect(setup).toBeVisible();
    await expect(hint).toHaveCount(0);
    await page.evaluate(() => { localStorage.setItem('zcc.contextualHelp.enabled', '0'); window.dispatchEvent(new Event('zcc-prefs')); });
    await setup.getByRole('button', { name: 'Skip for now', exact: true }).click();
    await expect(hint).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('tutorial-discovery.png') });
    const help = page.getByTestId('titlebar-help-toggle');
    await expect(help).not.toHaveClass(/is-active/);
    await hint.getByRole('button', { name: 'Watch tutorials' }).click();
    const library = page.getByRole('dialog', { name: 'Video tutorials', exact: true });
    await expect(hint).toHaveCount(0);
    await expect(library).toBeVisible();
    const player = library.getByTestId('help-video-player');
    await expect.poll(() => player.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(.2);
    await library.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(help).toBeFocused();
    await page.reload();
    await expect(help).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('zcc.helpVideos.discoveryDismissed'))).toBe('1');
    await expect(hint).toHaveCount(0);
    await help.click();
    await expect(page.getByRole('dialog', { name: 'Help', exact: true })).toContainText('Video tutorials');
  });
});

test('dismisses without stealing focus and keeps tutorials in Help after reload', async ({ app }) => {
  const page = app.window;
  const help = page.getByTestId('titlebar-help-toggle');
  const hint = page.getByRole('region', { name: 'Discover video tutorials' });
  await expect(hint).toBeVisible();
  expect(await hint.evaluate(node => node.contains(document.activeElement))).toBe(false);
  const nativeWindow = await app.electron.browserWindow(page);
  await nativeWindow.evaluate(win => { win.focus(); win.webContents.focus(); });
  await hint.getByRole('button', { name: 'Not now' }).focus();
  await page.keyboard.press('Escape');
  await expect(hint).toHaveCount(0);
  await expect(help).toBeFocused();
  await page.reload();
  await expect(help).toBeVisible();
  await expect(hint).toHaveCount(0);
  await help.click();
  await page.getByRole('button', { name: 'All videos', exact: false }).click();
  await expect(page.getByTestId('help-video-library')).toBeVisible();
});
