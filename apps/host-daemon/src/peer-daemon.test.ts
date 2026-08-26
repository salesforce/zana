import { describe, expect, it } from 'vitest';
import {
  peerDaemonInstall,
  peerDaemonRestart,
  peerDaemonStatus,
  peerInstallServiceCommand,
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
  });

  it('keeps ssh argv BatchMode and rejects a leading-dash remote host', () => {
    const args = sshBaseArgs({ host: 'devbox', user: 'me' });
    expect(args).toContain('BatchMode=yes');
    expect(args.at(-1)).toBe('me@devbox');
    expect(() => sshBaseArgs({ host: '-evil' })).toThrow(/refusing ssh host/);
  });

  it('maps status exit codes', async () => {
    const ssh = mockSsh(() => ({ code: 2, stdout: 'not_installed\n' }));
    await expect(peerDaemonStatus(ssh, { host: 'devbox' }, 'box.example')).resolves.toMatchObject({
      state: 'not_installed'
    });
    const connected = mockSsh(() => ({ code: 0, stdout: 'connected\n' }));
    await expect(peerDaemonStatus(connected, { host: 'devbox' }, 'box.example')).resolves.toEqual({
      state: 'connected'
    });
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
