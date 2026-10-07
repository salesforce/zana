import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { createServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { openDatabase, upsertHost, updateHostSshIdentity } from '../packages/db/src/index.js';

for (const { bound, agentDefault } of [
  { bound: false, agentDefault: false },
  { bound: true, agentDefault: false },
  { bound: true, agentDefault: true }
]) {
test(`CLI Agent ${bound ? 'repairs' : 'installs'} the remote daemon, uses its catalog and launches SSH from this machine${agentDefault ? ' with Agent default' : ''}`, async ({ home }) => {
  test.setTimeout(180_000);
  let remoteId = randomUUID();
  const serverId = randomUUID(), remoteHome = join(home, 'remote-home');
  const workspace = join(remoteHome, 'checkout'), remoteData = join(remoteHome, '.zcc');
  mkdirSync(remoteData, { recursive: true }); mkdirSync(workspace);
  const bin = join(home, 'bin'); mkdirSync(bin);
  // Make the Electron login-PATH probe deterministic as well as launch PATH.
  const loginShell = join(bin, 'login-shell');
  writeFileSync(loginShell, `#!/bin/sh\nprintf '__ZCC_PATH_START__%s__ZCC_PATH_END__' "$PATH"\n`, { mode: 0o700 });
  const audit = join(home, 'ssh-audit.jsonl'), failure = join(home, 'ssh-failure');
  writeFileSync(join(bin, 'ssh'), `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(audit)}, JSON.stringify({args:process.argv.slice(2),home:process.env.HOME,cwd:process.cwd()})+'\\n');
if(process.argv.includes('-t')) {
 const {spawn}=require('node:child_process');
 const child=spawn('/bin/sh',['-c',process.argv.at(-1)],{env:{...process.env,HOME:${JSON.stringify(remoteHome)},PATH:${JSON.stringify(join(remoteHome, 'bin'))}+':'+process.env.PATH},stdio:'inherit'});
 child.on('exit',code=>process.exit(code??1));
 for(const signal of ['SIGTERM','SIGHUP','SIGINT']) process.on(signal,()=>{child.kill(signal);process.exit(0);});
} else {
process.stdout.write('Connect install log '.repeat(3000)+' COMPLETE-CONNECT-LOG\\n',()=>process.exit(fs.existsSync(${JSON.stringify(failure)})?1:0));
}
`, { mode: 0o700 });
  const remoteBin = join(remoteHome, 'bin'); mkdirSync(remoteBin);
  symlinkSync(resolve('e2e/fixtures/claude-model-cli.cjs'), join(remoteBin, 'claude'));
  symlinkSync(resolve('e2e/fixtures/bin/opencode'), join(remoteBin, 'opencode'));
  writeFileSync(join(remoteData, 'config.json'), JSON.stringify({ version: 1, theme: 'dark',
    harnessOpenCodeEnabled: true, nativeAgentDiscoveryEnabled: true, opencodeBinary: join(remoteBin, 'opencode') }));
  const remoteShell = `export PATH='${remoteBin}':"$PATH"\n`;
  for (const file of ['.zshrc', '.bashrc', '.bash_profile']) writeFileSync(join(remoteHome, file), remoteShell);
  const dataDir = join(home, '.zcc'); mkdirSync(dataDir, { recursive: true });
  const db = openDatabase(join(dataDir, 'zcc.sqlite'));
  if (bound) {
    upsertHost(db, { id: remoteId, name: 'Remote fixture', hostKeyHash: 'b'.repeat(64), isPrimary: false });
    updateHostSshIdentity(db, remoteId, { host: 'remote-fixture' });
  }
  db.close();
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify([{ id: 'remote-fixture', name: 'Remote fixture', path: join(home, 'placeholder'), ...(bound ? { hostId: remoteId } : {}), remote: { host: 'remote-fixture', remotePath: workspace }, createdAt: 1, lastActiveAt: 1 }]));
  const cert = join(home, 'cert.pem'), key = join(home, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  let app: Awaited<ReturnType<typeof launchApp>> | undefined, child: ChildProcess | undefined;
  let origin = '', account = '', enrollmentCalls = 0;
  const unpack = join(remoteHome, 'runtime'); mkdirSync(unpack);
  const portServer = createHttpServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
  const remotePort = (portServer.address() as { port: number }).port;
  await new Promise<void>(resolve => portServer.close(() => resolve()));
  const edge = createServer({ cert: readFileSync(cert), key: readFileSync(key) }, async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (req.url !== '/api/connect/hosts/code' || typeof body.hostId !== 'string' || (bound && body.hostId !== remoteId)) { res.writeHead(400); res.end(); return; }
    remoteId = body.hostId;
    enrollmentCalls++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ serverId, hostId: remoteId, serverUrl: 'https://machine.example', code: 'ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD', expiresAt: Date.now() + 60_000 }));
    if (!child) child = spawn(process.execPath, [join(unpack, 'join.mjs'), 'join', '--join-code', body.enrollToken, '--host-id', remoteId, '--server-url', origin, '--host-daemon-port', String(remotePort)], {
      cwd: workspace, detached: true, stdio: 'ignore', env: { ...process.env, HOME: remoteHome, ZCC_DATA_DIR: remoteData, PATH: `${remoteBin}:${process.env.PATH}`, ZDOTDIR: remoteHome, SHELL: '/bin/zsh',
        FAKE_ACP_MODEL_CONFIG: agentDefault ? '0' : '1', FAKE_ACP_MODE_CONFIG: '1', FAKE_ACP_MODE_OPTIONS: 'build:Build,plan:Plan,reviewer:Reviewer' }
    });
  });
  edge.listen(0, '127.0.0.1'); await once(edge, 'listening');
  account = `https://127.0.0.1:${(edge.address() as { port: number }).port}`;
  mkdirSync(join(dataDir, 'mobile'));
  writeFileSync(join(dataDir, 'mobile/connection.json'), JSON.stringify({ mode: 'connect', accountUrl: account, publicUrl: 'https://machine.example', serverId, relayToken: 'a'.repeat(43) }), { mode: 0o600 });
  try {
    app = await launchApp(home, { caCertPath: cert, allowLiveClaude: true,
      env: { PATH: `${bin}:${process.env.PATH}`, SHELL: loginShell, ZDOTDIR: home },
      initialConfig: { lastProjectId: 'remote-fixture', defaultHarness: 'claude', claudeBinary: join(home, 'missing-local-claude'),
        harnessOpenCodeEnabled: false, opencodeBinary: join(home, 'missing-local-opencode'), nativeAgentDiscoveryEnabled: true,
        tmuxScope: 'off', remoteMcpEnabled: false,
        ...(agentDefault ? { harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'obsolete/global-model' } } } } : {}) } });
    expect(await app.electron.evaluate(() => process.env.PATH)).toContain(bin);
    const win = app.window; win.setDefaultTimeout(15_000); origin = new URL(win.url()).origin;
    const artifact = await fetch(`${origin}/install/zcc-host.tgz`);
    expect(artifact.status).toBe(200);
    const tarball = join(home, 'host.tgz'); writeFileSync(tarball, Buffer.from(await artifact.arrayBuffer()));
    execFileSync('tar', ['-xzf', tarball, '-C', unpack]);
    await win.getByRole('button', { name: 'Open Remote fixture', exact: true }).click();
    await win.getByTestId('agents-board-new-thread').click();
    const modal = win.getByTestId('launch-modal');
    await modal.getByRole('button', { name: 'CLI Agent', exact: true }).click();
    await expect(modal.getByTestId('legacy-agent-command-send')).toBeDisabled();
    await expect(modal.getByRole('button', { name: 'Machine', exact: true })).toHaveCount(0);
    await expect(modal.getByTestId('composer-host-action')).toBeVisible();
    await modal.getByTestId('composer-host-action').click();
    await expect.poll(() => existsSync(audit), { timeout: 15_000 }).toBe(true);
    const drawer = win.getByTestId('host-install-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId('host-install-log')).toContainText('COMPLETE-CONNECT-LOG', { timeout: 30_000 });
    await expect(modal.getByTestId('composer-host-action')).toHaveCount(0, { timeout: 30_000 });
    const catalog = await win.evaluate(async () => (await fetch('/api/v1/system/execution-options?providerId=claude-code&projectId=remote-fixture')).json());
    expect(catalog.modelLoadError, JSON.stringify(catalog.modelLoadError)).toBeNull();
    expect(catalog.models).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'claude-opus-5-5[1m]', displayName: 'Opus 5.5 (1M)' })]));
    await expect(modal.getByTestId('legacy-agent-command-input')).toBeVisible();
    if (await drawer.isVisible()) await drawer.getByRole('button', { name: 'Close install log' }).click();
    await modal.getByTestId('model-reasoning-picker-trigger').click();
    await expect(win.getByTestId('model-reasoning-model-claude-opus-5-5[1m]')).toBeVisible();
    await win.getByTestId('model-reasoning-model-claude-opus-5-5[1m]').click();
    expect(enrollmentCalls).toBe(1);
    const calls = readFileSync(audit, 'utf8').trim().split('\n').map(row => JSON.parse(row));
    expect(calls).toHaveLength(1);
    expect(calls[0].home).toBe(home);
    expect(calls[0].args.join(' ')).toContain('/api/connect/host-installer');
    expect(calls[0].args.join(' ')).not.toContain('--join-code');
    await expect(modal.getByRole('button', { name: 'Machine', exact: true })).toHaveCount(0);
    await expect(modal.getByTestId('legacy-agent-command-send')).toBeEnabled();
    await modal.getByTestId('legacy-agent-command-input').fill('CLI on the installed daemon project');
    await modal.getByTestId('legacy-agent-command-send').click();
    await expect(modal).toHaveCount(0);
    const sessions = await win.evaluate(() => window.cc.terminals.list('remote-fixture'));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].cwd).toBe(workspace);
    await expect.poll(() => readFileSync(audit, 'utf8')).toContain('"-t"');
    const sshLaunch = readFileSync(audit, 'utf8').trim().split('\n').map(row => JSON.parse(row)).find(row => row.args.includes('-t'));
    expect(sshLaunch.home).toBe(home);
    expect(sshLaunch.args.at(-1)).toContain('claude-opus-5-5[1m]');
    expect(await win.evaluate(async id => (await fetch('/api/v1/hosts').then(res => res.json())).find((host: any) => host.id === id)?.status, remoteId)).toBe('connected');
    await win.evaluate(id => window.cc.terminals.close(id), sessions[0].id);
    if (bound) {
      const agentWindow = win.getByTestId('agent-terminal-modal');
      await agentWindow.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(agentWindow).toHaveCount(0);
      await win.getByTestId('agents-board-new-thread').click();
      const second = win.getByTestId('launch-modal');
      await second.getByRole('button', { name: 'CLI Agent', exact: true }).click();
      await second.getByTestId('model-reasoning-picker-trigger').click();
      await win.getByTestId('model-reasoning-provider-acp-opencode').click();
      await second.getByTestId('model-reasoning-picker-trigger').click();
      // Provider discovery and host reconnects can settle independently. Wait
      // for the launch catalog before interacting with its native role menu.
      await expect(second.getByTestId('legacy-agent-command-send')).toBeEnabled({ timeout: 30_000 });
      if (agentDefault) {
        await expect(second.getByTestId('model-reasoning-picker-trigger')).toContainText('Agent default');
      } else {
        await second.getByTestId('composer-mode-picker-trigger').click();
        await win.getByRole('listbox', { name: 'Composer mode' }).getByRole('option', { name: 'Reviewer', exact: true }).click();
      }
      await expect(second.getByRole('button', { name: 'Machine', exact: true })).toHaveCount(0);
      await second.getByTestId('legacy-agent-command-input').fill(agentDefault ? 'hello' : 'Run a remote native role');
      await second.getByTestId('legacy-agent-command-send').click();
      await expect(second).toHaveCount(0);
      const sshCalls = () => readFileSync(audit, 'utf8').trim().split('\n')
        .map(row => JSON.parse(row)).filter(row => row.args.includes('-t'));
      await expect.poll(() => sshCalls().length).toBe(2);
      const roleLaunch = sshCalls()[1];
      expect(roleLaunch.home).toBe(home);
      // Non-Claude CLIs run inside the remote login shell; decode its quoted
      // inner command before inspecting the structured role arguments.
      const roleCommand = roleLaunch.args.at(-1).replaceAll("'\\''", "'");
      if (agentDefault) expect(roleCommand).not.toContain('--agent');
      else expect(roleCommand).toContain("'--agent' 'reviewer'");
      expect(roleCommand).not.toContain('--model');
      expect(roleCommand).not.toContain('acp-default');
      expect(roleCommand).not.toContain('obsolete/global-model');
      await expect(win.getByTestId('agent-modal-state')).toHaveAttribute('data-state', 'working');
      const roleSessions = await win.evaluate(() => window.cc.terminals.list('remote-fixture'));
      expect(roleSessions).toHaveLength(1);
      expect(roleSessions[0].profile).toBe('opencode');
      expect(roleSessions[0].cwd).toBe(workspace);
      await win.evaluate(id => window.cc.terminals.close(id), roleSessions[0].id);
    }
    // Failed SSH installs also cross the production HTTP → host → process seam.
    writeFileSync(failure, 'fail');
    const failed = await win.evaluate(async id => (await fetch(`/api/v1/hosts/${id}/repair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).text(), remoteId);
    expect(failed).toContain('COMPLETE-CONNECT-LOG');
    expect(failed).toContain('"type":"error"');
  } finally {
    if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]); try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    if (app) await closeApp(app.electron); edge.closeAllConnections(); await new Promise<void>(resolve => edge.close(() => resolve()));
  }
});
}
