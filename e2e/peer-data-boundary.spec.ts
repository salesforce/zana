import { _electron, type ElectronApplication } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CcApi } from '../packages/desktop-contract/src/cc-api.js';
import { test, expect, closeApp, dismissConsentOverlays, type AppHandle } from './fixtures/app.js';
import { isolatedClaudePath, writeAppConfig } from './fixtures/app-config.js';
import { linuxCiElectronArgs, linuxCiElectronEnv } from './fixtures/linux-electron-launch.js';
import { cleanupTmuxEnvironment, isolateTmuxEnvironment } from './fixtures/tmux-isolation.js';
import { getPluginBuildToolchain } from '../packages/plugin-build/src/toolchain.js';
import { transferQuery, type PeerTransfer } from '../plugins/design-docs/src/server/peer-protocol.js';
import { corePeerConfig, createPeerApps } from './fixtures/peer-apps.js';
import { answerApprovalSheet, installProbePlugin, pairComputers, probeRpc, reopenCorePeers, writeProbePlugin, type ProbeConnection } from './fixtures/core-peer-use.js';
import { startPrivateSshd } from './fixtures/sshd.js';

const pluginId = 'peer-data-probe';
const scope = 'isolated-electron-data-boundary';

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

for (const fenced of [false, true]) {
test(`independent built apps ${fenced ? 'commit-fenced' : 'read-only'} pair auth round-trips more than 8192 bytes through IPC and UI`, async ({ home }) => {
  test.setTimeout(300_000);
  const root = process.env.ZCC_E2E_APP_ROOT;
  if (!root || process.env.ZCC_E2E_EXECUTABLE_PATH) throw new Error('This isolated credential probe requires a private unpackaged build');
  const apps: AppHandle[] = [];
  const homes: string[] = [];
  const processes: ElectronApplication[] = [];
  const source = join(home, pluginId);
  mkdirSync(source);
  if (fenced) {
    const toolchain = await getPluginBuildToolchain(join(home, 'toolchain'));
    const esbuild = await import(toolchain.esbuild) as typeof import('esbuild');
    await esbuild.build({ entryPoints: [join(import.meta.dirname, 'fixtures', 'peer-design-docs-worker.ts')],
      outfile: join(source, 'dd-worker.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22' });
  }
  writeFileSync(join(source, 'package.json'), JSON.stringify({
    name: pluginId, version: '0.1.0', type: 'module',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: 'Peer Data Probe', description: 'Disposable pair-auth boundary probe', branding: { icon: 'Puzzle' }, server: './server.mjs', app: './app.js' }
  }));
  writeFileSync(join(source, 'server.mjs'), `${fenced ? "import setupDesignDocs from './dd-worker.mjs';" : ''}
    export default api => {
    ${fenced ? 'setupDesignDocs(api);' : ''}
    let received = 0;
    const db = api.storage.database();
    db.runScript('CREATE TABLE IF NOT EXISTS peer_payloads (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
    const diagnostics = [];
    api.sdk.peers.handle('echo', async request => {
      diagnostics.push({ stage: 'entered', bytes: Buffer.byteLength(request.body.text), aborted: request.signal.aborted });
      try {
        const echo = () => {
          received++;
          ${fenced ? "db.prepare('INSERT INTO peer_payloads (payload) VALUES (?)').run(request.body.text);" : ''}
          return { text: request.body.text, peerId: request.peerId, scope: request.scope,
            grantEpoch: request.grantEpoch, bytes: Buffer.byteLength(request.body.text),
            electron: process.versions.electron, bootKeyPresent: Boolean(process.env.ZCC_PEER_STORAGE_BOOT_KEY) };
        };
        // Read-only transport proof does not assert a mutation/receipt commit fence.
        return ${fenced ? 'await request.commitSync(echo)' : 'echo()'};
      } catch (error) { diagnostics.push({ stage: 'commit-failed', error: String(error), aborted: request.signal.aborted }); throw error; }
    });
    api.rpc.method('diagnostics', () => diagnostics.slice(-8));
    api.rpc.method('identity', () => api.sdk.peers.localIdentity());
    api.rpc.method('enrolled', () => api.sdk.peers.enrolled());
    api.rpc.method('enable', args => api.sdk.peers.enable(args.peerId, { scope: args.scope }));
    api.rpc.method('links', () => api.sdk.peers.list());
    api.rpc.method('received', () => received);
    api.rpc.method('stored', () => db.prepare('SELECT payload FROM peer_payloads ORDER BY id').all());
    api.rpc.method('revoke', args => api.sdk.peers.revoke(args.peerId, { scope: args.scope }));
    api.rpc.method('echo', args => api.sdk.peers.call(args.peerId, 'echo', { text: args.text }, { scope: args.scope, timeoutMs: 10000 }));
  };`);
  writeFileSync(join(source, 'app.js'), `const React = globalThis.__ZCC_HOST_REACT__;
    function Panel() {
      const rpc = globalThis.__ZCC_PLUGIN_RUNTIME__.useRpc();
      const [peerId, setPeerId] = React.useState('');
      const [text, setText] = React.useState('');
      const [result, setResult] = React.useState('');
      return React.createElement('section', null,
        React.createElement('h2', null, 'Peer Data Probe'),
        React.createElement('input', { 'aria-label': 'Peer identity', value: peerId, onChange: event => setPeerId(event.target.value) }),
        React.createElement('textarea', { 'aria-label': 'Peer payload', value: text, onChange: event => setText(event.target.value) }),
        React.createElement('button', { onClick: () => rpc.call('echo', { peerId, text, scope: ${JSON.stringify(scope)} }).then(
          value => setResult(value.text), error => setResult(String(error))) }, 'Round trip'),
        React.createElement('pre', { role: 'status', 'aria-label': 'Peer result' }, result));
    }
    export default { __zccPluginApp: true, setup(app) {
      app.slots.navPanel({ id: 'main', title: 'Peer Data Probe', icon: 'Puzzle', component: Panel });
    } };`);

  const rpc = <T,>(app: AppHandle, method: string, args?: unknown): Promise<T> => app.window.evaluate(
    ({ pluginId, method, args }) => (window as unknown as { cc: CcApi }).cc.pluginApps.callRpc(pluginId, method, args), { pluginId, method, args }
  ) as Promise<T>;

  async function launch(name: string): Promise<AppHandle> {
    const isolatedHome = join(home, name);
    homes.push(isolatedHome);
    mkdirSync(isolatedHome, { mode: 0o700 });
    writeAppConfig(isolatedHome, { sponsorPromptDismissed: true });
    const pluginStore = join(isolatedHome, '.zcc', 'plugins');
    mkdirSync(pluginStore, { recursive: true });
    writeFileSync(join(pluginStore, 'installed.json'), JSON.stringify({ version: 1, plugins: [{
      id: pluginId, version: '0.1.0', name: 'Peer Data Probe', enabled: true, status: 'running', provenance: 'direct',
      sourceKind: 'path', source: `path:${source}`, rootDir: source, serverEntry: './server.mjs', appEntry: './app.js',
      installedAt: Date.now(), updatedAt: Date.now()
    }] }));
    const launcher = join(isolatedHome, 'launcher');
    mkdirSync(launcher);
    const version = JSON.parse(readFileSync(join(root!, 'package.json'), 'utf8')).version;
    writeFileSync(join(launcher, 'package.json'), JSON.stringify({ name: 'zana-command-center', version, type: 'module', main: 'main.mjs' }));
    // Only the OS-key composition seam is replaced. Built server/daemon/IPC code stays untouched.
    // E2E skips the Keychain (ZCC_E2E_HOME); the supervisor feeds this main-process hex key through the
    // production peerBootKey 'start'-message path. The legacy env key is ignored by the server runtime.
    writeFileSync(join(launcher, 'main.mjs'), `import { utilityProcess } from 'electron';
      import { randomBytes } from 'node:crypto';
      process.env.ZCC_E2E_PEER_BOOT_KEY_HEX = randomBytes(32).toString('hex');
      const fork = utilityProcess.fork.bind(utilityProcess);
      globalThis.__peerKeyProbe = { server: 0, host: 0, hostKeyPresent: false };
      utilityProcess.fork = (entry, args, options) => {
        if (entry.endsWith('server-runtime.js')) globalThis.__peerKeyProbe.server++;
        if (entry.endsWith('host-runtime.js')) {
          globalThis.__peerKeyProbe.host++;
          globalThis.__peerKeyProbe.hostKeyPresent ||= Boolean(options.env?.ZCC_PEER_STORAGE_BOOT_KEY);
        }
        return fork(entry, args, options);
      };
      await import(${JSON.stringify(pathToFileURL(join(root!, 'out/main/index.js')).href)});
    `, { mode: 0o600 });
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: isolatedHome, USERPROFILE: isolatedHome,
      ZCC_E2E_HOME: isolatedHome, ZCC_DATA_DIR: join(isolatedHome, '.zcc'),
      ZCC_EXTENSIONS_DIR: join(isolatedHome, '.zcc', 'extensions'), ZCC_E2E_APP_VERSION: version,
      ZCC_SERVER_PORT: String(await unusedPort()), PATH: isolatedClaudePath(process.env.PATH),
      ...linuxCiElectronEnv() };
    for (const key of ['ZCC_PEER_STORAGE_BOOT_KEY', 'ELECTRON_RENDERER_URL', 'ZCC_DESKTOP_APP_URL',
      'ZCC_SERVER_URL', 'ZCC_HOST_ENROLL_TOKEN', 'ZCC_SESSION_ID', 'ZCC_SESSION_TOKEN', 'ELECTRON_RUN_AS_NODE']) delete env[key];
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
    const app = { electron, window, home: isolatedHome };
    apps.push(app);
    expect(await electron.evaluate(({ app }) => ({ home: app.getPath('home'), envHome: process.env.HOME,
      electron: process.versions.electron, key: process.env.ZCC_PEER_STORAGE_BOOT_KEY ?? null,
      probe: (globalThis as any).__peerKeyProbe }))).toMatchObject({ home: isolatedHome, envHome: isolatedHome,
      electron: expect.any(String), key: null, probe: { server: 1, host: 1, hostKeyPresent: false } });
    await expect.poll(async () => {
      const plugin = await window.evaluate(async id => (await (globalThis as unknown as { cc: CcApi }).cc.pluginApps.list()).find(plugin => plugin.id === id), pluginId);
      return plugin;
    }, { timeout: 30_000 }).toMatchObject({ status: 'running' });
    return app;
  }

  async function enroll(owner: AppHandle, local: AppHandle): Promise<string> {
    const issued = await owner.window.evaluate(async () => {
      const response = await fetch('/api/v1/hosts/join-codes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error(`Join code HTTP ${response.status}`);
      return response.json();
    });
    const machine = join(local.home, 'remote-enrollment');
    mkdirSync(machine);
    const archive = await fetch(new URL('/install/zcc-host.tgz', owner.window.url()), { signal: AbortSignal.timeout(10_000) });
    expect(archive.status).toBe(200);
    const artifact = join(machine, 'host.tgz');
    writeFileSync(artifact, Buffer.from(await archive.arrayBuffer()), { mode: 0o600 });
    execFileSync('tar', ['-xzf', artifact, '-C', machine], { timeout: 10_000, stdio: 'pipe' });
    const port = await unusedPort();
    await local.electron.evaluate((_electron, input) => {
      const { spawn } = process.getBuiltinModule('child_process');
      const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', HOME: input.home,
        ZCC_DATA_DIR: input.machine, ZCC_LOCAL_PEER_APP_DATA_DIR: `${input.home}/.zcc` };
      delete env.ZCC_PEER_STORAGE_BOOT_KEY;
      const child = spawn(process.execPath, [`${input.machine}/join.mjs`, 'join', '--join-code', input.joinCode,
        '--host-id', input.hostId, '--server-url', input.origin, '--host-daemon-port', String(input.port)],
      { cwd: input.machine, env, stdio: 'ignore' });
      (globalThis as any).__peerDaemon = child;
      (globalThis as any).__peerDaemonError = null;
      child.once('error', error => { (globalThis as any).__peerDaemonError = error.message; });
    }, { home: local.home, machine, port, origin: new URL(owner.window.url()).origin, ...issued });
    await expect.poll(async () => {
      const child = await local.electron.evaluate(() => ({ error: (globalThis as any).__peerDaemonError,
        exitCode: (globalThis as any).__peerDaemon.exitCode }));
      if (child.error || child.exitCode !== null) throw new Error(`Installed daemon failed: ${JSON.stringify(child)}`);
      return fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) })
        .then(response => response.json()).catch(() => null);
    }, { timeout: 30_000 }).toMatchObject({ connected: true, hostId: issued.hostId });
    return issued.hostId;
  }

  try {
    const a = await launch('app-a'), b = await launch('app-b');
    const aId = (await rpc<{ id: string }>(a, 'identity')).id;
    const bId = (await rpc<{ id: string }>(b, 'identity')).id;
    expect(aId).not.toBe(bId);
    await expect(rpc(a, 'echo', { peerId: bId, scope, text: 'unauthorized' })).rejects.toThrow('peer link is not authorized');
    const ab = await enroll(a, b), ba = await enroll(b, a);
    await expect.poll(() => rpc(a, 'enrolled'), { timeout: 30_000 }).toEqual([expect.objectContaining({ id: bId, hostId: ab, connected: true })]);
    await expect.poll(() => rpc(b, 'enrolled'), { timeout: 30_000 }).toEqual([expect.objectContaining({ id: aId, hostId: ba, connected: true })]);
    const grant = await rpc<{ pairId: string; proposalId: string }>(a, 'enable', { peerId: bId, scope });
    expect(grant).toMatchObject({ id: bId, scope, grantEpoch: 1, pairId: expect.any(String), proposalId: expect.any(String) });
    expect(await rpc(b, 'enable', { peerId: aId, scope })).toMatchObject({ id: aId, pairId: grant.pairId, proposalId: grant.proposalId, scope, grantEpoch: 1 });
    const text = `BEGIN-${'0123456789abcdef'.repeat(2048)}-TAIL-${'\u00e9\ud83d\udd12'.repeat(512)}-END`;
    expect(Buffer.byteLength(text)).toBeGreaterThan(8192);
    await a.window.getByRole('button', { name: 'Peer Data Probe', exact: true }).click();
    await a.window.getByRole('textbox', { name: 'Peer identity' }).fill(bId);
    await a.window.getByRole('textbox', { name: 'Peer payload' }).fill(text);
    await a.window.getByRole('button', { name: 'Round trip', exact: true }).click();
    await expect.poll(async () => {
      const actual = await a.window.getByRole('status', { name: 'Peer result' }).textContent();
      if (actual?.startsWith('Error:')) throw new Error(actual);
      return actual === text;
    }).toBe(true);
    expect(await rpc(b, 'received')).toBe(1);
    if (fenced) {
      const members = [{ replicaId: 'replica-a', machineId: aId, sponsorReplicaId: null, joinedAt: 1 },
        { replicaId: 'replica-b', machineId: bId, sponsorReplicaId: null, joinedAt: 1 }];
      await rpc(a, 'configure', { scope, replicaId: 'replica-a', members });
      await rpc(b, 'configure', { scope, replicaId: 'replica-b', members });
      for (let revision = 0; revision < 2; revision++) {
        const prepared = await rpc<{ docId: string; transfer: PeerTransfer }>(a, 'prepare', { grantEpoch: 1 });
        const transfer = prepared.transfer, query = transferQuery(transfer);
        const send = (method: string, body: unknown) => rpc(a, 'send', { peerId: bId, method, body, scope });
        await send('transfer', transfer);
        const missing = await send('missing', query) as { chunks: Array<{ blobHash: string; index: number }> };
        for (const chunk of missing.chunks) await send('chunk', await rpc(a, 'chunk', { transfer, ...chunk }));
        const started = Date.now();
        expect(await send('apply', query)).toMatchObject({ stage: 'synced', heads: transfer.heads, appliedHeads: transfer.heads });
        const elapsed = Date.now() - started;
        const expected = await rpc<any>(a, 'inspect', prepared), actual = await rpc<any>(b, 'inspect', prepared);
        expect(actual).toMatchObject({ bytes: 24 * 1024 * 1024, files: expected.files, head: transfer.heads[prepared.docId],
          receipt: { stage: 'synced' }, staged: { n: 0 } });
        expect(elapsed).toBeLessThan(10_000);
        console.log(`[peer-data] production DD 24MiB ${revision ? 'rewrite' : 'initial'} apply ${elapsed}ms; ${missing.chunks.length} chunks; SQLite hashes/head/receipt exact`);
      }
      for (const app of [a, b]) expect(await app.window.evaluate(async id => (await window.cc.pluginApps.list()).find(plugin => plugin.id === id)?.status, pluginId)).toBe('running');
    }
    expect(await rpc(b, 'stored')).toEqual(fenced ? [{ payload: text }] : []);
    expect(await rpc(b, 'diagnostics')).toEqual([{ stage: 'entered', bytes: Buffer.byteLength(text), aborted: false }]);
    const reverse = await rpc(b, 'echo', { peerId: aId, scope, text });
    expect(reverse).toEqual({ text, peerId: bId, scope, grantEpoch: 1, bytes: Buffer.byteLength(text),
      electron: await a.electron.evaluate(() => process.versions.electron), bootKeyPresent: false });
    expect(await rpc(a, 'received')).toBe(1);
    expect(await rpc(a, 'stored')).toEqual(fenced ? [{ payload: text }] : []);
    await expect(rpc(a, 'echo', { peerId: bId, scope: 'wrong-scope', text })).rejects.toThrow('peer link is not authorized');
    expect(await rpc(b, 'received')).toBe(1);
    for (const app of apps) {
      for (const file of ['peer-authority/authority-v1.bin', 'peer-pairs/pairs-v2.bin']) {
        const ciphertext = readFileSync(join(app.home, '.zcc', file));
        expect(ciphertext.subarray(0, 4).toString()).toBe('ZCP2');
        expect(ciphertext.includes(Buffer.from(scope))).toBe(false);
      }
      expect(existsSync(join(app.home, '.zcc', 'peer-key'))).toBe(false);
    }
    await rpc(a, 'revoke', { peerId: bId, scope });
    await expect.poll(() => rpc(a, 'links')).toEqual([]);
    // Remote revocation is delivered by the core's 30-second recovery tick.
    await expect.poll(() => rpc(b, 'links'), { timeout: 45_000 }).toEqual([]);
    for (const [app, peerId] of [[a, bId], [b, aId]] as const) {
      await expect(rpc(app, 'echo', { peerId, scope, text })).rejects.toThrow('peer link is not authorized');
      expect(await rpc(app, 'received')).toBe(1);
      expect(await rpc(app, 'stored')).toEqual(fenced ? [{ payload: text }] : []);
    }
    console.log(`[peer-data] ${fenced ? 'commit-fenced' : 'read-only'} built Electron ${await a.electron.evaluate(() => process.versions.electron)}; independent homes; mutual pair active; ${Buffer.byteLength(text)} UTF-8 bytes exact both ways; UI echo; wrong scope/revoke denied; test-only server keys`);
  } catch (error) {
    for (const app of apps) {
      console.error(`[peer-data] ${app.home} plugin status:`, await app.window.evaluate(async id =>
        (await window.cc.pluginApps.list()).find(plugin => plugin.id === id), pluginId).catch(String));
      const installed = join(app.home, '.zcc', 'plugins', 'installed.json');
      if (existsSync(installed)) console.error(`[peer-data] ${app.home} stored plugin:`,
        JSON.parse(readFileSync(installed, 'utf8')).plugins.find((plugin: { id: string }) => plugin.id === pluginId));
      console.error(`[peer-data] ${app.home}:`, await rpc(app, 'diagnostics').catch(String));
      for (const name of ['server', 'host-daemon']) {
        const log = join(app.home, '.zcc', 'logs', `${name}.log`);
        if (existsSync(log)) console.error(`[peer-data] ${name}:`, readFileSync(log, 'utf8').slice(-6000));
      }
    }
    throw error;
  } finally {
    for (const electron of processes.slice().reverse()) {
      await electron.evaluate(async () => {
        const child = (globalThis as any).__peerDaemon;
        if (!child || child.exitCode !== null || child.signalCode !== null) return;
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
          child.once('exit', () => { clearTimeout(timer); resolve(); });
          child.kill('SIGTERM');
        });
      }).catch(() => {});
      await closeApp(electron);
    }
    for (const isolatedHome of homes) {
      await cleanupTmuxEnvironment(isolatedHome);
      // Real built server/daemon shutdown must finish peer writes before root deletion.
      rmSync(isolatedHome, { recursive: true });
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    for (const isolatedHome of homes) expect(existsSync(isolatedHome)).toBe(false);
  }
});
}

