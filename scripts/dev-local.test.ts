import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_UI_PACKAGE,
  attachDevProcessLifecycle,
  createDevTurboCommand,
  DESKTOP_PACKAGE,
  HOST_DAEMON_PACKAGE,
  isCliEntry,
  prepareLocalDevEnv,
  SERVER_PACKAGE,
  spawnDevTurbo
} from './dev-local.mjs';

const repoRoot = dirname(fileURLToPath(new URL('.', import.meta.url)));
const tempDirs = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-dev-local-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('dev-local turbo TUI', () => {
  it('launches Turbo TUI for desktop, server, and host-daemon by default', () => {
    expect(createDevTurboCommand(false)).toEqual({
      command: 'pnpm',
      args: [
        'exec',
        'turbo',
        'run',
        'dev',
        `--filter=${DESKTOP_PACKAGE}`,
        `--filter=${SERVER_PACKAGE}`,
        `--filter=${HOST_DAEMON_PACKAGE}`,
        '--ui',
        'tui',
        '--concurrency',
        '20',
        '--no-update-notifier'
      ]
    });
  });

  it('swaps the UI package to Vite when desktop is skipped', () => {
    expect(createDevTurboCommand(true).args).toEqual(
      expect.arrayContaining([`--filter=${APP_UI_PACKAGE}`, '--ui', 'tui'])
    );
    expect(createDevTurboCommand(true).args).not.toContain(`--filter=${DESKTOP_PACKAGE}`);
  });

  it('writes a shared enroll token before Turbo children start', () => {
    const dataDir = join(makeTempDir(), 'zcc');
    mkdirSync(dataDir, { recursive: true });
    const prepared = prepareLocalDevEnv({
      ZCC_DATA_DIR: dataDir,
      ZCC_SERVER_PORT: '8781',
      ZCC_SKIP_DESKTOP: '1',
      PATH: '/usr/bin'
    });

    expect(prepared.skipDesktop).toBe(true);
    expect(prepared.env.ZCC_SERVER_PORT).toBe('8781');
    expect(prepared.env.ZCC_SERVER_URL).toBe('http://127.0.0.1:8781/');
    expect(prepared.env.ZCC_HOST_ENROLL_TOKEN.length).toBeGreaterThanOrEqual(16);
    expect(readFileSync(join(dataDir, 'host-enroll.token'), 'utf8')).toBe(
      prepared.env.ZCC_HOST_ENROLL_TOKEN
    );
  });

  it('reuses a caller-supplied enroll token', () => {
    const dataDir = join(makeTempDir(), 'zcc');
    mkdirSync(dataDir, { recursive: true });
    const token = 'a'.repeat(32);
    const prepared = prepareLocalDevEnv({
      ZCC_DATA_DIR: dataDir,
      ZCC_HOST_ENROLL_TOKEN: token
    });
    expect(prepared.env.ZCC_HOST_ENROLL_TOKEN).toBe(token);
    expect(prepared.skipDesktop).toBe(false);
  });

  it('mints a new enroll token when the provided value is too short', () => {
    const dataDir = join(makeTempDir(), 'zcc');
    mkdirSync(dataDir, { recursive: true });
    const prepared = prepareLocalDevEnv({
      ZCC_DATA_DIR: dataDir,
      ZCC_HOST_ENROLL_TOKEN: 'short'
    });
    expect(prepared.env.ZCC_HOST_ENROLL_TOKEN).not.toBe('short');
    expect(prepared.env.ZCC_HOST_ENROLL_TOKEN.length).toBeGreaterThanOrEqual(16);
  });

  it('keeps package `dev` scripts leaf commands so Turbo cannot recurse through root', () => {
    const app = JSON.parse(readFileSync(join(repoRoot, 'apps/app/package.json'), 'utf8'));
    const desktop = JSON.parse(readFileSync(join(repoRoot, 'apps/desktop/package.json'), 'utf8'));
    const server = JSON.parse(readFileSync(join(repoRoot, 'apps/server/package.json'), 'utf8'));
    const hostDaemon = JSON.parse(
      readFileSync(join(repoRoot, 'apps/host-daemon/package.json'), 'utf8')
    );
    const root = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    const turbo = JSON.parse(readFileSync(join(repoRoot, 'turbo.json'), 'utf8'));

    expect(app.scripts.dev).toBe('vite --config vite.dev.config.ts');
    expect(app.scripts.dev).not.toContain('run dev');
    expect(desktop.scripts.dev).toBe('pnpm --dir ../.. exec electron-vite dev');
    expect(desktop.scripts.dev).not.toContain('run predev');
    expect(server.scripts.dev).toBe(
      'pnpm --dir ../.. exec node --conditions=source --import tsx apps/server/src/http/listen.ts'
    );
    expect(hostDaemon.scripts.dev).toBe(
      'pnpm --dir ../.. exec node --conditions=source --import tsx apps/host-daemon/src/enroll-entry.ts'
    );
    expect(root.scripts.dev).toBe('node scripts/dev-local.mjs');
    expect(turbo.tasks.dev.persistent).toBe(true);
    expect(turbo.tasks.dev.passThroughEnv).toEqual(['*']);
  });

  it('spawns Turbo from the repo root with the prepared env', () => {
    const calls = [];
    spawnDevTurbo({
      env: { ZCC_SERVER_PORT: '8780' },
      skipDesktop: false,
      cwd: '/repo',
      spawnImpl: (command, args, options) => {
        calls.push({ command, args, options });
        return { pid: 1 };
      }
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('pnpm');
    expect(calls[0].args[1]).toBe('turbo');
    expect(calls[0].options.cwd).toBe('/repo');
    expect(calls[0].options.env.ZCC_SERVER_PORT).toBe('8780');
    expect(calls[0].options.stdio).toBe('inherit');
  });

  it('defaults Turbo cwd to the repo root', () => {
    const calls = [];
    spawnDevTurbo({
      env: {},
      skipDesktop: true,
      spawnImpl: (_command, _args, options) => {
        calls.push(options);
        return { pid: 1 };
      }
    });
    expect(calls[0].cwd).toBe(repoRoot);
  });

  it('forwards SIGINT to the Turbo child and maps child exit codes', () => {
    const listeners = { SIGINT: null, SIGTERM: null };
    const proc = {
      exitCode: 0,
      on: (event, handler) => {
        listeners[event] = handler;
      },
      exit: (code) => {
        proc.exitCode = code;
      }
    };
    let killed;
    const childListeners = {};
    const child = {
      pid: 42,
      kill: (signal) => {
        killed = signal;
      },
      on: (event, handler) => {
        childListeners[event] = handler;
      }
    };
    const shutdown = attachDevProcessLifecycle(child, proc);

    shutdown();
    expect(killed).toBe('SIGTERM');
    childListeners.exit(2, null);
    expect(proc.exitCode).toBe(2);
    childListeners.exit(null, 'SIGTERM');
    expect(proc.exitCode).toBe(1);
    expect(listeners.SIGINT).toBe(shutdown);
    expect(listeners.SIGTERM).toBe(shutdown);
  });

  it('does not kill a child without a pid', () => {
    const child = { kill: () => { throw new Error('should not kill'); }, on: () => {} };
    const shutdown = attachDevProcessLifecycle(child, { on: () => {} });
    expect(() => shutdown()).not.toThrow();
  });

  it('detects the CLI entrypoint', () => {
    const href = new URL('./dev-local.mjs', import.meta.url).href;
    expect(isCliEntry(fileURLToPath(href), href)).toBe(true);
    expect(isCliEntry(undefined, href)).toBe(false);
    expect(isCliEntry('/tmp/other.mjs', href)).toBe(false);
  });
});
