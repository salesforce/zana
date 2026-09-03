#!/usr/bin/env node
/**
 * Prepare shared local-dev env, then run persistent workspace `dev` tasks
 * through Turbo's TUI (`--ui tui`). Browser local-dev (`ZCC_SKIP_DESKTOP=1`)
 * starts Vite; the default path starts electron-vite.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** Keep in lockstep with `DEFAULT_DEV_SERVER_PORT` in apps/server/src/http/ports.ts. */
export const DEFAULT_DEV_SERVER_PORT = '8781';
/** Keep in lockstep with `DEFAULT_SERVER_PORT` in apps/server/src/http/ports.ts. */
export const DEFAULT_PACKAGED_SERVER_PORT = '8780';
/** Keep in lockstep with `ZCC_DEV_DATA_DIR_NAME` in apps/host-daemon/src/host-config.ts. */
export const DEFAULT_DEV_DATA_DIR_NAME = '.zcc-dev';
/** Keep in lockstep with `ZCC_DATA_DIR_NAME` in apps/host-daemon/src/host-config.ts. */
export const PACKAGED_DATA_DIR_NAME = '.zcc';

const PACKAGED_TARGET_FLAGS = new Set(['--packaged', '--installed', '--prod']);
const PACKAGED_TARGET_ENV = new Set(['packaged', 'installed', 'prod', 'production']);

function readExistingEnrollToken(dataDir) {
  try {
    const existing = readFileSync(join(dataDir, 'host-enroll.token'), 'utf8').trim();
    return existing.length >= 16 ? existing : null;
  } catch {
    return null;
  }
}

/**
 * Isolated `~/.zcc-dev` is the default so `pnpm dev` can sit beside the
 * installed app. `--packaged` / `pnpm dev:prod` / `ZCC_DEV_TARGET=packaged`
 * share `~/.zcc` instead. Do not pass `--prod` to `pnpm` itself (`pnpm dev --prod`
 * is pnpm's production-deps flag); use `pnpm dev:prod` or `pnpm dev -- --packaged`.
 */
export function parseDevTarget(argv = [], env = process.env) {
  const flags = argv.filter((arg) => arg !== '--');
  if (flags.some((arg) => PACKAGED_TARGET_FLAGS.has(arg))) return 'packaged';
  const raw = env.ZCC_DEV_TARGET?.trim().toLowerCase();
  if (raw && PACKAGED_TARGET_ENV.has(raw)) return 'packaged';
  return 'isolated';
}

export function prepareLocalDevEnv(processEnv = process.env, options = {}) {
  const target = options.target ?? parseDevTarget(options.argv ?? [], processEnv);
  const packaged = target === 'packaged';
  const isolatedDataDir = !processEnv.ZCC_DATA_DIR && !packaged;
  const isolatedPort = !processEnv.ZCC_SERVER_PORT && !packaged;
  const serverPort =
    processEnv.ZCC_SERVER_PORT ?? (packaged ? DEFAULT_PACKAGED_SERVER_PORT : DEFAULT_DEV_SERVER_PORT);
  const skipDesktop = processEnv.ZCC_SKIP_DESKTOP === '1';
  const home = processEnv.HOME?.trim() || homedir();
  const defaultDirName = packaged ? PACKAGED_DATA_DIR_NAME : DEFAULT_DEV_DATA_DIR_NAME;
  const dataDir = processEnv.ZCC_DATA_DIR ?? join(home, defaultDirName);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const enrollToken =
    (processEnv.ZCC_HOST_ENROLL_TOKEN && processEnv.ZCC_HOST_ENROLL_TOKEN.length >= 16
      ? processEnv.ZCC_HOST_ENROLL_TOKEN
      : null) ??
    readExistingEnrollToken(dataDir) ??
    randomBytes(32).toString('hex');
  writeFileSync(join(dataDir, 'host-enroll.token'), enrollToken, { encoding: 'utf8', mode: 0o600 });

  const env = {
    ...processEnv,
    ZCC_SERVER_PORT: serverPort,
    ZCC_DATA_DIR: dataDir,
    ZCC_HOST_ENROLL_TOKEN: enrollToken,
    ZCC_SERVER_URL: `http://127.0.0.1:${serverPort}/`
  };
  if (!processEnv.ZCC_EXTENSIONS_DIR) {
    env.ZCC_EXTENSIONS_DIR = join(dataDir, 'extensions');
  }

  return {
    skipDesktop,
    isolated: isolatedDataDir,
    isolatedPort,
    target,
    env
  };
}

export function formatDevTargetBanner(prepared) {
  const dataDir = prepared.env.ZCC_DATA_DIR;
  const port = prepared.env.ZCC_SERVER_PORT;
  if (prepared.target === 'packaged') {
    return `[zcc dev] using packaged ${dataDir} on :${port} — quit the installed Zana app first (pnpm dev for isolated ~/.zcc-dev)\n`;
  }
  if (prepared.isolated) {
    return `[zcc dev] isolated to ${dataDir} on :${port} (pnpm dev:prod to use ~/.zcc)\n`;
  }
  return null;
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
  const target = parseDevTarget(process.argv.slice(2), process.env);
  const prepared = prepareLocalDevEnv(process.env, { target, argv: process.argv.slice(2) });
  const banner = formatDevTargetBanner(prepared);
  if (banner) process.stderr.write(banner);
  const child = spawnDevTurbo({
    env: prepared.env,
    skipDesktop: prepared.skipDesktop,
    spawnImpl: spawn
  });
  attachDevProcessLifecycle(child);
}

if (isCliEntry(process.argv[1])) {
  runMain();
}
