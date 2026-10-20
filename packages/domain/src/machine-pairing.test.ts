import { describe, expect, it } from 'vitest';
import {
  formatSshPairingCommand,
  sshPairingRemoteScript,
  isPairingHostUuid,
  isPairingJoinCode,
  localListenPort,
  sanitizeSshHost,
  sshPairingArgv,
  sshPairingCommand
} from './machine-pairing.js';

const GOLDEN =
  "ssh -o ExitOnForwardFailure=yes -R 18782:127.0.0.1:8780 limited-pony 'curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 http://127.0.0.1:18782/install.sh | ZCC_HOST_ENROLLMENT_PROVENANCE=tunnel sh -s -- --join-code zcde_abc --host-id 028c8627-a6d8-4c62-964e-8f6b35cb2335 --server http://127.0.0.1:18782 && echo Host daemon installed. Leave this SSH session open to keep the tunnel. && sleep infinity'";

describe('ssh pairing argv', () => {
  it('covers invalid ports and command inputs', () => {
    for (const host of [undefined, '', 'bad/host']) expect(sanitizeSshHost(host)).toBeNull();
    expect(localListenPort('http://example.test')).toBe(80); expect(localListenPort('https://example.test')).toBe(443);
    for (const url of [undefined, 'bad', 'ftp://example.test', 'http://example.test:0']) expect(localListenPort(url)).toBeNull();
    expect(sshPairingRemoteScript({ joinCode: 'zcde_abc', hostId: 'host', remoteTunnelPort: 0 })).toBeNull();
    expect(sshPairingArgv({ sshHost: 'box', localListenPort: 0, joinCode: 'zcde_abc', hostId: 'host' })).toBeNull();
    expect(sshPairingCommand({ sshHost: 'box', localServerUrl: 'bad', joinCode: 'zcde_abc', hostId: 'host' })).toBeNull();
    expect(sshPairingCommand({ sshHost: 'box', localServerUrl: 'http://localhost:1', joinCode: 'bad', hostId: 'host' })).toBeNull();
    expect(formatSshPairingCommand({ command: 'ssh', args: [] })).toBe("ssh  ''");
  });
  it('records tunnel provenance for the SSH forward command', () => {
    expect(sshPairingCommand({ sshHost: 'box', localServerUrl: 'http://127.0.0.1:8780', joinCode: 'zcde_abc', hostId: 'host-1' })).toContain('ZCC_HOST_ENROLLMENT_PROVENANCE=tunnel sh');
  });
  it('matches the copy-paste one-liner', () => {
    const argv = sshPairingArgv({
      sshHost: 'limited-pony',
      localListenPort: 8780,
      joinCode: 'zcde_abc',
      hostId: '028c8627-a6d8-4c62-964e-8f6b35cb2335'
    });
    expect(argv).toEqual({
      command: 'ssh',
      args: [
        '-o',
        'ExitOnForwardFailure=yes',
        '-R',
        '18782:127.0.0.1:8780',
        'limited-pony',
        'curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 http://127.0.0.1:18782/install.sh | ZCC_HOST_ENROLLMENT_PROVENANCE=tunnel sh -s -- --join-code zcde_abc --host-id 028c8627-a6d8-4c62-964e-8f6b35cb2335 --server http://127.0.0.1:18782 && echo Host daemon installed. Leave this SSH session open to keep the tunnel. && sleep infinity'
      ]
    });
    expect(formatSshPairingCommand(argv!)).toBe(GOLDEN);
    expect(sshPairingCommand({
      sshHost: 'limited-pony',
      localServerUrl: 'http://127.0.0.1:8780',
      joinCode: 'zcde_abc',
      hostId: '028c8627-a6d8-4c62-964e-8f6b35cb2335'
    })).toBe(GOLDEN);
  });

  it('rejects a flag-shaped SSH host and malformed tokens', () => {
    expect(sanitizeSshHost('-oProxyCommand=x')).toBeNull();
    expect(sshPairingArgv({
      sshHost: '-evil',
      localListenPort: 8780,
      joinCode: 'zcde_abc',
      hostId: 'host-1'
    })).toBeNull();
    expect(sshPairingArgv({
      sshHost: 'limited-pony',
      localListenPort: 8780,
      joinCode: 'zcde_abc; rm -rf /',
      hostId: 'host-1'
    })).toBeNull();
    expect(isPairingJoinCode('zcde_abc')).toBe(true);
    expect(isPairingJoinCode('not-a-code')).toBe(false);
    expect(isPairingHostUuid('028c8627-a6d8-4c62-964e-8f6b35cb2335')).toBe(true);
    expect(isPairingHostUuid('host-1')).toBe(false);
  });

  it('reads the local listen port from a product origin', () => {
    expect(localListenPort('http://127.0.0.1:8780')).toBe(8780);
    expect(localListenPort('http://127.0.0.1:8780/')).toBe(8780);
  });
});
