import { test, expect, launchApp, closeApp, type AppHandle } from './fixtures/app.js';
import { captureDrawerLogs, capturedDrawerLogs, capturedDrawerStages } from './fixtures/host-install-drawer.js';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import type { Page } from '@playwright/test';

// Track A at the built Electron boundary: no public URL, so
// every install takes the primary-owned persistent SSH tunnel. The fake `ssh`
// is the harness from remote-ssh-tunnel-recovery.spec.ts: it forwards TCP for
// `-R` like OpenSSH and runs the real unpack/install scripts in a separate HOME.
const SSH_HOST = 'tunnel-fixture';
const STAGES = [
  ['ssh', 'Connecting over SSH'],
  ['tunnel', 'Opening tunnel'],
  ['install', 'Installing'],
  ['wait', 'Waiting for machine'],
  ['register', 'Registering with this app'],
  ['connected', 'Connected']
] as const;
const JOIN_CODE_RE = /zcde_[A-Za-z0-9_-]{8,}/;

type AuditRow = { kind: 'tunnel' | 'unpack' | 'install' | 'other'; home: string; remotePort?: number; localPort?: number; rejected?: boolean };

interface Harness {
  home: string;
  remoteHome: string;
  dataDir: string;
  flags: string;
  env: Record<string, string>;
  audit(): AuditRow[];
  setFlag(name: string, on: boolean): void;
  close(): Promise<void>;
}

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as { port: number }).port;
}

