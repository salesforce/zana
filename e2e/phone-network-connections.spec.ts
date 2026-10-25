import { test, expect, launchApp } from './fixtures/app.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { phonePortEnv } from './fixtures/phone-port.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test('Remote access offers only Zana Connect and keeps a retired Heroku relay setup offline', async ({ home }, testInfo) => {
  const token = randomBytes(32).toString('base64url');
  const saved = join(home, '.zcc/mobile/connection.json');
  mkdirSync(join(home, '.zcc/mobile'), { recursive: true });
  const legacy = JSON.stringify({ mode: 'relay', publicUrl: 'https://old-relay.example', relayToken: token });
  writeFileSync(saved, legacy);
  const app = await launchApp(home, { env: await phonePortEnv(), initialConfig: { mobileGatewayEnabled: true } });
  try {
    const win = app.window;
    // A saved relay connection loads as unconfigured, so phone access stays off
    // until the user signs in to Zana Connect; nothing leaks its old secret.
    await expect.poll(() => win.evaluate(() => window.cc.mobile.status())).toMatchObject({
      running: false, publicUrl: null, boundLan: false, connection: { mode: 'unconfigured', hasRelayToken: false }
    });
    expect(JSON.stringify(await win.evaluate(() => window.cc.mobile.status()))).not.toContain(token);
    expect(JSON.stringify(await win.evaluate(() => window.cc.config.get()))).not.toContain(token);
    expect(await win.evaluate(() => 'configure' in window.cc.mobile)).toBe(false);
    expect(readFileSync(saved, 'utf8')).toBe(legacy);
    await win.getByRole('link', { name: 'Remote access', exact: true }).click();
    await expect(win.getByLabel('Connection method')).toHaveCount(0);
    await expect(win.getByRole('button', { name: 'Show pairing QR' })).toHaveCount(0);
    await expect(win.getByRole('button', { name: 'Set up remote access' })).toBeVisible();
    await win.getByText('Have a connect code?', { exact: true }).click();
    await expect(win.getByRole('link', { name: 'Get a connect code' })).toBeVisible();
    await captureElectronScreenshot(app.electron, win, testInfo.outputPath('phone-connect-only.png'));
  } finally {
    await app.electron.close();
  }
});
