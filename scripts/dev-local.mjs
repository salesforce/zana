#!/usr/bin/env node
/**
 * Prepare shared local-dev env, then run persistent workspace `dev` tasks
 * through Turbo's TUI (`--ui tui`). Browser local-dev (`ZCC_SKIP_DESKTOP=1`)
 * starts Vite; the default path starts electron-vite.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

export const SERVER_PACKAGE = '@zana-ai/zcc-server';
export const HOST_DAEMON_PACKAGE = '@zana-ai/zcc-host-daemon';
export const APP_UI_PACKAGE = '@zana-ai/zcc-app-ui';
export const DESKTOP_PACKAGE = '@zana-ai/zcc-desktop';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function createDevTurboCommand(skipDesktop) {
  const uiPackage = skipDesktop ? APP_UI_PACKAGE : DESKTOP_PACKAGE;
  return {
    command: 'pnpm',
    args: [
      'exec',
      'turbo',
      'run',
      'dev',
      `--filter=${uiPackage}`,
      `--filter=${SERVER_PACKAGE}`,
      `--filter=${HOST_DAEMON_PACKAGE}`,
      '--ui',
      'tui',
      '--concurrency',
      '20',
      '--no-update-notifier'
    ]
  };
}

export function prepareLocalDevEnv(processEnv = process.env) {
  const serverPort = processEnv.ZCC_SERVER_PORT ?? '8780';
  const skipDesktop = processEnv.ZCC_SKIP_DESKTOP === '1';
  const dataDir = processEnv.ZCC_DATA_DIR ?? join(homedir(), '.zcc');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const enrollToken =
    processEnv.ZCC_HOST_ENROLL_TOKEN && processEnv.ZCC_HOST_ENROLL_TOKEN.length >= 16
      ? processEnv.ZCC_HOST_ENROLL_TOKEN
      : randomBytes(32).toString('hex');
  writeFileSync(join(dataDir, 'host-enroll.token'), enrollToken, { encoding: 'utf8', mode: 0o600 });

  return {
    skipDesktop,
    env: {
      ...processEnv,
      ZCC_SERVER_PORT: serverPort,
      ZCC_DATA_DIR: dataDir,
      ZCC_HOST_ENROLL_TOKEN: enrollToken,
      ZCC_SERVER_URL: `http://127.0.0.1:${serverPort}/`
    }
  };
}

export function spawnDevTurbo(args) {
  const command = createDevTurboCommand(args.skipDesktop);
  return args.spawnImpl(command.command, command.args, {
    stdio: 'inherit',
    env: args.env,
    cwd: args.cwd ?? repoRoot,
    shell: process.platform === 'win32'
  });
}

export function attachDevProcessLifecycle(child, proc = process) {
  const shutdown = () => {
    if (child.pid) child.kill('SIGTERM');
  };
  proc.on('SIGINT', shutdown);
  proc.on('SIGTERM', shutdown);
  child.on('exit', (code, signal) => {
    if (signal) {
      proc.exitCode = 1;
      return;
    }
    proc.exit(code ?? 0);
  });
  return shutdown;
}

export function isCliEntry(argv1, moduleHref = import.meta.url) {
  return Boolean(argv1 && resolve(argv1) === fileURLToPath(moduleHref));
}

function runMain() {
  const { env, skipDesktop } = prepareLocalDevEnv();
  const child = spawnDevTurbo({ env, skipDesktop, spawnImpl: spawn });
  attachDevProcessLifecycle(child);
}

if (isCliEntry(process.argv[1])) {
  runMain();
}
