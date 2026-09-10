import { describe, expect, it } from 'vitest';
import {
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
      serverHost: 'box.tailnet.ts.net',
      joinCode: "zcde_abc'def",
      hostId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      serverUrl: 'https://box.tailnet.ts.net'
    });
    expect(script).toContain(`join_code='zcde_abc'\\''def'`);
    expect(script).toContain('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(script).not.toContain('--join-code zcde_');
    expect(script).toContain('ai.zana.zcc-host-daemon.box.tailnet.ts.net');
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
});
