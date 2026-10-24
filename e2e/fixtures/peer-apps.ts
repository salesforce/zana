import { _electron, expect, type ElectronApplication } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { closeApp, dismissConsentOverlays, type AppHandle } from './app.js';
import { isolatedClaudePath, writeAppConfig } from './app-config.js';
import { linuxCiElectronArgs, linuxCiElectronEnv } from './linux-electron-launch.js';
import { cleanupTmuxEnvironment, isolateTmuxEnvironment } from './tmux-isolation.js';
import { createSqliteDatabase } from '../../packages/db/src/sqlite.js';

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

export interface PeerLaunchOptions {
  /** Trusted extra CA for the server runtime and main (`NODE_EXTRA_CA_CERTS`), e.g. the Connect fixture certificate. */
  caCertPath?: string;
  env?: Record<string, string>;
  /** Merged into the first-launch config only; a relaunch keeps the app's own config. */
  initialConfig?: Record<string, unknown>;
  /** First launch only: runs once the app's HOME and config exist, before the app starts (e.g. seed an installed plugin). */
  prelaunch?(isolatedHome: string): void;
}

/** Peer app plus the name the fixture relaunches it under. */
export type PeerApp = AppHandle & { name: string };

/**
 * N independent built Electron apps, each with its own HOME, server, host daemon and test-only
 * peer storage key. Only the OS-key composition seam (and an opt-in test clock offset for the
 * server runtime) is replaced; built server/daemon/IPC stay real.
 */
