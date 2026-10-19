import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { closeApp, launchApp, test, expect, type AppHandle } from './fixtures/app.js';

const FIRST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';

// Dev-attach (ELECTRON_RENDERER_URL, no supervisor): the launch guard must follow
// the daemon's host.id file without restarting the desktop.
test('dev-attach launch guard follows host.id rewrites and removal without restart', async ({ home }) => {
  test.setTimeout(120_000);
  const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<div id="root"><h1>Dev attach</h1></div>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const dataDir = join(home, '.zcc'); mkdirSync(dataDir, { recursive: true });
  const hostIdFile = join(dataDir, 'host.id');
  writeFileSync(hostIdFile, FIRST);
  let app: AppHandle | undefined;
  try {
    app = await launchApp(home, { env: { ELECTRON_RENDERER_URL: url, ZCC_SERVER_URL: url } });
    await expect(app.window.getByRole('heading', { name: 'Dev attach' })).toBeVisible();
    const launch = (hostId: string) => app!.window.evaluate(
      async hostId => (await (window as any).cc.terminals.create({ projectId: 'missing', hostId, profile: 'shell', cols: 80, rows: 24 }))?.code ?? 'OK', hostId);
    expect(await launch(FIRST)).not.toBe('HOST_UNSUPPORTED');
    expect(await launch(SECOND)).toBe('HOST_UNSUPPORTED');
    // Daemon rejoin rewrites host.id (different size/mtime): no desktop restart.
    writeFileSync(hostIdFile, SECOND + '\n');
    await expect.poll(() => launch(SECOND)).not.toBe('HOST_UNSUPPORTED');
    expect(await launch(FIRST)).toBe('HOST_UNSUPPORTED');
    // Removal: no persisted id, so an explicit machine is refused.
    rmSync(hostIdFile);
    await expect.poll(() => launch(SECOND)).toBe('HOST_UNSUPPORTED');
  } finally {
    if (app) await closeApp(app.electron);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
