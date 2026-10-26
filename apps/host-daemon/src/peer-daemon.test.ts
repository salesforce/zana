import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  createSystemPeerDaemonSsh,
  parsePeerDaemonStatusOutput,
  peerDaemonInstall,
  peerDaemonConnectInstall,
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
  it('preserves the local project source for initial install and managed service restarts', () => {
    const script = peerInstallServiceCommand({ serverHost: 'box', hostId: 'host', joinCode: 'zcde_fixture', serverUrl: 'https://example.test' });
    expect(script).toContain('export ZCC_PROJECT_CATALOGUE_DATA_DIR="$HOME/.zcc"');
    expect(script).toContain('<key>ZCC_PROJECT_CATALOGUE_DATA_DIR</key>');
    expect(script).toContain('Environment=ZCC_PROJECT_CATALOGUE_DATA_DIR=');
    expect(peerRestartCommand('box')).toContain('ZCC_PROJECT_CATALOGUE_DATA_DIR="$HOME/.zcc"');
  });
  it('bounds SSH logs and timeout, handles spawn errors and duplicate close', async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    const ssh = createSystemPeerDaemonSsh((() => child) as never);
    const pending = ssh.run({ host: 'box' }, 'fixture');
    child.stdout.emit('data', Buffer.from('out')); child.stderr.emit('data', Buffer.from('err'));
    child.stdout.emit('data', Buffer.alloc(256 * 1024)); child.stderr.emit('data', Buffer.alloc(256 * 1024));
    child.emit('close', 0); child.emit('close', 1);
    await expect(pending).resolves.toEqual({ code: 0, stdout: 'out', stderr: 'err' });
    const failed = ssh.run({ host: 'box' }, 'fixture'); child.emit('error', new Error('spawn failed')); child.emit('error', new Error('late'));
    await expect(failed).rejects.toThrow('spawn failed');
    vi.useFakeTimers();
    try {
      const timeout = ssh.run({ host: 'box' }, 'fixture', 1), checked = expect(timeout).rejects.toThrow('Remote host timed out');
      await vi.advanceTimersByTimeAsync(1); await checked; child.emit('close', 1);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL'); ssh.close?.();
    } finally { vi.useRealTimers(); }
  });
  it('handles disconnected status, restart success and install failures without deleting enrollment', async () => {
    const remote = { host: 'box' }, dir = mkdtempSync(join(tmpdir(), 'peer-failures-')), artifactPath = join(dir, 'host.tgz');
    writeFileSync(artifactPath, 'fixture');
    try {
      await expect(peerDaemonStatus(mockSsh(() => ({ code: 1 })), remote, 'box')).resolves.toMatchObject({ state: 'disconnected' });
      await expect(peerDaemonStatus(mockSsh(() => ({ code: 2 })), remote, 'box')).resolves.toMatchObject({ state: 'not_installed' });
      await expect(peerDaemonRestart(mockSsh(() => ({ code: 0, stdout: 'restarted' })), remote, 'box')).resolves.toMatchObject({ ok: true });
      const input = { remote, artifactPath, serverHost: 'box', hostId: 'host', joinCode: 'zcde_fixture', serverUrl: 'https://example.test' };
      await expect(peerDaemonInstall(mockSsh(() => ({ code: 1 })), input)).rejects.toThrow('Could not unpack');
      for (const stderr of ['', 'failed']) {
        await expect(peerDaemonInstall(mockSsh(cmd => ({ code: cmd.includes('nohup') ? 1 : 0, stderr })), input)).rejects.toThrow(stderr || 'Could not install');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('runs the HTTPS account installer for a Connect code and redacts it from success and failure logs', async () => {
    const connect = { accountUrl: 'https://account.example', serverId: '11111111-1111-4111-8111-111111111111', code: 'ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD' };
    const remote = { host: 'devbox' };
    const ssh = mockSsh(cmd => {
      expect(cmd).toContain("--proto '=https'");
      expect(cmd).toContain('/api/connect/host-installer');
      expect(cmd).toContain('umask 077');
      expect(cmd).toContain('trap');
      expect(cmd).toContain('"$node_bin" "$f"');
      expect(cmd).toContain('/nix/store/*-nodejs-22.*/bin/node');
      expect(cmd).not.toContain('--join-code');
      return { code: 0, stdout: 'Installed ' + connect.code };
    });
    await expect(peerDaemonConnectInstall(ssh, { remote, connect })).resolves.toEqual({ ok: true, log: 'Installed [redacted]' });
    const failed = mockSsh(() => ({ code: 35, stderr: 'failed ' + connect.code }));
    await expect(peerDaemonConnectInstall(failed, { remote, connect })).rejects.toThrow('failed [redacted]');
    await expect(peerDaemonConnectInstall(mockSsh(() => ({ code: 1 })), { remote, connect })).rejects.toThrow('Connect machine installation failed');
    for (const patch of [{ accountUrl: 'http://account.example' }, { accountUrl: 'https://account.example/path' }, { accountUrl: 'https://user@account.example' }, { serverId: '-flag' }, { code: 'zcde_legacy' }]) {
      await expect(peerDaemonConnectInstall(ssh, { remote, connect: { ...connect, ...patch } })).rejects.toThrow('Invalid Connect');
    }
  });
  it('opens the loopback-only SSH tunnel before transferring and installing the daemon', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'peer-tunnel-install-')), artifact = join(dir, 'host.tgz');
    writeFileSync(artifact, 'artifact');
    try {
      const ssh = mockSsh(() => ({ code: 0 })), calls: string[] = [];
      ssh.tunnel = async (_remote, localPort, remotePort) => { calls.push(`${localPort}:${remotePort}`); };
      const input = { remote: { host: 'pony' }, artifactPath: artifact, serverHost: 'ssh-machine', hostId: 'machine', joinCode: 'zcde_test',
        serverUrl: 'http://127.0.0.1:28888', sshTunnel: { localPort: 8780, remotePort: 28888 } };
      await peerDaemonInstall(ssh, input); expect(calls).toEqual(['8780:28888']);
      expect((ssh as PeerDaemonSsh & { commands: string[] }).commands.at(-1)).toContain('ZCC_HOST_ENROLLMENT_PROVENANCE=tunnel');
      await expect(peerDaemonInstall(ssh, { ...input, serverUrl: 'https://external.example' })).rejects.toThrow('loopback');
      await expect(peerDaemonInstall({ ...ssh, tunnel: undefined }, input)).rejects.toThrow('loopback');
      ssh.untunnel = (_remote, localPort, remotePort) => { calls.push(`removed:${localPort}:${remotePort}`); };
      ssh.pipeFile = async () => ({ code: 1, stdout: '', stderr: 'unpack failed' });
      await expect(peerDaemonInstall(ssh, input)).rejects.toThrow('unpack failed');
      expect(calls.at(-1)).toBe('removed:8780:28888');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('carries one-join replacement consent into the install script but never into the service unit', () => {
    const base = { serverHost: 'machine.example.com', joinCode: 'zcde_x', hostId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', serverUrl: 'https://machine.example.com' };
    expect(peerInstallServiceCommand({ ...base, replaceEnrollment: true })).toContain('export ZCC_HOST_REPLACE_ENROLLMENT=1');
    expect(peerInstallServiceCommand(base)).not.toContain('ZCC_HOST_REPLACE_ENROLLMENT');
    expect(peerInstallServiceCommand({ ...base, replaceEnrollment: true })).not.toMatch(/(Environment=|<key>)ZCC_HOST_REPLACE_ENROLLMENT/);
  });

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
    const marker = script.indexOf('zcc-join: attempt %s host=%s');
    expect(marker).toBeGreaterThan(-1);
    expect(marker).toBeLessThan(script.indexOf('nohup "$node_bin" "$join_bin" join'));
    expect(script).toContain('"$host_id" >>"$data_dir/host-daemon.log"');
    expect(script).toContain('host-daemon.pid');
    expect(script).toContain('kill "$old_pid"');
    expect(script).not.toContain('rm -f "$data_dir/host.id" "$data_dir/auth.json"');
    expect(script).toContain('ZCC_HOST_ENROLLMENT_PROVENANCE=non-tunnel');
    expect(script).not.toContain('--replace-enrollment');
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
    writeFileSync(selected, '#!/bin/sh\nif [ "$1" = -e ] || [ "$1" = -p ]; then echo 22; else /usr/bin/env node -p version; fi\n', { mode: 0o700 });
    try {
      const result = execFileSync('/bin/sh', ['-c', peerRestartCommand('fixture.test')], {
        env: { HOME: home, PATH: `${oldBin}:/usr/bin:/bin`, ZCC_NODE: selected }, encoding: 'utf8', timeout: 10000
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
      expect(ssh.untunnelAll?.({ host: 'devbox' })).toBe(false);
    } finally {
      process.off('uncaughtException', onUncaught);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
