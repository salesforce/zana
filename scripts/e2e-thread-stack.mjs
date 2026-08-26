#!/usr/bin/env node
/**
 * Isolated web stack for the thread create→send E2E: product server + enrolled
 * host-daemon with the fake provider + Vite. Not used by Electron specs.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const serverPort = process.env.ZCC_SERVER_PORT ?? '18780';
const appPort = process.env.ZCC_DEV_APP_PORT ?? '15173';
const dataDir = process.env.ZCC_DATA_DIR ?? join(tmpdir(), `zcc-thread-e2e-${process.pid}`);
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const enrollToken = process.env.ZCC_HOST_ENROLL_TOKEN && process.env.ZCC_HOST_ENROLL_TOKEN.length >= 16
  ? process.env.ZCC_HOST_ENROLL_TOKEN
  : randomBytes(32).toString('hex');
writeFileSync(join(dataDir, 'host-enroll.token'), enrollToken, { encoding: 'utf8', mode: 0o600 });

const env = {
  ...process.env,
  ZCC_SERVER_PORT: String(serverPort),
  ZCC_DEV_APP_PORT: String(appPort),
  ZCC_DATA_DIR: dataDir,
  ZCC_HOST_ENROLL_TOKEN: enrollToken,
  ZCC_SERVER_URL: `http://127.0.0.1:${serverPort}/`,
  ZCC_SKIP_DESKTOP: '1',
  ZCC_FAKE_PROVIDER: '1'
};
const children = [];

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: options.stdio ?? 'inherit',
    env,
    shell: process.platform === 'win32'
  });
  child.on('exit', (code, signal) => {
    if (signal) return;
    if (code && code !== 0) {
      for (const other of children) {
        if (other.pid && other.pid !== child.pid) other.kill('SIGTERM');
      }
      process.exit(code);
    }
  });
  children.push(child);
  return child;
}

async function waitForUrl(url, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* still booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`did not become ready on ${url}`);
}

function waitForEnroll(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('host-daemon did not enroll')), 40_000);
    const onData = (buf) => {
      const text = String(buf);
      process.stdout.write(text);
      if (text.includes('enrolled')) {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`host-daemon exited before enroll (${code})`));
    });
  });
}

run(process.execPath, ['--conditions=source', '--import', 'tsx', 'apps/server/src/http/listen.ts']);
await waitForUrl(`http://127.0.0.1:${serverPort}/api/v1/health`);
const daemon = run(process.execPath, ['--conditions=source', '--import', 'tsx', 'apps/host-daemon/src/enroll-entry.ts'], {
  stdio: ['ignore', 'pipe', 'inherit']
});
await waitForEnroll(daemon);
run('pnpm', ['exec', 'vite', '--config', 'apps/app/vite.dev.config.ts', '--port', String(appPort), '--strictPort']);
await waitForUrl(`http://127.0.0.1:${appPort}/`);

const shutdown = () => {
  for (const child of children) {
    if (child.pid) child.kill('SIGTERM');
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
