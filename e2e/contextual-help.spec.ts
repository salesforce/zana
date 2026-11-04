import { createServer } from 'node:net';
import { chromium, webkit } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';

test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  isolateBundledCatalog: true,
  initialConfig: { sponsorPromptDismissed: true }
});

/** The title-bar "?" opens the Help menu; its first row switches page hints. */
async function switchHints(window: import('@playwright/test').Page) {
  await window.getByTestId('titlebar-help-toggle').click();
  await window.getByRole('switch', { name: /Page hints/ }).click();
  await window.keyboard.press('Escape');
}

test('global Help is saved, sits beside the star, and keeps New Chat drafts intact', async ({ app }, testInfo) => {
  const { window } = app;
  await window.getByTestId('nav-home').click();
  const help = window.getByTestId('titlebar-help-toggle');
  const guide = window.locator('.home-launcher-tips');
  const invitation = guide.getByRole('button', { name: /Need a few tips/ });
  await expect(help).toHaveClass(/is-active/);
  await expect(invitation).toBeVisible();
  await expect(guide.locator('[data-tip-id]')).toHaveCount(0);
  const helpBox = (await help.boundingBox())!;
  const starBox = (await window.locator('.titlebar-fav').boundingBox())!;
  expect(starBox.x - helpBox.x).toBeCloseTo(32, 1);
  await window.screenshot({ path: testInfo.outputPath('help-invitation.png') });

  await guide.getByRole('button', { name: 'Modern', exact: true }).click();
  const editor = guide.getByTestId('thread-command-input');
  await editor.fill('Keep this unsent draft');
  await editor.evaluate((node) => { node.setAttribute('data-draft-instance', 'original'); });
  await invitation.click();
  await guide.getByRole('button', { name: 'Tip: Modern', exact: true }).click();
  await expect(guide.getByRole('region')).toContainText('best UX');
  await expect(guide.getByRole('region')).toContainText('accessible via mobile');
  await expect.poll(() => guide.getByRole('region').evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
  await window.screenshot({ path: testInfo.outputPath('help-exploring.png') });
  await help.click();
  const hints = window.getByRole('switch', { name: /Page hints/ });
  await expect(hints).toBeFocused();
  await hints.click();
  await expect(hints).toHaveAttribute('aria-checked', 'false');
  await expect(help).not.toHaveClass(/is-active/);
  await expect(window.locator('[data-contextual-help-ui]')).toHaveCount(0);
  await window.keyboard.press('Escape');
  await expect(hints).toHaveCount(0);
  await expect(editor).toHaveText('Keep this unsent draft');
  await expect(editor).toHaveAttribute('data-draft-instance', 'original');
  await expect(help).toBeFocused();
  await window.screenshot({ path: testInfo.outputPath('help-off.png') });

  await window.getByTestId('nav-inbox').click();
  await window.getByTestId('nav-home').click();
  await expect(help).not.toHaveClass(/is-active/);
  await expect(invitation).toHaveCount(0);
  await window.reload();
  await expect(help).not.toHaveClass(/is-active/);
  await expect(invitation).toHaveCount(0);
  await switchHints(window);
  await expect(invitation).toBeVisible();
  await expect(guide.locator('[data-tip-id]')).toHaveCount(0);
  await invitation.click();
  await guide.getByRole('button', { name: 'Tip: Modern', exact: true }).click();
  await guide.getByRole('button', { name: /Done/ }).click();
  await expect(help).toHaveClass(/is-active/);
  await expect(invitation).toBeFocused();
  await expect(guide.getByRole('region')).toHaveCount(0);
  await invitation.click();
  await window.getByTestId('nav-inbox').click();
  await window.getByTestId('nav-home').click();
  await expect(invitation).toBeVisible();
  await expect(guide.locator('[data-tip-id]')).toHaveCount(0);
  await expect(help).toHaveClass(/is-active/);
});

for (const engine of [chromium, webkit]) {
test(`${engine.name()} mobile navigation exposes the same Help preference, saved on that browser`, async ({ app }, testInfo) => {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Missing gateway port');
  const port = address.port;
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  const serverUrl = `http://127.0.0.1:${port}`;
  const gateway = await startMobileGateway({ upstream: new URL(app.window.url()).origin, publicUrl: serverUrl, port });
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    context.setDefaultTimeout(15_000);
    const paired = await context.request.post(`${serverUrl}/_mobile/pair`, { data: { code: gateway.pair().code, label: 'Help phone' } });
    expect(paired.ok()).toBe(true);
    const credential = await paired.json() as { credential: string };
    const session = await context.request.post(`${serverUrl}/_mobile/session`, { headers: { authorization: `Bearer ${credential.credential}` } });
    expect(session.ok()).toBe(true);
    await context.addInitScript(() => localStorage.setItem('zcc.defaultLaunchMode', 'thread'));
    const page = await context.newPage();
    await page.goto(serverUrl + '/');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-mobile', 'true');
    const menu = page.getByTestId('sidebar-trigger-overlay').getByRole('button', { name: /^(Expand|Collapse) sidebar$/ });
    await menu.click();
    await expect(page.getByTestId('mobile-help-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.mobile-nav-close').click();
    await expect(page.getByRole('button', { name: 'Close navigation' })).toHaveCount(0);
    const guide = page.locator('.home-launcher-tips');
    const invite = guide.getByRole('button', { name: /Need a few tips/ });
    await expect(invite).toBeVisible();
    await expect(page.getByTestId('titlebar-help-toggle')).toBeHidden();
    const editor = guide.getByTestId('thread-command-input');
    await editor.fill('A mobile draft to keep');
    await invite.tap();
    await guide.getByRole('button', { name: 'Tip: Modern', exact: true }).tap();
    await expect(guide.getByRole('region')).toContainText('accessible via mobile');
    await menu.click();
    const help = page.getByTestId('mobile-help-toggle');
    await expect(help).toHaveAttribute('aria-pressed', 'true');
    const bounds = (await help.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath('mobile-help-menu.png') });
    await help.click();
    await expect(help).toHaveAttribute('aria-pressed', 'false');
    await page.locator('.mobile-nav-close').click();
    await expect(page.locator('[data-contextual-help-ui]')).toHaveCount(0);
    await expect(editor).toHaveText('A mobile draft to keep');
    await page.reload();
    await expect(invite).toHaveCount(0);
    await menu.click();
    await expect(help).toHaveAttribute('aria-pressed', 'false');
    await help.click();
    await page.locator('.mobile-nav-close').click();
    await expect(invite).toBeVisible();
    await expect(guide.locator('[data-tip-id]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('mobile-help-invitation.png') });
    // Each device/browser controls its own help; a phone opt-out doesn't alter desktop.
    await expect(app.window.getByTestId('titlebar-help-toggle')).toHaveClass(/is-active/);
  } finally {
    await browser.close();
    await gateway.close();
  }
});
}
