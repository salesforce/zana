import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { installRuntimeLog } from '@zana-ai/zcc-process-utils';
import { spawn } from 'node:child_process';
import { readConnectEnrollment } from './connect-access.js';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { assertEnrollmentSafe, startEnrolledHostDaemon, type EnrolledHostDaemon } from './enroll-runtime.js';
import { parseJoinArgv, type JoinCliOptions } from './join-argv.js';
import { startLocalStatusServer } from './local-status.js';
import { handleProtocolMismatch, confirmHostUpdate, rollbackHostUpdate } from './protocol-self-update.js';
import { restartInstalledHost } from './restart-installed-host.js';

export type { JoinCliOptions } from './join-argv.js';
export { parseJoinArgv } from './join-argv.js';

/** Service managers restart the stable entry; standalone installs replace themselves. */
export async function restartHostProcess(): Promise<void> {
  if (process.env.ZCC_HOST_SERVICE_MANAGED !== '1') {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'inherit', env: process.env });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  }
  process.exit(0);
}

export async function runJoin(options: JoinCliOptions, restart = restartHostProcess): Promise<{ close(): Promise<void> }> {
  if (!options.dataDir) throw new Error('ZCC_DATA_DIR is required for an isolated machine install');
  let connected = false;
  let closing = false;
  let closeTask: Promise<void> | undefined;
  let hostId = options.hostId ?? null;
  let daemon: EnrolledHostDaemon | null = null;
  let startup: Promise<EnrolledHostDaemon> | undefined;
  const controller = new AbortController();
  let updateTask: Promise<void> | null = null;
  const status = startLocalStatusServer(options.hostDaemonPort, () => ({
    hostId, serverUrl: options.serverUrl, connected,
    protocolVersion: HOST_RPC_PROTOCOL_VERSION, autoUpdate: options.autoUpdate
  }));
  function close(): Promise<void> {
    if (closeTask) return closeTask;
    closing = true;
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    connected = false;
    closeTask = (async () => {
      controller.abort();
      const started = daemon ?? await startup?.catch(() => null);
      try { await started?.close(); }
      finally { await new Promise<void>(resolve => status.close(() => resolve())); }
    })();
    return closeTask;
  }
  function update(force: boolean): Promise<void> {
    if (closing) return Promise.resolve();
    if (updateTask) return updateTask;
    updateTask = (async () => {
      const result = await handleProtocolMismatch({ ...options, enabled: options.autoUpdate, force });
      if (result !== 'updated') return;
      await close();
      await restart();
    })().catch(error => { console.error('Host restart failed:', error); }).finally(() => { updateTask = null; });
    return updateTask;
  }
  const shutdown = () => { void close(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  try {
    startup = startEnrolledHostDaemon({
      keepRetryingStartup: true,
      signal: controller.signal,
      dataDir: options.dataDir,
      provenance: options.provenance ?? 'non-tunnel',
      replaceEnrollment: options.replaceEnrollment,
      serverUrl: options.serverUrl.endsWith('/') ? options.serverUrl : `${options.serverUrl}/`,
      token: options.joinCode || readConnectEnrollment(options.dataDir, options.hostId), hostId: options.hostId,
      onConnectionChange: value => { connected = value && !closing; },
      onSocketClose: code => {
        connected = false;
        if (code === 4003) {
          // Existing launchd/systemd installs restart even a clean exit. Leave
          // their status listener alive, with the runtime stopped, until an
          // explicit service restart; otherwise two managers reclaim forever.
          if (process.env.ZCC_HOST_SERVICE_MANAGED === '1' && daemon) void daemon.close();
          else void close();
          return;
        }
        if (!closing && options.autoUpdate && (code === 4001 || code === 4002)) void update(code === 4001);
      }
    });
    daemon = await startup;
    // Replacement consent applies to this join only, not a standalone restart.
    process.argv = process.argv.filter(arg => arg !== '--replace-enrollment');
    delete process.env.ZCC_HOST_REPLACE_ENROLLMENT;
    if (closing) return { close };
    rmSync(join(options.dataDir, 'connect-enroll.json'), { force: true });
    hostId = daemon.hostId;
    connected = !closing;
    await confirmHostUpdate(options.dataDir).catch(error => console.error('Host update cleanup failed:', error));
    process.stdout.write(`zcc-host-daemon joined hostId=${daemon.hostId}\n`);
    return { close };
  } catch (error) {
    const cancelled = closing;
    if (updateTask) await updateTask;
    else if (options.autoUpdate && /incompatible host-rpc protocol version|409/.test(String(error))) await update(true);
    await close();
    if (!cancelled) throw error;
    return { close };
  }
}

/** Installer pre-flight: refuse an unsafe enrollment before touching a running daemon. */
export function checkEnrollmentOnly(options: JoinCliOptions, assertSafe: typeof assertEnrollmentSafe = assertEnrollmentSafe): void {
  if (!options.dataDir) throw new Error('ZCC_DATA_DIR is required for an isolated machine install');
  assertSafe(options);
}

const entry = process.argv[1] ?? '';
const launchedDirectly = /(?:join-cli\.[tj]s|join\.[cm]js)$/.test(entry);
if (launchedDirectly && process.argv[2] === 'restart') {
  const dataDir = process.env.ZCC_DATA_DIR;
  if (!dataDir) throw new Error('ZCC_DATA_DIR is required for an isolated machine restart');
  await restartInstalledHost(dataDir, entry);
  process.stdout.write('Host daemon restarted using saved enrollment.\n');
}
if (launchedDirectly && process.argv.includes('--check-protocol')) {
  const value = process.argv[process.argv.indexOf('--check-protocol') + 1];
  process.exit(Number(value) === HOST_RPC_PROTOCOL_VERSION ? 0 : 1);
}
if (launchedDirectly && process.argv.includes('join')) {
  const options = parseJoinArgv(process.argv.slice(2));
  if (process.argv.includes('--check-enrollment')) {
    checkEnrollmentOnly(options);
    process.exit(0);
  }
  installRuntimeLog(options.dataDir, 'host-daemon', import.meta.url);
  // A standalone self-restart has a new PID; never leave the installer's old record behind.
  const pidFile = join(options.dataDir, 'host-daemon.pid');
  if (process.env.ZCC_HOST_SERVICE_MANAGED !== '1') {
    mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
    const temporary = `${pidFile}.${process.pid}.tmp`;
    writeFileSync(temporary, String(process.pid), { mode: 0o600 });
    renameSync(temporary, pidFile);
    process.on('exit', () => {
      try { if (readFileSync(pidFile, 'utf8').trim() === String(process.pid)) rmSync(pidFile); } catch {}
    });
  }
  try {
    await runJoin(options);
  } catch (error) {
    if (await rollbackHostUpdate(options.dataDir)) await restartHostProcess();
    throw error;
  }
}
