import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import { test, expect } from './fixtures/app.js';

// A previously configured TestFlight link must not create a second setup path.
test.use({ launchEnv: { ZANA_MOBILE_TESTFLIGHT_URL: 'https://testflight.apple.com/join/Abcd1234' } });

test('old Mobile links lead to one Remote access setup', async ({ app }, testInfo) => {
  const win = app.window;
  await win.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(win.getByTestId('settings-nav-phone')).toHaveCount(0);
  await win.evaluate(() => {
    history.pushState({}, '', '/settings/phone');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(win).toHaveURL(/\/settings\/remote-access/);
  await expect(win.getByRole('heading', { name: 'Remote access', exact: true })).toBeVisible();
  await expect(win.getByRole('button', { name: 'Set up remote access' })).toBeVisible();
  await expect(win.getByRole('textbox', { name: 'Connect code', exact: true })).not.toBeVisible();
  await expect(win.getByRole('button', { name: 'Show pairing QR', exact: true })).toHaveCount(0);
  const panel = win.locator('.settings-panel--preferences');
  await expect(panel.getByText(/TestFlight|Coming soon|USB|Waiting for Zana to open/)).toHaveCount(0);
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('remote-access-unified-setup.png'));
  await win.getByText('Have a connect code?', { exact: true }).click();
  await expect(win.getByRole('link', { name: 'Get a connect code' })).toBeVisible();
  await expect(win.getByRole('textbox', { name: 'Connect code', exact: true })).toBeVisible();
  await expect(win.getByTestId('launch-modal')).toHaveCount(0);
});