test('core-connected apps carry more than 8192 bytes of UTF-8 both ways through a plugin use, and stop after Remove', async ({ home }) => {
  test.setTimeout(420_000);
  const source = join(home, 'probe-plugin');
  writeProbePlugin(source);
  const sshd = await startPrivateSshd([join(home, 'app-a', '.ssh', 'authorized_keys'), join(home, 'app-b', '.ssh', 'authorized_keys')]);
  const peers = createPeerApps(home);
  const prelaunch = (isolatedHome: string) => installProbePlugin(isolatedHome, source);
  try {
    const a = await peers.launch('app-a', { initialConfig: corePeerConfig, prelaunch, env: { ZCC_E2E_PEER_SSH_ENDPOINT: sshd.endpoint() } });
    const b = await peers.launch('app-b', { initialConfig: corePeerConfig, prelaunch });
    await pairComputers(a, b);
    const connection = async (app: AppHandle) => {
      let found: ProbeConnection | undefined;
      await expect.poll(async () => { found = (await probeRpc<ProbeConnection[]>(app, 'connections'))[0]; return found?.state; }, { timeout: 60_000 }).toBe('connected');
      return found!;
    };
    const target = await connection(a);
    await probeRpc(a, 'requestUse', { computerId: target.computerId });
    await Promise.all([answerApprovalSheet(a, 'Allow a plugin to use a connection'), answerApprovalSheet(b, 'Allow a plugin to use a connection')]);
    for (const app of [a, b]) {
      await expect.poll(async () => (await connection(app)).usedByThisPlugin, { timeout: 90_000 }).toBe(true);
      await probeRpc(app, 'enable', { peerId: (await connection(app)).computerId, scope: 'connection' });
    }
    const text = `BEGIN-${'0123456789abcdef'.repeat(2048)}-TAIL-${'\u00e9\ud83d\udd12'.repeat(512)}-END`;
    expect(Buffer.byteLength(text)).toBeGreaterThan(8192);
    for (const from of [a, b]) {
      const toId = (await connection(from)).computerId;
      await expect.poll(() => probeRpc<{ text: string }>(from, 'echo', { computerId: toId, text }).then(reply => reply.text === text, () => false), { timeout: 60_000 }).toBe(true);
    }
    // Remove ends the traffic: the probe is told once, and the peer is no longer addressable.
    const { window } = await reopenCorePeers(a);
    // The active-transfer gate lives on the per-use row; computer-level Remove confirms once and runs plugin cleanup.
    await window.getByTestId('peer-computer').getByRole('button', { name: 'Remove computer', exact: true }).click();
    await window.getByRole('alertdialog', { name: 'Confirm removing computer link' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(window.getByTestId('peer-link')).toHaveCount(0, { timeout: 30_000 });
    expect(await probeRpc<string[]>(a, 'removing')).toEqual([target.computerId]);
    await expect(probeRpc(a, 'echo', { computerId: target.computerId, text })).rejects.toThrow();
  } finally {
    await peers.dispose();
    await sshd.dispose();
  }
});
