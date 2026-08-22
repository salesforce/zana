#!/usr/bin/env node
/**
 * Start the loopback product server, then either the standalone Vite app
 * (`ZCC_SKIP_DESKTOP=1`) or electron-vite (default). Browser local-dev also
 * starts an enrolled host-daemon.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const serverPort = process.env.ZCC_SERVER_PORT ?? '8780';
const skipDesktop = process.env.ZCC_SKIP_DESKTOP === '1';
const dataDir = process.env.ZCC_DATA_DIR ?? join(homedir(), '.zcc');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const enrollToken = process.env.ZCC_HOST_ENROLL_TOKEN && process.env.ZCC_HOST_ENROLL_TOKEN.length >= 16
  ? process.env.ZCC_HOST_ENROLL_TOKEN
  : randomBytes(32).toString('hex');
writeFileSync(join(dataDir, 'host-enroll.token'), enrollToken, { encoding: 'utf8', mode: 0o600 });

const env = {
  ...process.env,
  ZCC_SERVER_PORT: serverPort,
  ZCC_DATA_DIR: dataDir,
  ZCC_HOST_ENROLL_TOKEN: enrollToken,
  ZCC_SERVER_URL: `http://127.0.0.1:${serverPort}/`
};
const children = [];

function run(command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
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

run('pnpm', ['exec', 'tsx', 'apps/server/src/http/listen.ts']);

if (skipDesktop) {
  run('pnpm', ['exec', 'tsx', 'apps/host-daemon/src/enroll-entry.ts']);
  run('pnpm', ['exec', 'vite', '--config', 'apps/app/vite.dev.config.ts']);
} else {
  run('pnpm', ['exec', 'electron-vite', 'dev']);
}

const shutdown = () => {
  for (const child of children) {
    if (child.pid) child.kill('SIGTERM');
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
