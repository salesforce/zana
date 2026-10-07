import { test, expect, launchApp } from './fixtures/app.js';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { openDatabase, upsertHost, updateHostSshIdentity } from '../packages/db/src/index.js';

const liveHost = process.env.ZCC_LIVE_SSH_HOST;
test('blocked HTTPS recovers through an owned SSH tunnel at the built Electron boundary', async ({ home }) => {
  test.setTimeout(180_000);
  const remoteId = randomUUID(), serverId = randomUUID(), remoteHome = join(home, 'remote-home');
  const remote = liveHost || 'tunnel-fixture', bin = join(home, 'bin'), dataDir = join(home, '.zcc');
  mkdirSync(bin); mkdirSync(dataDir, { recursive: true }); mkdirSync(remoteHome);
  const remoteBin = join(remoteHome, 'bin'); mkdirSync(remoteBin);
  symlinkSync(process.execPath, join(remoteBin, 'node'));
  writeFileSync(join(remoteBin, 'uname'), '#!/bin/sh\necho Linux\n', { mode: 0o700 });
  writeFileSync(join(remoteBin, 'systemctl'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const audit = join(home, 'ssh-audit.jsonl');
  const loginShell = join(bin, 'login-shell');
  writeFileSync(loginShell, '#!/bin/sh\nprintf "__ZCC_PATH_START__%s__ZCC_PATH_END__" "$PATH"\n', { mode: 0o700 });
  // Deterministic mode executes the real unpack/install scripts in another HOME
  // and forwards TCP, including WebSocket, just as ssh -R does. Opt-in pony mode
  // uses its real SSH config and tests its blocked public HTTPS destination.
  writeFileSync(join(bin, 'ssh'), `#!${process.execPath}
const fs=require('node:fs'),net=require('node:net'),{spawn}=require('node:child_process');
const args=process.argv.slice(2),cmd=args.at(-1),live=${JSON.stringify(liveHost || '')};
fs.appendFileSync(${JSON.stringify(audit)},JSON.stringify({kind:cmd.includes('/api/connect/host-installer')?'connect':args.includes('-R')?'tunnel':cmd.includes('tar -xzf')?'unpack':'install',home:process.env.HOME,cwd:process.cwd()})+'\\n');
if(live){
  const argv=['-F',${JSON.stringify(join(homedir(), '.ssh/config'))},'-o','ControlPath=none',...args];
  if(cmd.includes('/api/connect/host-installer')) argv[argv.length-1]='curl --proto "=https" -fsS --connect-timeout 10 --max-time 20 https://zana-ide.com/api/connect/host-installer -o /dev/null';
  const p=spawn('/usr/bin/ssh',argv,{env:{...process.env,HOME:${JSON.stringify(homedir())},SHELL:'/bin/zsh'},stdio:'inherit'});
  p.on('exit',code=>process.exit(code??1));
}else if(cmd.includes('/api/connect/host-installer')){
  process.stderr.write('curl: (35) error:0A0000C6:SSL routines::packet length too long\\n',()=>process.exit(35));
}else if(args.includes('-R')){
  const [,port,,targetPort]=args[args.indexOf('-R')+1].split(':');
  net.createServer(socket=>{const upstream=net.connect(Number(targetPort),'127.0.0.1');socket.pipe(upstream).pipe(socket);socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());}).listen(Number(port),'127.0.0.1',()=>process.stdout.write('ZCC-PEER-TUNNEL-READY\\n'));
}else{
  const p=spawn('/bin/sh',['-c',cmd],{env:{...process.env,HOME:${JSON.stringify(remoteHome)},PATH:${JSON.stringify(remoteBin)}+':/usr/bin:/bin',ZCC_NODE:${JSON.stringify(process.execPath)}},stdio:'inherit'});
  p.on('exit',code=>process.exit(code??1));
}
`, { mode: 0o700 });
  const db = openDatabase(join(dataDir, 'zcc.sqlite'));
  upsertHost(db, { id: remoteId, name: 'Blocked remote', hostKeyHash: 'b'.repeat(64), isPrimary: false });
  updateHostSshIdentity(db, remoteId, { host: remote }); db.close();
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify([{ id: 'blocked-remote', name: 'Blocked remote', path: join(home, 'placeholder'), hostId: remoteId,
    remote: { host: remote, remotePath: liveHost ? '/home/sfwork' : remoteHome }, createdAt: 1, lastActiveAt: 1 }]));
  const cert = join(home, 'cert.pem'), key = join(home, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  const edge = createServer({ cert: readFileSync(cert), key: readFileSync(key) }, async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    expect(body.hostId).toBe(remoteId);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ serverId, hostId: remoteId, serverUrl: 'https://machine.example', code: 'ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD', expiresAt: Date.now() + 60_000 }));
  });
  edge.listen(0, '127.0.0.1'); await once(edge, 'listening');
  const accountUrl = `https://127.0.0.1:${(edge.address() as { port: number }).port}`;
  mkdirSync(join(dataDir, 'mobile'));
  writeFileSync(join(dataDir, 'mobile/connection.json'), JSON.stringify({ mode: 'connect', accountUrl, publicUrl: 'https://machine.example', serverId, relayToken: 'a'.repeat(43) }), { mode: 0o600 });
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    app = await launchApp(home, { caCertPath: cert, env: { PATH: `${bin}:${process.env.PATH}`, SHELL: loginShell, ZDOTDIR: home } });
    const win = app.window;
    await win.getByRole('button', { name: 'Open Blocked remote', exact: true }).click();
    await win.getByTestId('agents-board-new-thread').click();
    const modal = win.getByTestId('launch-modal');
    await modal.getByRole('button', { name: 'Modern', exact: true }).click();
    await modal.getByTestId('composer-host-action').click();
    const drawer = win.getByTestId('host-install-drawer');
    await expect(drawer.getByTestId('host-install-log')).toContainText('Public HTTPS is unavailable', { timeout: liveHost ? 90_000 : 45_000 });
    await expect(drawer.getByTestId('host-install-log')).toContainText('Host daemon connected.', { timeout: 90_000 });
    await expect.poll(async () => win.evaluate(async id => {
      const hosts = await (await fetch('/api/v1/hosts')).json(); return hosts.find((h: any) => h.id === id)?.status;
    }, remoteId)).toBe('connected');
    await expect(modal.getByTestId('composer-host-action')).toHaveCount(0);
    const calls = readFileSync(audit, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(calls.map(row => row.kind)).toEqual(['connect', 'tunnel', 'unpack', 'install']);
    expect(calls.every(row => row.home === home)).toBe(true);
  } finally {
    await app?.electron.close();
    // Only the fresh UUID installation belongs to this test. Never touch the
    // user's enrolled machine or ~/.zcc on either computer.
    const cleanup = `d="$HOME/.zcc-machines/ssh-${remoteId}"; if [ -f "$d/host-daemon.pid" ]; then pid=$(cat "$d/host-daemon.pid"); case "$(ps -p "$pid" -o command= 2>/dev/null)" in *"$d/runtime/join.mjs"*) kill "$pid" 2>/dev/null || true ;; esac; fi; systemctl --user disable --now zcc-host-daemon-ssh-${remoteId}.service 2>/dev/null || true; rm -f "$HOME/.config/systemd/user/zcc-host-daemon-ssh-${remoteId}.service"; if [ -f "$d/host-daemon.port" ]; then port=$(cat "$d/host-daemon.port"); case "$port" in ''|*[!0-9]*) ;; *) reservation="$HOME/.zcc-machines/host-daemon-ports/$port"; if [ "$(cat "$reservation" 2>/dev/null)" = "$d" ]; then rm -f "$reservation"; fi ;; esac; fi; rm -rf "$d"`;
    if (liveHost) execFileSync('/usr/bin/ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', liveHost, cleanup], { timeout: 30000, stdio: 'ignore' });
    else {
      const pidFile = join(remoteHome, `.zcc-machines/ssh-${remoteId}/host-daemon.pid`);
      if (existsSync(pidFile)) { try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGTERM'); } catch {} }
    }
    edge.closeAllConnections(); await new Promise<void>(resolve => edge.close(() => resolve()));
  }
});
