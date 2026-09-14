import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlError } from './errors.js';
import { ProductHttpClient, probeHealth } from './http.js';
import type { IsolatedLaunchOptions } from './types.js';
import type { ResolvedConnect } from './connect.js';

export interface IsolatedHandle {
  connect: ResolvedConnect;
  stop(): Promise<void>;
}

function waitForUrl(url: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    while (Date.now() < deadline) {
      if (await probeHealth(url, fetchImpl)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new ControlError('APP_NOT_RUNNING', `isolated stack did not become ready on ${url}`);
  })();
}

export async function launchIsolated(opts: IsolatedLaunchOptions): Promise<IsolatedHandle> {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const dataDir = opts.dataDir ?? join(tmpdir(), `zcc-isolated-${process.pid}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const serverPort = process.env.ZCC_SERVER_PORT ?? '18780';
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const enrollToken = randomBytes(32).toString('hex');
  writeFileSync(join(dataDir, 'host-enroll.token'), enrollToken, { encoding: 'utf8', mode: 0o600 });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ZCC_SERVER_PORT: String(serverPort),
    ZCC_DATA_DIR: dataDir,
    ZCC_HOST_ENROLL_TOKEN: enrollToken,
    ZCC_SERVER_URL: `${serverUrl}/`,
    ZCC_SKIP_DESKTOP: '1',
    ...(opts.fake !== false ? { ZCC_FAKE_PROVIDER: '1' } : {})
  };
  const children: ChildProcess[] = [];
  const run = (command: string, args: string[], stdio: 'inherit' | 'pipe' = 'inherit') => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio,
      shell: process.platform === 'win32'
    });
    children.push(child);
    return child;
  };

  run(process.execPath, ['--conditions=source', '--import', 'tsx', 'apps/server/src/http/listen.ts']);
  await waitForUrl(serverUrl, 40_000, fetchImpl);
  const daemon = run(
    process.execPath,
    ['--conditions=source', '--import', 'tsx', 'apps/host-daemon/src/enroll-entry.ts'],
    'pipe'
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('host-daemon did not enroll')), 40_000);
    const onData = (buf: Buffer) => {
      const text = String(buf);
      process.stdout.write(text);
      if (text.includes('enrolled')) {
        clearTimeout(timer);
        daemon.stdout?.off('data', onData);
        resolve();
      }
    };
    daemon.stdout?.on('data', onData);
    daemon.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`host-daemon exited before enroll (${code})`));
    });
  });

  const stop = async () => {
    for (const child of children) {
      if (child.pid) child.kill('SIGTERM');
    }
  };

  return {
    connect: {
      http: new ProductHttpClient(serverUrl, {
        fetchImpl,
        nowMs: opts.nowMs,
        sleep: opts.sleep
      }),
      serverUrl,
      dataDir,
      provider: opts.fake === false ? 'live' : 'fake',
      isolated: true
    },
    stop
  };
}