async function createHarness(home: string): Promise<Harness> {
  const bin = join(home, 'bin'), remoteHome = join(home, 'remote-home'), remoteBin = join(remoteHome, 'bin');
  const flags = join(home, 'ssh-flags'), auditFile = join(home, 'ssh-audit.jsonl'), dataDir = join(home, '.zcc');
  for (const dir of [bin, remoteBin, flags, dataDir, join(home, '.ssh')]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  symlinkSync(process.execPath, join(remoteBin, 'node'));
  writeFileSync(join(remoteBin, 'uname'), '#!/bin/sh\necho Linux\n', { mode: 0o700 });
  writeFileSync(join(remoteBin, 'systemctl'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  // The machine lists come from ~/.ssh/config in the isolated HOME.
  writeFileSync(join(home, '.ssh/config'), `Host ${SSH_HOST}\n  HostName 127.0.0.1\n`, { mode: 0o600 });
  const loginShell = join(bin, 'login-shell');
  writeFileSync(loginShell, '#!/bin/sh\nprintf "__ZCC_PATH_START__%s__ZCC_PATH_END__" "$PATH"\n', { mode: 0o700 });
  // An artifact origin that is down, for the installer-diagnostics scenario.
  const unavailable = createServer((_req, res) => { res.writeHead(503); res.end('unavailable'); });
  const unavailablePort = await listen(unavailable);
  const config = { audit: auditFile, flags, remoteHome, remoteBin, node: process.execPath, unavailableOrigin: `http://127.0.0.1:${unavailablePort}` };
  writeFileSync(join(bin, 'ssh'), `#!${process.execPath}
const fs=require('node:fs'),net=require('node:net'),path=require('node:path'),{spawn}=require('node:child_process');
const cfg=${JSON.stringify(config)};
const args=process.argv.slice(2),cmd=args.at(-1)||'',r=args.indexOf('-R');
const flag=name=>fs.existsSync(path.join(cfg.flags,name));
const kind=r>=0?'tunnel':cmd.includes('tar -xzf')?'unpack':/ join --join-code /.test(cmd)?'install':'other';
const row={kind,home:process.env.HOME};
// A real remote never inherits this app's ZCC_* environment (data dir, ports)
// or the runner's FORCE_COLOR (which colors \`node -p\` output).
const remoteEnv={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('ZCC_')&&k!=='FORCE_COLOR')),HOME:cfg.remoteHome,PATH:cfg.remoteBin+':/usr/bin:/bin',ZCC_NODE:cfg.node};
if(r>=0){
  const [,port,,target]=args[r+1].split(':');
  row.remotePort=Number(port);row.localPort=Number(target);
  // OpenSSH under ExitOnForwardFailure=yes: report and exit when -R cannot bind.
  const refuse=()=>process.stderr.write('Error: remote port forwarding failed for listen port '+port+'\\n',()=>process.exit(255));
  if(flag('reject-next-forward')){fs.rmSync(path.join(cfg.flags,'reject-next-forward'));row.rejected=true;fs.appendFileSync(cfg.audit,JSON.stringify(row)+'\\n');refuse();return;}
  fs.appendFileSync(cfg.audit,JSON.stringify(row)+'\\n');
  const server=net.createServer(socket=>{const upstream=net.connect(Number(target),'127.0.0.1');socket.pipe(upstream).pipe(socket);socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());});
  server.on('error',refuse);
  server.listen(Number(port),'127.0.0.1',()=>process.stdout.write('ZCC-PEER-TUNNEL-READY\\n'));
  return;
}
fs.appendFileSync(cfg.audit,JSON.stringify(row)+'\\n');
let script=cmd,env=remoteEnv;
if(kind==='install'&&flag('artifact-503')){
  // The machine runs the real install-machine.sh, fetched through the tunnel,
  // against an artifact origin answering 503. Values never reach argv here.
  const value=name=>(new RegExp(name+"='([^']*)'").exec(cmd)||[])[1]||'';
  env={...remoteEnv,ZCC_T_SERVER:value('server_url'),ZCC_T_CODE:value('join_code'),ZCC_T_HOST:value('host_id'),ZCC_T_ARTIFACT:cfg.unavailableOrigin};
  script='t=$(mktemp) && curl -fsS "$ZCC_T_SERVER/install.sh" -o "$t" && sh "$t" --join-code "$ZCC_T_CODE" --host-id "$ZCC_T_HOST" --server "$ZCC_T_ARTIFACT"; rc=$?; rm -f "$t"; exit $rc';
}
const p=spawn('/bin/sh',['-c',script],{env,stdio:'inherit'});
p.on('exit',code=>process.exit(code??1));
`, { mode: 0o700 });
  return {
    home,
    remoteHome,
    dataDir,
    flags,
    env: { PATH: `${bin}:${process.env.PATH}`, SHELL: loginShell, ZDOTDIR: home },
    audit: () => existsSync(auditFile)
      ? readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as AuditRow)
      : [],
    setFlag(name, on) {
      if (on) writeFileSync(join(flags, name), '');
      else rmSync(join(flags, name), { force: true });
    },
    async close() {
      // Stop only processes this test started under its own throwaway remote HOME
      // (the join runtime and its daemon children), matched by either tmp spelling.
      const roots = [remoteHome, realpathSync(remoteHome)].map(root => `${root}/`);
      const ps = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
      for (const line of ps.split('\n')) {
        const match = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (!match || !roots.some(root => match[2]!.includes(root))) continue;
        try { process.kill(Number(match[1]), 'SIGTERM'); } catch { /* already gone */ }
      }
      unavailable.closeAllConnections();
      await new Promise<void>(resolve => unavailable.close(() => resolve()));
    }
  };
}

async function api<T = any>(win: Page, path: string): Promise<T> {
  return win.evaluate(async p => {
    const response = await fetch(`/api/v1${p}`);
    if (!response.ok) throw new Error(`${p} → HTTP ${response.status}`);
    return response.json();
  }, path);
}

async function remoteHosts(win: Page): Promise<Array<{ id: string; status: string; isPrimary: boolean; name: string }>> {
  return (await api<any[]>(win, '/hosts')).filter(host => !host.isPrimary);
}

async function primaryConnected(win: Page): Promise<void> {
  await expect.poll(async () => (await api<any[]>(win, '/hosts')).some(h => h.isPrimary && h.status === 'connected'), { timeout: 60_000 }).toBe(true);
}

/** An expanded install log keeps the drawer past success; close it before driving other UI. */
async function closeInstallDrawer(win: Page): Promise<void> {
  const drawer = win.getByTestId('host-install-drawer');
  if (await drawer.count()) {
    // It may auto-close between the count and the click; the end state is what matters.
    await drawer.getByRole('button', { name: 'Close install log' }).click({ timeout: 5_000 }).catch(() => {});
  }
  await expect(drawer).toHaveCount(0);
}

async function openAddMachine(win: Page) {
  await closeInstallDrawer(win);
  // Inside a project the sidebar's Settings link is the project's own settings.
  const backToProjects = win.getByRole('button', { name: 'Back to all projects' });
  if (await backToProjects.count()) await backToProjects.click();
  await win.getByRole('link', { name: 'Settings', exact: true }).click();
  await win.getByTestId('settings-nav-machines').click();
  await win.getByRole('button', { name: /^Add (a )?machine$/i }).first().click();
  const dialog = win.getByRole('dialog').filter({ hasText: 'Add a machine' });
  await expect(dialog).toBeVisible();
  const methodSsh = dialog.getByTestId('add-machine-method-ssh');
  if (await methodSsh.count()) await methodSsh.click();
  await dialog.getByTestId('add-machine-ssh-host').getByRole('option', { name: new RegExp(SSH_HOST) }).click();
  return dialog;
}

async function expectAllStagesPassed(container: ReturnType<Page['getByTestId']>, timeout = 120_000) {
  for (const [stage, label] of STAGES) {
    const row = container.getByTestId(`host-install-stage-${stage}`);
    await expect(row).toHaveAttribute('data-status', 'passed', { timeout });
    await expect(row).toContainText(label);
  }
}

async function readClipboard(app: AppHandle): Promise<string> {
  return app.electron.evaluate(({ clipboard }) => clipboard.readText());
}

async function writeClipboard(app: AppHandle, text: string): Promise<void> {
  await app.electron.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
}

function tunnelEntries(dataDir: string): Record<string, { remotePort: number }> {
  const file = join(dataDir, 'tunnel-hosts.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).hosts ?? {}) : {};
}

async function addRemoteProject(win: Page, name: string, remotePath: string): Promise<void> {
  const backToApp = win.getByRole('button', { name: 'Back to app' }).or(win.getByRole('link', { name: 'Back to app' }));
  if (await backToApp.count()) await backToApp.first().click();
  const heading = win.getByTestId('sidebar-projects-heading');
  if (await heading.count() && await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await win.getByRole('button', { name: 'Add machine or project', exact: true }).first().click();
  await win.getByRole('button', { name: 'Add remote project' }).click();
  const dialog = win.getByRole('dialog', { name: 'Add remote project' });
  await dialog.getByRole('button', { name: new RegExp(`^${SSH_HOST}`) }).click();
  await dialog.getByLabel('Project name').fill(name);
  await dialog.getByLabel('Start path (optional)').fill(remotePath);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/** First use of the remote project from the composer installs (or binds) its machine. */
async function composerInstall(win: Page, name: string) {
  await win.getByRole('button', { name: `Open ${name}`, exact: true }).click();
  await win.getByTestId('agents-board-new-thread').click();
  const modal = win.getByTestId('launch-modal');
  await modal.getByRole('button', { name: 'Modern', exact: true }).click();
  await modal.getByTestId('composer-host-action').click();
  return { modal, drawer: win.getByTestId('host-install-drawer') };
}

/** The drawer collapses its raw log behind a toggle once stages render. */
async function drawerLog(drawer: ReturnType<Page['getByTestId']>, { expand = false } = {}) {
  const toggle = drawer.getByTestId('host-install-log-toggle');
  const log = drawer.getByTestId('host-install-log');
  // `expand` waits for the staged view so the click pins the log open; before
  // stages render the log shows by default and would collapse once they arrive.
  await expect(expand ? toggle : toggle.or(log).first()).toBeVisible({ timeout: 60_000 });
  // A real click: the drawer must stay usable above the launcher's backdrop.
  if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  return log;
}

async function expectExplorerLists(win: Page, name: string, fileName: string): Promise<void> {
  const modal = win.getByTestId('launch-modal');
  // The launcher closes on a backdrop press; Escape is taken by the install drawer.
  if (await modal.count()) await win.locator('.palette-backdrop').click({ position: { x: 4, y: 4 } });
  await expect(modal).toHaveCount(0);
  const explorer = win.getByTestId('project-nav-explorer');
  if (!await explorer.count()) await win.getByRole('button', { name: `Open ${name}`, exact: true }).click();
  await explorer.click();
  await expect(win.locator('.tree-row').filter({ hasText: fileName })).toBeVisible({ timeout: 30_000 });
}

async function projectHostId(win: Page, name: string): Promise<string | undefined> {
  const { projects } = await api<{ projects: any[] }>(win, '/projects');
  return projects.find(project => project.name === name)?.hostId;
}

test('Add Machine connects over the persistent tunnel, survives dialog close and relaunch, confines the tunnel, and closes it on removal', async ({ home }) => {
  test.setTimeout(360_000);
  const h = await createHarness(home);
  let app: AppHandle | undefined;
  try {
    app = await launchApp(home, { env: h.env });
    const win = app.window;
    await primaryConnected(win);
    await writeClipboard(app, 'clipboard-sentinel');

    // Scenario 1: one Connect, every stage green, nothing copied.
    const dialog = await openAddMachine(win);
    await dialog.getByTestId('add-machine-connect').click();
    await expectAllStagesPassed(dialog);
    await expect(dialog.getByRole('status')).toContainText('connected', { timeout: 30_000 });
    await expect(dialog.getByTestId('add-machine-connect-error')).toHaveCount(0);
    // The fallback command is laptop-run `ssh -R`, never a bare remote-run installer.
    await expect(dialog.getByTestId('machines-join-command')).not.toContainText(/^curl /);
    expect(await readClipboard(app)).toBe('clipboard-sentinel');
    const log = await dialog.getByTestId('add-machine-connect-log').textContent() ?? '';
    expect(log).toContain('connecting through SSH');
    expect(log).not.toMatch(JOIN_CODE_RE);
    const [machine] = await remoteHosts(win);
    expect(machine?.status).toBe('connected');
    const calls = h.audit();
    expect(calls.map(row => row.kind).filter(kind => kind !== 'other')).toEqual(['tunnel', 'unpack', 'install']);
    expect(calls.every(row => row.home === home)).toBe(true);
    const tunnel = calls.find(row => row.kind === 'tunnel')!;
    expect(tunnel.remotePort).toBeGreaterThanOrEqual(20_000);
    expect(tunnel.remotePort).toBeLessThan(60_000);
    expect(tunnelEntries(h.dataDir)[machine!.id]).toEqual({ remotePort: tunnel.remotePort });

    // Scenario 6: the tunnel reaches only the pairing allowlist, never the product API.
    const productPort = Number(new URL(win.url()).port);
    expect(tunnel.localPort).not.toBe(productPort);
    const remoteOrigin = `http://127.0.0.1:${tunnel.remotePort}`;
    expect((await fetch(`${remoteOrigin}/api/v1/projects`)).status).toBe(403);
    expect((await fetch(`${remoteOrigin}/api/v1/hosts`)).status).toBe(403);
    expect((await fetch(`${remoteOrigin}/install/version`)).status).toBe(200);

    // Scenario 2: closing the dialog leaves the machine connected.
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await win.waitForTimeout(5_000);
    expect((await remoteHosts(win)).find(row => row.id === machine!.id)?.status).toBe('connected');

    // Scenario 3: relaunch reopens the stored tunnel through the primary.
    await closeApp(app.electron);
    app = undefined;
    const before = h.audit().length;
    app = await launchApp(home, { env: h.env });
    await primaryConnected(app.window);
    await expect.poll(async () => (await remoteHosts(app!.window)).find(row => row.id === machine!.id)?.status, { timeout: 90_000 }).toBe('connected');
    const reopened = h.audit().slice(before).filter(row => row.kind !== 'other');
    expect(reopened.map(row => row.kind)).toEqual(['tunnel']);
    expect(reopened[0]!.remotePort).toBe(tunnel.remotePort);
    expect(reopened[0]!.localPort).not.toBe(Number(new URL(app.window.url()).port));
    expect(tunnelEntries(h.dataDir)[machine!.id]).toEqual({ remotePort: tunnel.remotePort });
    expect((await fetch(`${remoteOrigin}/api/v1/projects`)).status).toBe(403);

    // Removing the machine closes the primary's tunnel: the ssh -R process exits
    // and the remote port stops answering.
    const forward = `127.0.0.1:${tunnel.remotePort}:`;
    const tunnelProcess = () => execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8' })
      .split('\n').some(line => line.includes(join(home, 'bin', 'ssh')) && line.includes(forward));
    expect(tunnelProcess()).toBe(true);
    const removed = await app.window.evaluate(async id => (await fetch(`/api/v1/hosts/${id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' } })).status, machine!.id);
    expect(removed).toBe(200);
    await expect.poll(tunnelProcess, { timeout: 15_000 }).toBe(false);
    await expect.poll(() => fetch(`${remoteOrigin}/install/version`).then(() => 'open', () => 'closed'), { timeout: 15_000 }).toBe('closed');
    expect(tunnelEntries(h.dataDir)[machine!.id]).toBeUndefined();
    expect(await remoteHosts(app.window)).toHaveLength(0);
  } finally {
    if (app) await closeApp(app.electron);
    await h.close();
  }
});

test('a taken remote forward port is retried on a new port, and a later project on that host binds without reinstalling', async ({ home }) => {
  test.setTimeout(300_000);
  const h = await createHarness(home);
  const checkout = join(h.remoteHome, 'checkout');
  mkdirSync(checkout);
  writeFileSync(join(checkout, 'remote-marker.txt'), 'remote\n');
  let app: AppHandle | undefined;
  try {
    app = await launchApp(home, { env: h.env });
    const win = app.window;
    await primaryConnected(win);

    // Scenario 4: ExitOnForwardFailure on the first port → automatic retry.
    h.setFlag('reject-next-forward', true);
    const dialog = await openAddMachine(win);
    await dialog.getByTestId('add-machine-connect').click();
    await expectAllStagesPassed(dialog);
    const tunnels = h.audit().filter(row => row.kind === 'tunnel');
    expect(tunnels).toHaveLength(2);
    expect(tunnels[0]!.rejected).toBe(true);
    expect(tunnels[1]!.rejected).toBeUndefined();
    expect(tunnels[1]!.remotePort).not.toBe(tunnels[0]!.remotePort);
    await expect(dialog.getByTestId('add-machine-connect-log')).toContainText(`Port ${tunnels[0]!.remotePort} is busy on the remote machine; trying another`);
    const [machine] = await remoteHosts(win);
    expect(machine?.status).toBe('connected');
    expect(tunnelEntries(h.dataDir)[machine!.id]).toEqual({ remotePort: tunnels[1]!.remotePort });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();

    // Scenario 8 (machine first): the project binds to the enrolled machine, no second install.
    const installsBefore = h.audit().filter(row => row.kind === 'unpack' || row.kind === 'install').length;
    await addRemoteProject(win, 'Tunnel checkout', checkout);
    await captureDrawerLogs(win);
    await composerInstall(win, 'Tunnel checkout');
    await expect.poll(() => capturedDrawerLogs(win), { timeout: 60_000 }).toContain('Reusing the enrolled daemon for this SSH host');
    await expect.poll(() => projectHostId(win, 'Tunnel checkout'), { timeout: 30_000 }).toBe(machine!.id);
    expect(h.audit().filter(row => row.kind === 'unpack' || row.kind === 'install')).toHaveLength(installsBefore);
    expect(await remoteHosts(win)).toHaveLength(1);
    await expectExplorerLists(win, 'Tunnel checkout', 'remote-marker.txt');
  } finally {
    if (app) await closeApp(app.electron);
    await h.close();
  }
});

test('an unavailable installer artifact fails the Installing stage with its marker, and Retry connects', async ({ home }) => {
  test.setTimeout(300_000);
  const h = await createHarness(home);
  let app: AppHandle | undefined;
  try {
    app = await launchApp(home, { env: h.env });
    const win = app.window;
    await primaryConnected(win);

    // Scenario 5.
    h.setFlag('artifact-503', true);
    const dialog = await openAddMachine(win);
    await dialog.getByTestId('add-machine-connect').click();
    const install = dialog.getByTestId('host-install-stage-install');
    await expect(install).toHaveAttribute('data-status', 'failed', { timeout: 120_000 });
    await expect(dialog.getByTestId('host-install-stage-reason-install')).toHaveText('Artifact download failed (HTTP 503)');
    for (const stage of ['ssh', 'tunnel']) await expect(dialog.getByTestId(`host-install-stage-${stage}`)).toHaveAttribute('data-status', 'passed');
    await expect(dialog.getByTestId('host-install-stage-connected')).toHaveCount(0);
    const rawLog = dialog.getByTestId('add-machine-connect-log');
    await rawLog.locator('summary').click();
    await expect(rawLog.locator('pre')).toBeVisible();
    await expect(rawLog).toContainText('zcc-install: artifact-unavailable status=503');
    expect(await rawLog.textContent()).not.toMatch(JOIN_CODE_RE);
    await expect(dialog.getByTestId('add-machine-connect-error')).toBeVisible();
    const retry = dialog.getByTestId('host-install-retry');
    await expect(retry).toBeVisible();
    expect(await remoteHosts(win)).toHaveLength(0);

    // Retry re-runs in place once the artifact is available again.
    h.setFlag('artifact-503', false);
    await retry.click();
    await expectAllStagesPassed(dialog);
    await expect(dialog.getByTestId('add-machine-connect-error')).toHaveCount(0);
    await expect.poll(async () => (await remoteHosts(win)).map(row => row.status)).toEqual(['connected']);
  } finally {
    if (app) await closeApp(app.electron);
    await h.close();
  }
});

test('a remote project with no public URL installs from the composer over the tunnel, and Add Machine then reuses it', async ({ home }) => {
  test.setTimeout(300_000);
  const h = await createHarness(home);
  const checkout = join(h.remoteHome, 'checkout');
  mkdirSync(checkout);
  writeFileSync(join(checkout, 'remote-marker.txt'), 'remote\n');
  let app: AppHandle | undefined;
  try {
    app = await launchApp(home, { env: h.env });
    const win = app.window;
    await primaryConnected(win);

    // Scenario 7.
    await addRemoteProject(win, 'Tunnel project', checkout);
    // A fast install can finish and auto-close the drawer before its log toggle is
    // clickable, so read stages and log from what the drawer rendered, not from it staying mounted.
    await captureDrawerLogs(win, { expand: true });
    const { modal } = await composerInstall(win, 'Tunnel project');
    await expect.poll(() => capturedDrawerStages(win), { timeout: 120_000 })
      .toEqual(Object.fromEntries(STAGES.map(([stage]) => [stage, 'passed'])));
    await expect.poll(() => capturedDrawerLogs(win), { timeout: 30_000 }).toContain('connecting through SSH');
    const drawerLogText = await capturedDrawerLogs(win);
    expect(drawerLogText).not.toContain('public_url_required');
    expect(drawerLogText).not.toMatch(/relay_/);
    expect(drawerLogText).not.toMatch(JOIN_CODE_RE);
    const [machine] = await remoteHosts(win);
    expect(machine?.status).toBe('connected');
    await expect.poll(() => projectHostId(win, 'Tunnel project'), { timeout: 30_000 }).toBe(machine!.id);
    await expect(modal.getByTestId('composer-host-action')).toHaveCount(0);
    expect(h.audit().map(row => row.kind).filter(kind => kind !== 'other')).toEqual(['tunnel', 'unpack', 'install']);
    expect(tunnelEntries(h.dataDir)[machine!.id]?.remotePort).toBe(h.audit().find(row => row.kind === 'tunnel')!.remotePort);
    await expectExplorerLists(win, 'Tunnel project', 'remote-marker.txt');

    // Scenario 8 (project first): Add Machine on the same host reuses the machine.
    const callsBefore = h.audit().filter(row => row.kind !== 'other').length;
    const dialog = await openAddMachine(win);
    await dialog.getByTestId('add-machine-connect').click();
    await expect(dialog.getByRole('status')).toContainText('connected', { timeout: 60_000 });
    await expect(dialog.getByTestId('add-machine-connect-log')).toContainText('This machine is already connected.');
    await expect(dialog.getByTestId('add-machine-connect-error')).toHaveCount(0);
    expect(h.audit().filter(row => row.kind !== 'other')).toHaveLength(callsBefore);
    expect((await remoteHosts(win)).map(row => row.id)).toEqual([machine!.id]);
  } finally {
    if (app) await closeApp(app.electron);
    await h.close();
  }
});
