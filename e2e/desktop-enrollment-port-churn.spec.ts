import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { closeApp, launchApp, test, expect, type AppHandle } from './fixtures/app.js';

async function occupy(port = 0): Promise<Server> {
  const server = createServer((_request, response) => response.writeHead(418).end());
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
const portOf = (server: Server) => (server.address() as { port: number }).port;
const release = (server: Server) => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

test('desktop preserves enrollment across occupied ports, legacy migration, and daemon restart', async ({ home }) => {
  test.setTimeout(180_000);
  // A private preferred port exercises the production fallback without binding
  // or stopping anything on the user's real desktop ports.
  let blocker: Server | undefined = await occupy();
  let previousPortBlocker: Server | undefined;
  let app: AppHandle | undefined;
  const preferred = portOf(blocker);
  const authFile = join(home, '.zcc/auth.json');
  const auth = () => JSON.parse(readFileSync(authFile, 'utf8')) as { hostId: string; hostKey: string; serverUrl: string; desktopServerId?: string };
  const keyHash = () => createHash('sha256').update(auth().hostKey).digest('hex');
  const boot = async () => {
    app = await launchApp(home, { env: { ZCC_FAKE_PROVIDER: '1', ZCC_SERVER_PORT: String(preferred) } });
    await expect.poll(async () => app!.window.evaluate(async () => {
      const hosts = await (await fetch('/api/v1/hosts')).json() as Array<{ status: string }>;
      return hosts.some(host => host.status === 'connected');
    })).toBe(true);
    return Number(new URL(app.window.url()).port);
  };
  const shutdown = async () => { await closeApp(app!.electron); app = undefined; };
  try {
    const firstPort = await boot();
    expect(firstPort).not.toBe(preferred);
    const originalId = auth().hostId, originalHash = keyHash(), serverId = auth().desktopServerId;
    expect(serverId).toMatch(/^[a-f0-9-]{36}$/);
    await shutdown();

    // A 2.6.1 enrollment has no persistent server binding. Upgrade it while
    // forcing a second, distinct fallback port.
    const legacy = auth(); delete legacy.desktopServerId;
    writeFileSync(authFile, JSON.stringify(legacy), { mode: 0o600 });
    previousPortBlocker = await occupy(firstPort);
    const secondPort = await boot();
    expect(secondPort).not.toBe(firstPort); expect(secondPort).not.toBe(preferred);
    expect(auth().hostId).toBe(originalId); expect(keyHash()).toBe(originalHash); expect(auth().desktopServerId).toBe(serverId);
    await expect(app!.window.evaluate(() => (window as any).cc.hosts.relaunchLocal())).resolves.toEqual({ ok: true });
    expect(keyHash()).toBe(originalHash);
    await shutdown();

    await release(blocker); blocker = undefined;
    expect(await boot()).toBe(preferred);
    expect(auth().hostId).toBe(originalId); expect(keyHash()).toBe(originalHash); expect(auth().desktopServerId).toBe(serverId);
    expect(auth().serverUrl.replace(/\/$/, '')).toBe(`http://127.0.0.1:${preferred}`);
  } finally {
    if (app) await shutdown();
    if (blocker) await release(blocker);
    if (previousPortBlocker) await release(previousPortBlocker);
  }
});