export function createPeerApps(home: string) {
  const root = process.env.ZCC_E2E_APP_ROOT;
  if (!root || process.env.ZCC_E2E_EXECUTABLE_PATH) throw new Error('Multi-app peer E2E requires a private unpackaged build');
  const apps: PeerApp[] = [];
  const processes: ElectronApplication[] = [];
  const homes: string[] = [];
  const launchOptions = new Map<string, PeerLaunchOptions>();
  // A real install keeps its server port; a relaunch must too, or the local daemon enrollment belongs to "another server".
  const serverPorts = new Map<string, number>();

  async function launch(name: string, options: PeerLaunchOptions = {}): Promise<PeerApp> {
    const isolatedHome = join(home, name);
    const launcher = join(isolatedHome, 'launcher');
    const version = JSON.parse(readFileSync(join(root!, 'package.json'), 'utf8')).version;
    if (!launchOptions.has(name)) {
      homes.push(isolatedHome);
      launchOptions.set(name, options);
      mkdirSync(isolatedHome, { mode: 0o700 });
      writeAppConfig(isolatedHome, { sponsorPromptDismissed: true, ...options.initialConfig });
      options.prelaunch?.(isolatedHome);
      mkdirSync(launcher);
      writeFileSync(join(launcher, 'package.json'), JSON.stringify({ name: 'zana-command-center', version, type: 'module', main: 'main.mjs' }));
      // Server-runtime-only clock offset (ms) read from a file, so an invitation can age past its TTL without waiting.
      writeFileSync(join(launcher, 'clock-offset'), '0', { mode: 0o600 });
      writeFileSync(join(launcher, 'clock.cjs'), `if (!globalThis.__zccTestClock) { globalThis.__zccTestClock = true;
        const { readFileSync } = require('node:fs');
        const file = ${JSON.stringify(join(launcher, 'clock-offset'))};
        let offset = 0;
        const read = () => { try { offset = Number(readFileSync(file, 'utf8')) || 0; } catch {} };
        read(); setInterval(read, 200).unref();
        const now = Date.now; Date.now = () => now() + offset; }
      `, { mode: 0o600 });
      // The peer storage key is fixed per HOME so sealed peer state stays readable across a relaunch.
      // E2E skips the real Keychain (ZCC_E2E_HOME); the supervisor reads this hex key from the env and
      // feeds it through the same peerBootKey 'start'-message path production uses, so invitations work.
      writeFileSync(join(launcher, 'main.mjs'), `import { utilityProcess } from 'electron';
        // Main-process env so the runtime supervisor can read it; E2E-only, gated by ZCC_E2E_HOME there.
        process.env.ZCC_E2E_PEER_BOOT_KEY_HEX = ${JSON.stringify(randomBytes(32).toString('hex'))};
        const clock = ${JSON.stringify(join(launcher, 'clock.cjs'))};
        const fork = utilityProcess.fork.bind(utilityProcess);
        utilityProcess.fork = (entry, args, options) => {
          if (entry.endsWith('server-runtime.js')) options = { ...options, execArgv: [...(options?.execArgv ?? []), '--require', clock],
            env: { ...options?.env, NODE_OPTIONS: [options?.env?.NODE_OPTIONS, '--require', clock].filter(Boolean).join(' ') } };
          return fork(entry, args, options);
        };
        await import(${JSON.stringify(pathToFileURL(join(root!, 'out/main/index.js')).href)});
      `, { mode: 0o600 });
    }
    const opts = launchOptions.get(name)!;
    if (!serverPorts.has(name)) serverPorts.set(name, await unusedPort());
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: isolatedHome, USERPROFILE: isolatedHome,
      ZCC_E2E_HOME: isolatedHome, ZCC_DATA_DIR: join(isolatedHome, '.zcc'),
      ZCC_EXTENSIONS_DIR: join(isolatedHome, '.zcc', 'extensions'), ZCC_E2E_APP_VERSION: version,
      ZCC_SERVER_PORT: String(serverPorts.get(name)), PATH: isolatedClaudePath(process.env.PATH), ...linuxCiElectronEnv(),
      ...(opts.caCertPath ? { NODE_EXTRA_CA_CERTS: opts.caCertPath } : {}), ...opts.env };
    for (const key of ['ZCC_PEER_STORAGE_BOOT_KEY', 'ELECTRON_RENDERER_URL', 'ZCC_DESKTOP_APP_URL', 'ZCC_SERVER_URL',
      'ZCC_HOST_ENROLL_TOKEN', 'ZCC_SESSION_ID', 'ZCC_SESSION_TOKEN', 'ELECTRON_RUN_AS_NODE']) delete env[key];
    const launchEnv = Object.fromEntries(Object.entries(isolateTmuxEnvironment(isolatedHome, env))
      .filter((entry): entry is [string, string] => entry[1] !== undefined));
    const electron = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
      args: [...linuxCiElectronArgs(), '--use-mock-keychain', `--user-data-dir=${join(isolatedHome, 'electron-user-data')}`, launcher],
      env: launchEnv, timeout: 60_000 });
    processes.push(electron);
    await electron.firstWindow();
    await expect.poll(() => electron.windows().find(window => /^http:\/\/127\.0\.0\.1:\d+\//.test(window.url()))?.url(), { timeout: 30_000 }).toBeTruthy();
    const window = electron.windows().find(window => /^http:\/\/127\.0\.0\.1:\d+\//.test(window.url()))!;
    await window.waitForSelector('#root');
    await dismissConsentOverlays(window);
    const app: PeerApp = { electron, window, home: isolatedHome, name };
    apps.push(app);
    return app;
  }

  /** Close one app and relaunch it with the same HOME, storage key, server port and launch options. */
  async function restart(app: PeerApp): Promise<PeerApp> {
    await stopDaemons(app).catch(() => {});
    await closeApp(app.electron);
    processes.splice(processes.indexOf(app.electron), 1);
    apps.splice(apps.indexOf(app), 1);
    return launch(app.name);
  }

  /** Close one app for good (simulates a machine going away); dispose still removes its HOME. */
  async function close(app: PeerApp): Promise<void> {
    await stopDaemons(app).catch(() => {});
    await closeApp(app.electron);
    processes.splice(processes.indexOf(app.electron), 1);
    apps.splice(apps.indexOf(app), 1);
  }

  /** Shift the server runtime's `Date.now()` by `ms` (0 resets). Takes effect within ~200 ms. */
  function setClockOffset(app: PeerApp, ms: number): void {
    writeFileSync(join(app.home, 'launcher', 'clock-offset'), String(ms), { mode: 0o600 });
  }

  /** `local` runs a real installed host daemon enrolled to `owner`'s server. Returns the host id. */
  async function enroll(owner: AppHandle, local: AppHandle): Promise<string> {
    const issued = await owner.window.evaluate(async () => {
      const response = await fetch('/api/v1/hosts/join-codes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error(`Join code HTTP ${response.status}`);
      return response.json();
    });
    const machine = join(local.home, `enrollment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(machine);
    const archive = await fetch(new URL('/install/zcc-host.tgz', owner.window.url()), { signal: AbortSignal.timeout(10_000) });
    expect(archive.status).toBe(200);
    const artifact = join(machine, 'host.tgz');
    writeFileSync(artifact, Buffer.from(await archive.arrayBuffer()), { mode: 0o600 });
    execFileSync('tar', ['-xzf', artifact, '-C', machine], { timeout: 10_000, stdio: 'pipe' });
    const port = await unusedPort();
    const slot = `__peerDaemon_${issued.hostId.replaceAll('-', '')}`;
    await local.electron.evaluate((_electron, input) => {
      const { spawn } = process.getBuiltinModule('child_process');
      const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', HOME: input.home,
        ZCC_DATA_DIR: input.machine, ZCC_LOCAL_PEER_APP_DATA_DIR: `${input.home}/.zcc` };
      delete env.ZCC_PEER_STORAGE_BOOT_KEY;
      const child = spawn(process.execPath, [`${input.machine}/join.mjs`, 'join', '--join-code', input.joinCode,
        '--host-id', input.hostId, '--server-url', input.origin, '--host-daemon-port', String(input.port)],
      { cwd: input.machine, env, stdio: 'ignore' });
      const registry = ((globalThis as any).__peerDaemons ??= {}) as Record<string, any>;
      registry[input.slot] = child;
      child.once('error', () => {});
    }, { home: local.home, machine, port, slot, origin: new URL(owner.window.url()).origin, ...issued });
    await expect.poll(async () => {
      const exited = await local.electron.evaluate((_e, slot) => (globalThis as any).__peerDaemons[slot].exitCode, slot);
      if (exited !== null) throw new Error(`Installed daemon exited ${exited}`);
      return fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) })
        .then(response => response.json()).catch(() => null);
    }, { timeout: 30_000 }).toMatchObject({ connected: true, hostId: issued.hostId });
    return issued.hostId;
  }

  /** Kill every enrolled daemon spawned by `app` (simulates losing a link / machine). */
  async function stopDaemons(app: AppHandle): Promise<void> {
    await app.electron.evaluate(async () => {
      const registry = ((globalThis as any).__peerDaemons ?? {}) as Record<string, any>;
      await Promise.all(Object.values(registry).map(child => new Promise<void>(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGTERM');
      })));
    });
  }

  async function dispose(): Promise<void> {
    for (const electron of processes.slice().reverse()) {
      const app = apps.find(candidate => candidate.electron === electron);
      if (app) await stopDaemons(app).catch(() => {});
      await closeApp(electron);
    }
    for (const isolatedHome of homes) {
      await cleanupTmuxEnvironment(isolatedHome);
      rmSync(isolatedHome, { recursive: true, force: true });
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    for (const isolatedHome of homes) expect(existsSync(isolatedHome)).toBe(false);
  }

  return { launch, restart, close, setClockOffset, enroll, stopDaemons, dispose, apps };
}

/** Rows of the app's own `hosts` table: `execution` daemons vs `peer.forward` peer links. Read-only. */
export function hostCapabilities(app: AppHandle): { execution: number; forward: string[] } {
  const db = createSqliteDatabase(join(app.home, '.zcc', 'zcc.sqlite'), { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare('SELECT id, enrollment_capability AS capability FROM hosts WHERE destroyed_at IS NULL').all() as Array<{ id: string; capability: string }>;
    return { execution: rows.filter(row => row.capability === 'execution').length, forward: rows.filter(row => row.capability === 'peer.forward').map(row => row.id) };
  } finally { db.close(); }
}

/** Config for peer-pairing apps: keeps the mobile gateway out of the way. */
export const corePeerConfig = { mobileGatewayEnabled: false } as const;

/** Opens the core Settings → Peers hub in `app`. */
export async function openCorePeers(app: AppHandle) {
  const { window } = app;
  await window.evaluate(() => {
    window.history.pushState({}, '', '/settings/peers');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(window.getByRole('heading', { name: 'Peers', exact: true, level: 3 })).toBeVisible({ timeout: 30_000 });
  return { window };
}
