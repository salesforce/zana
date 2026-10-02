import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSystemPeerDaemonSsh,
  parsePeerDaemonStatusOutput,
  peerDaemonInstall,
  peerDaemonLogs,
  peerDaemonRestart,
  peerDaemonStatus,
  peerInstallServiceCommand,
  peerLogDumpCommand,
  peerRestartCommand,
  peerStatusCommand,
  peerUnpackCommand,
  type PeerDaemonSsh
} from './peer-daemon.js';
import { HostCommandError } from './host-command-error.js';
import { sshBaseArgs } from './remote-fs.js';

function mockSsh(handler: (cmd: string) => { code: number; stdout?: string; stderr?: string }): PeerDaemonSsh {
  const commands: string[] = [];
  return {
    commands,
    async run(_remote, remoteCmd) {
      commands.push(remoteCmd);
      const result = handler(remoteCmd);
      return { code: result.code, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    },
    async pipeFile(_remote, remoteCmd) {
      commands.push(remoteCmd);
      const result = handler(remoteCmd);
      return { code: result.code, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    }
  } as PeerDaemonSsh & { commands: string[] };
}

describe('peer-daemon commands', () => {
  it('refuses a flag-shaped or invalid server host', () => {
    expect(() => peerStatusCommand('-oProxyCommand=x')).toThrow(/valid hostname/);
    expect(() => peerRestartCommand('box;rm')).toThrow(/valid hostname/);
    expect(() => peerUnpackCommand('box/../etc')).toThrow(/valid hostname/);
  });

  it('quotes join secrets in the install script', () => {
    const script = peerInstallServiceCommand({
      serverHost: 'machine.example.com',
      joinCode: "zcde_abc'def",
      hostId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      serverUrl: 'https://machine.example.com'
    });
    expect(script).toContain(`join_code='zcde_abc'\\''def'`);
    expect(script).toContain('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(script).not.toContain('--join-code zcde_');
    expect(script).toContain('ai.zana.zcc-host-daemon.machine.example.com');
    expect(script).toContain('/nix/store/*-nodejs-22.*/bin/node');
    expect(script).toContain('nohup "$node_bin" "$join_bin" join');
    expect(script).toContain('host-daemon.pid');
    expect(script).toContain('kill "$old_pid"');
    expect(script).toContain('existing_id=$(tr -d "[:space:]" < "$data_dir/host.id")');
    expect(script).toContain('rm -f "$data_dir/host.id" "$data_dir/auth.json"');
    expect(script).toContain('systemctl --user show-environment');
    expect(script).toContain('No systemd user bus');
    expect(script).toContain('host daemon did not report connected');
    expect(script).toContain('--- host-daemon.log ---');
    expect(script).toContain('tail -n 80 "$data_dir/host-daemon.log"');
    expect(script).toContain('status endpoint unreachable');
  });

  it('tails remote status and join logs after HostHub never attaches', async () => {
    expect(() => peerLogDumpCommand('-oProxyCommand=x')).toThrow(/valid hostname/);
    const dump = peerLogDumpCommand('box.example');
    expect(dump).toContain('--- /status ---');
    expect(dump).toContain('--- host-daemon.log ---');
    expect(dump).toContain('tail -n 80 "$data_dir/host-daemon.log"');
    const ssh = mockSsh(() => ({ code: 0, stdout: '--- host-daemon.log ---\njoined\n' }));
    await expect(peerDaemonLogs(ssh, { host: 'devbox' }, 'box.example')).resolves.toEqual({
      log: '--- host-daemon.log ---\njoined'
    });
  });

  it('keeps ssh argv BatchMode and rejects a leading-dash remote host', () => {
    const args = sshBaseArgs({ host: 'devbox', user: 'me' });
    expect(args).toContain('BatchMode=yes');
    expect(args.at(-1)).toBe('me@devbox');
    expect(() => sshBaseArgs({ host: '-evil' })).toThrow(/refusing ssh host/);
  });

  it('maps status exit codes', async () => {
    expect(peerStatusCommand('box.example')).toContain('host.id');
    const ssh = mockSsh(() => ({ code: 2, stdout: 'not_installed\n' }));
    await expect(peerDaemonStatus(ssh, { host: 'devbox' }, 'box.example')).resolves.toMatchObject({
      state: 'not_installed'
    });
    const leftover = mockSsh(() => ({
      code: 2,
      stdout: 'not_installed 11111111-1111-4111-8111-111111111111\n'
    }));
    await expect(peerDaemonStatus(leftover, { host: 'devbox' }, 'box.example')).resolves.toEqual({
      state: 'not_installed',
      hostId: '11111111-1111-4111-8111-111111111111',
      message: 'not_installed 11111111-1111-4111-8111-111111111111'
    });
    const connected = mockSsh(() => ({ code: 0, stdout: 'connected\n' }));
    await expect(peerDaemonStatus(connected, { host: 'devbox' }, 'box.example')).resolves.toEqual({
      state: 'connected'
    });
  });

  it('parses a leftover host id from status stdout', () => {
    expect(parsePeerDaemonStatusOutput('not_installed dd727df2-6d9a-43be-9af3-342abe864245\n', 2)).toEqual({
      state: 'not_installed',
      hostId: 'dd727df2-6d9a-43be-9af3-342abe864245'
    });
    expect(parsePeerDaemonStatusOutput('connected\n', 0)).toEqual({ state: 'connected' });
  });

  it.each([
    ['disconnected', 1, 'disconnected'],
    ['SSH banner\ndisconnected dd727df2-6d9a-43be-9af3-342abe864245\n', 1, 'disconnected'],
    ['disconnected', 0, 'disconnected'],
    ['not connected to SSH', 255, 'disconnected'],
    ['', 0, 'disconnected'],
    ['', null, 'disconnected'],
    ['', 2, 'not_installed'],
    ['connected bad-id', 0, 'connected']
  ] as const)('parses status exactly: %s / %s', (stdout, code, state) => {
    const parsed = parsePeerDaemonStatusOutput(stdout, code);
    expect(parsed.state).toBe(state);
    if (stdout.includes('bad-id')) expect(parsed.hostId).toBeUndefined();
  });

  it('can restart an unmanaged installation without another join code', () => {
    const command = peerRestartCommand('machine.example.com');
    expect(command).toContain('"$join_bin" restart');
    expect(command).toContain('ZCC_DATA_DIR="$data_dir"');
    expect(command).toContain('export PATH="$(dirname "$node_bin"):$PATH"');
    expect(command).not.toContain('--join-code');
    expect(command).toContain('/nix/store/*-nodejs-22.*/bin/node');
  });

  it('runs child tools with the selected Node even when the SSH PATH starts with an older Node', () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-peer-path-'));
    const oldBin = join(home, 'old'), selectedBin = join(home, 'selected');
    mkdirSync(oldBin); mkdirSync(selectedBin);
    writeFileSync(join(oldBin, 'node'), '#!/bin/sh\necho 20\n', { mode: 0o700 });
    writeFileSync(join(oldBin, 'uname'), '#!/bin/sh\necho Linux\n', { mode: 0o700 });
    writeFileSync(join(oldBin, 'systemctl'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
    const selected = join(selectedBin, 'node');
    // The selected launcher invokes a child via env, just like a CLI shebang.
    writeFileSync(selected, '#!/bin/sh\nif [ "$1" = -p ]; then echo 22; else /usr/bin/env node -p version; fi\n', { mode: 0o700 });
    try {
      const result = execFileSync('/bin/sh', ['-c', peerRestartCommand('fixture.test')], {
        env: { HOME: home, PATH: `${oldBin}:/usr/bin:/bin`, ZCC_NODE: selected }, encoding: 'utf8', timeout: 30_000
      });
      expect(result.trim()).toBe('22');
    } catch (error) {
      throw new Error(`${String(error)}\n${String((error as { stderr?: unknown }).stderr ?? '')}`);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it('restart requires an existing install', async () => {
    const ssh = mockSsh(() => ({ code: 2, stdout: 'not_installed\n' }));
    await expect(peerDaemonRestart(ssh, { host: 'devbox' }, 'box.example')).rejects.toBeInstanceOf(HostCommandError);
  });

  it('install fails when the artifact is missing', async () => {
    const ssh = mockSsh(() => ({ code: 0, stdout: 'ok' }));
    await expect(peerDaemonInstall(ssh, {
      remote: { host: 'devbox' },
      joinCode: 'zcde_x',
      hostId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      serverUrl: 'https://box.example',
      serverHost: 'box.example',
      artifactPath: '/tmp/zcc-missing-artifact.tgz'
    })).rejects.toMatchObject({ code: 'artifact_missing' });
  });

  it('does not crash the process when ssh closes stdin during artifact upload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-peer-epipe-'));
    const file = join(dir, 'artifact.bin');
    writeFileSync(file, Buffer.alloc(256 * 1024, 7));
    const uncaught: Error[] = [];
    const onUncaught = (err: Error) => {
      uncaught.push(err);
    };
    process.on('uncaughtException', onUncaught);
    try {
      const ssh = createSystemPeerDaemonSsh((_command, _args, options) =>
        spawn(process.execPath, ['-e', 'process.exit(1)'], options)
      );
      const result = await ssh.pipeFile({ host: 'devbox' }, 'tar -xzf -', file, 5_000);
      expect(result.code).not.toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(uncaught.filter((err) => (err as NodeJS.ErrnoException).code === 'EPIPE')).toEqual([]);
    } finally {
      process.off('uncaughtException', onUncaught);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
