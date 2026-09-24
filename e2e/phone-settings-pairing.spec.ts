import { test, expect, launchApp } from './fixtures/app.js';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Production-boundary check for the Settings → Phone pairing surface (the
 * main-process mobile gateway is a live network listener, so the coupling note
 * requires an Electron E2E, not only mocked unit tests). Drives the real
 * `window.cc.mobile.*` IPC → `MobileGatewayManager` → `startMobileGateway`
 * chain: enable phone access, wait for the listener to bind, pair (renders a
 * real QR in the renderer), then revoke a seeded device.
 *
 * Seeds one paired device on disk (the store the gateway shares with the
 * `mobile:serve` CLI) so the revoke path has a row to remove — a phone only
 * appears here after it completes pairing, which a headless run can't do.
 */
test('Settings → Phone enables the gateway, renders a pairing QR, and revokes a device', async ({ home }) => {
  // Seed a paired device into the gateway's on-disk store (secrets are a valid
  // 64-hex hash so the store's schema check accepts the row).
  const mobileDir = join(home, '.zcc', 'mobile');
  mkdirSync(mobileDir, { recursive: true });
  writeFileSync(
    join(mobileDir, 'devices.json'),
    JSON.stringify([
      {
        id: 'seeded-phone-1',
        label: 'Seeded iPhone',
        hash: createHash('sha256').update('seed-credential').digest('hex'),
        createdAt: Date.now(),
        expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000
      }
    ])
  );

  const app = await launchApp(home);
  try {
    const win = app.window;
    await win.getByRole('link', { name: 'Settings', exact: true }).click();
    await win.getByTestId('settings-nav-phone').click();

    const panel = win.locator('.settings-panel--preferences');
    await expect(panel.getByRole('heading', { name: 'Phone', level: 1 })).toBeVisible();

    // Enable phone access → the config reactor starts the main-process gateway.
    await panel.getByRole('switch', { name: 'Enable phone access' }).click();
    await expect
      .poll(() => win.evaluate(() => window.cc.config.get()))
      .toMatchObject({ mobileGatewayEnabled: true });
    await expect
      .poll(() => win.evaluate(() => window.cc.mobile.status()), { timeout: 15_000 })
      .toMatchObject({ running: true });

    // Pair → the renderer asks main for a fresh code and draws the QR.
    const pairBtn = panel.getByRole('button', { name: 'Show pairing QR' });
    await expect(pairBtn).toBeEnabled();
    await pairBtn.click();

    const qr = panel.getByTestId('pairing-qr');
    await expect(qr.getByAltText('Zana Mobile pairing QR code')).toBeVisible();
    await expect(qr.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    // The manual-entry fallback echoes the same short-lived pairing code.
    await expect(qr.getByText(/Code:/)).toBeVisible();
    await expect(qr.getByText(/zana:\/\/connect\?payload=/)).toBeVisible();

    // Revoke the seeded device.
    await expect(panel.getByText('Seeded iPhone')).toBeVisible();
    await panel.getByRole('button', { name: 'Revoke Seeded iPhone' }).click();
    await expect(panel.getByText('Seeded iPhone')).toHaveCount(0);
    await expect
      .poll(() => win.evaluate(() => window.cc.mobile.devices()))
      .toEqual([]);
  } finally {
    await app.electron.close();
  }
});
