import { readEnrollToken, startEnrolledHostDaemon } from './enroll-runtime.js';
import { resolveZccDataDir } from './host-config.js';

const dataDir = resolveZccDataDir();
const serverUrl = process.env.ZCC_SERVER_URL ?? `http://127.0.0.1:${process.env.ZCC_SERVER_PORT ?? '8780'}/`;

async function waitForServer(url: string): Promise<void> {
  const health = new URL('/api/v1/health', url);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(health);
      if (response.ok) return;
    } catch {
      /* still booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`product server did not become ready at ${url}`);
}

const token = readEnrollToken(dataDir);
await waitForServer(serverUrl);
const daemon = await startEnrolledHostDaemon({ dataDir, serverUrl, token });
process.stdout.write(`zcc-host-daemon enrolled hostId=${daemon.hostId}\n`);

const shutdown = () => {
  void daemon.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
