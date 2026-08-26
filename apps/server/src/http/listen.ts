import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startProductServer } from './product-server.js';
import { attachProductPluginService } from './product-plugins.js';
import { DEFAULT_DEV_APP_PORT, serverPortFromEnv } from './ports.js';

const port = serverPortFromEnv();
const dataDir = process.env.ZCC_DATA_DIR ?? join(homedir(), '.zcc');
const appUrl = process.env.ZCC_DESKTOP_APP_URL ?? process.env.ELECTRON_RENDERER_URL;
const devAppPortRaw = process.env.ZCC_DEV_APP_PORT;
const devAppPort = devAppPortRaw && /^\d+$/.test(devAppPortRaw)
  ? Number(devAppPortRaw)
  : DEFAULT_DEV_APP_PORT;

mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const enrollToken = process.env.ZCC_HOST_ENROLL_TOKEN && process.env.ZCC_HOST_ENROLL_TOKEN.length >= 16
  ? process.env.ZCC_HOST_ENROLL_TOKEN
  : randomBytes(32).toString('hex');
writeFileSync(join(dataDir, 'host-enroll.token'), enrollToken, { encoding: 'utf8', mode: 0o600 });

const host = await startProductServer({
  host: '127.0.0.1',
  port,
  dataDir,
  enrollToken,
  origins: {
    serverPort: port,
    devAppPort,
    appUrl
  }
});
await attachProductPluginService(host.ctx);

process.stdout.write(`zcc-server listening on ${host.url}\n`);

const shutdown = () => {
  void host.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
