import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, upsertHost } from '../packages/db/src/index.js';

for (const bound of [false, true]) {
  test(`CLI Agent requires remote discovery while the existing SSH terminal backend remains available (${bound ? 'bound disconnected host' : 'no host binding'})`, async ({ home }) => {
    test.setTimeout(120_000);
    const remoteId = randomUUID(), data = join(home, '.zcc');
    const remoteHome = join(home, 'remote-home'), checkout = join(remoteHome, 'checkout');
    const remoteBin = join(remoteHome, 'bin'), bin = join(home, 'bin');
    for (const dir of [data, checkout, remoteBin, bin]) mkdirSync(dir, { recursive: true });
    const audit = join(home, 'ssh.jsonl'), launched = join(home, 'launched.jsonl');
    const failure = join(home, 'fail-launch');
    // Discovery speaks the actual SDK protocol; the interactive path records
    // argv/HOME/cwd and stays alive without invoking a real model.
    writeFileSync(join(remoteBin, 'claude'), `#!${process.execPath}
const fs=require('node:fs');
if(process.argv.includes('--version')||process.argv.includes('--input-format')){require(${JSON.stringify(resolve('e2e/fixtures/claude-model-cli.cjs'))});}
else {
 fs.appendFileSync(${JSON.stringify(launched)},JSON.stringify({pid:process.pid,args:process.argv.slice(2),home:process.env.HOME,cwd:process.cwd()})+'\\n');
 process.stdout.write('SSH terminal output '.repeat(2000)+' COMPLETE-SSH-OUTPUT\\n');
 if(fs.existsSync(${JSON.stringify(failure)})) process.exit(23);
 setInterval(()=>{},1000);
}
`, { mode: 0o700 });
    writeFileSync(join(bin, 'ssh'), `#!${process.execPath}
const fs=require('node:fs'),{spawn}=require('node:child_process');
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(audit)},JSON.stringify({args,home:process.env.HOME,cwd:process.cwd()})+'\\n');
const child=spawn('/bin/sh',['-c',args.at(-1)],{env:{...process.env,HOME:${JSON.stringify(remoteHome)},PATH:${JSON.stringify(remoteBin)}+':/usr/bin:/bin'},stdio:'inherit'});
child.on('exit',code=>process.exit(code??1));
for(const signal of ['SIGTERM','SIGHUP','SIGINT']) process.on(signal,()=>{child.kill(signal);process.exit(0);});
`, { mode: 0o700 });
    const loginShell = join(bin, 'login-shell');
    writeFileSync(loginShell, '#!/bin/sh\nprintf "__ZCC_PATH_START__%s__ZCC_PATH_END__" "$PATH"\n', { mode: 0o700 });
    if (bound) {
      const db = openDatabase(join(data, 'zcc.sqlite'));
      upsertHost(db, { id: remoteId, name: 'SSH box', hostKeyHash: 'b'.repeat(64), isPrimary: false });
      db.close();
    }
    writeFileSync(join(data, 'projects.json'), JSON.stringify([{ id: 'ssh-project', name: 'SSH project',
      path: join(home, 'nonexistent-placeholder'), ...(bound ? { hostId: remoteId } : {}),
      remote: { host: 'ssh-fixture', user: 'fixture', proxyJump: 'bastion-fixture', remotePath: checkout }, createdAt: 1, lastActiveAt: 1 }]));
    const app = await launchApp(home, { allowLiveClaude: true,
      env: { PATH: `${bin}:${remoteBin}:${process.env.PATH}`, SHELL: loginShell, ZDOTDIR: home },
      initialConfig: { lastProjectId: 'ssh-project', defaultHarness: 'claude', claudeBinary: join(remoteBin, 'claude'),
        tmuxScope: 'off', remoteMcpEnabled: false } });
    try {
      const win = app.window;
      win.setDefaultTimeout(30_000);
      await win.getByRole('button', { name: 'Open SSH project', exact: true }).click();
      await win.getByTestId('agents-board-new-thread').click();
      const modal = win.getByTestId('launch-modal');
      await modal.getByRole('button', { name: 'CLI Agent', exact: true }).click();
      await expect(modal.getByTestId('composer-host-action')).toBeVisible();
      await expect(modal.getByRole('button', { name: 'Machine', exact: true })).toHaveCount(0);
      await expect(modal.getByTestId('legacy-agent-command-send')).toBeDisabled();
      await expect(modal.getByTestId('legacy-agent-command-input')).toBeVisible();
      if (bound) {
        const rejected = await win.evaluate(async () => {
          const response = await fetch('/api/v1/cli-agents', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ projectId: 'ssh-project', profile: 'claude', prompt: 'remote task',
              harnessRouting: { schemaVersion: 1, byAdapter: { claude: { modelTargetId: 'claude-opus-5-5[1m]' } } } }) });
          return { status: response.status, body: await response.json() };
        });
        expect(rejected.status, JSON.stringify(rejected.body)).not.toBe(201);
        expect(rejected.body.code).toBe('DENIED');
        expect(existsSync(launched)).toBe(false);
        return;
      }
      await modal.getByTestId('legacy-agent-command-input').fill('remote task with spaces');
      const direct = await win.evaluate(() => window.cc.terminals.create({
        projectId: 'ssh-project', profile: 'claude', cols: 80, rows: 24, prompt: 'remote task with spaces'
      }));
      expect(direct, JSON.stringify(direct)).toMatchObject({ ok: true });
      await expect.poll(() => existsSync(launched)).toBe(true);
      const launch = JSON.parse(readFileSync(launched, 'utf8').trim());
      expect(launch).toMatchObject({ home: remoteHome, cwd: realpathSync(checkout) });
      expect(launch.args).toContain('remote task with spaces');
      const sessions = await win.evaluate(() => window.cc.terminals.list('ssh-project'));
      expect(sessions).toHaveLength(1);
      const session = sessions[0]!;
      expect(session.cwd).toBe(checkout);
      expect(session.profile).toBe('claude');
      await expect.poll(() => win.evaluate(id => window.cc.terminals.backlog(id), session.id)).toContain('COMPLETE-SSH-OUTPUT');
      const ssh = readFileSync(audit, 'utf8').trim().split('\n').map(row => JSON.parse(row));
      const interactive = ssh.find(row => row.args.includes('-t'));
      expect(interactive.home).toBe(home);
      expect(interactive.args).toEqual(expect.arrayContaining(['-J', 'bastion-fixture', 'fixture@ssh-fixture']));
      expect(interactive.args.at(-1)).toContain(checkout);
      expect(ssh.some(row => row.args.join(' ').includes('host-installer'))).toBe(false);
      await win.evaluate(id => window.cc.terminals.close(id), session.id);
      // HTTP uses the same SSH exception and still returns the real remote PTY.
      writeFileSync(failure, 'fail');
      await win.evaluate(() => {
        const fixture = window as unknown as { sshFixtureExits: { id: string; code: number }[]; stopSshFixtureExits: () => void };
        fixture.sshFixtureExits = [];
        fixture.stopSshFixtureExits = window.cc.terminals.onExit((id, code) => fixture.sshFixtureExits.push({ id, code }));
      });
      const failed = await win.evaluate(async hostId => {
        const response = await fetch('/api/v1/cli-agents', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId: 'ssh-project', profile: 'claude', ...(hostId ? { hostId } : {}), prompt: 'failing remote task' }) });
        return { status: response.status, body: await response.json() };
      }, bound ? remoteId : undefined);
      expect(failed.status, JSON.stringify(failed.body)).toBe(201);
      const failedId = failed.body.agent.id;
      await expect.poll(() => win.evaluate(id =>
        (window as unknown as { sshFixtureExits: { id: string; code: number }[] }).sshFixtureExits.find(row => row.id === id)?.code,
      failedId)).toBe(23);
      await win.evaluate(() => (window as unknown as { stopSshFixtureExits: () => void }).stopSshFixtureExits());
      expect(await win.evaluate(() => window.cc.terminals.list('ssh-project'))).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: failedId })]));
    } finally {
      if (existsSync(launched)) for (const row of readFileSync(launched, 'utf8').trim().split('\n')) {
        try { process.kill(JSON.parse(row).pid, 'SIGTERM'); } catch { /* Already exited. */ }
      }
      await closeApp(app.electron);
    }
  });
}
