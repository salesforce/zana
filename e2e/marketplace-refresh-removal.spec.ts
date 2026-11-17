import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { MarketplacePage } from './fixtures/marketplace.js';

test('removing and re-adding a catalog discards the old in-flight refresh through Electron IPC', async ({ home }) => {
  const key = join(home, 'catalog.key');
  const cert = join(home, 'catalog.crt');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'
  ], { stdio: 'ignore' });
  const original = { schemaVersion: 1, name: 'race-catalog', displayName: 'Original catalog', plugins: [] };
  let index = original;
  let hold = false;
  let pending: ServerResponse | undefined;
  const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    if (req.url !== '/catalog.json') { res.writeHead(404).end(); return; }
    if (hold) { pending = res; return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(index));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const source = `https://127.0.0.1:${(server.address() as { port: number }).port}/catalog.json`;
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    app = await launchApp(home, { caCertPath: cert, env: { ZCC_OFFICIAL_MARKETPLACE_URL: 'off' } });
    const page = app.window;
    const market = new MarketplacePage(page);
    await market.open();
    const panel = await market.openCatalogSources();
    const add = async () => {
      await page.getByLabel('Marketplace catalog source').fill(source);
      await page.getByRole('button', { name: 'Add catalog', exact: true }).click();
    };
    await add();
    await expect(market.catalogNames()).toHaveText(['Original catalog']);
    hold = true;
    await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => Boolean(pending)).toBe(true);
    await panel.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(market.catalogNames()).toHaveCount(0);
    expect(await page.evaluate(() => window.cc.marketplaces.list())).toEqual([]);
    hold = false;
    index = { ...original, displayName: 'Replacement catalog' };
    await add();
    await expect(market.catalogNames()).toHaveText(['Replacement catalog']);
    const before = await page.evaluate(() => window.cc.marketplaces.list());
    // This button tracks the original request by source, even after re-adding.
    await expect(panel.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
    pending!.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(original));
    await expect(panel.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await expect(market.catalogNames()).toHaveText(['Replacement catalog']);
    expect(await page.evaluate(() => window.cc.marketplaces.list())).toEqual(before);
    const persisted = JSON.parse(readFileSync(join(home, '.zcc', 'plugins', 'marketplaces.json'), 'utf8'));
    expect(persisted.catalogs).toEqual([expect.objectContaining({ displayName: 'Replacement catalog', lastError: null })]);
    await page.reload();
    await expect(page.locator('.ext-market')).toBeVisible();
    await market.openCatalogSources();
    await expect(market.catalogNames()).toHaveText(['Replacement catalog']);
  } finally {
    pending?.destroy();
    if (app) await closeApp(app.electron);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
