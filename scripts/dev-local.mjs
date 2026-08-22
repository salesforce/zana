#!/usr/bin/env node
/**
 * Start the loopback product server, then either the standalone Vite app
 * (`ZCC_SKIP_DESKTOP=1`) or electron-vite (default).
 */
import { spawn } from 'node:child_process';

const serverPort = process.env.ZCC_SERVER_PORT ?? '8780';
const skipDesktop = process.env.ZCC_SKIP_DESKTOP === '1';
const env = { ...process.env, ZCC_SERVER_PORT: serverPort };
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
