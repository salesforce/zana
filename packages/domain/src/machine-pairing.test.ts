import { describe, expect, it } from 'vitest';
import {
  formatSshPairingCommand,
  isPairingHostUuid,
  isPairingJoinCode,
  localListenPort,
  sanitizeSshHost,
  sshPairingArgv,
  sshPublicPairingArgv,
  sshPairingCommand
} from './machine-pairing.js';

const GOLDEN =
  "ssh -o ExitOnForwardFailure=yes -R 18782:127.0.0.1:8780 limited-pony 'curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 http://127.0.0.1:18782/install.sh | sh -s -- --join-code zcde_abc --host-id 028c8627-a6d8-4c62-964e-8f6b35cb2335 --server http://127.0.0.1:18782 && echo Host daemon installed. Leave this SSH session open to keep the tunnel. && sleep infinity'";

describe('ssh pairing argv', () => {
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
        'curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 http://127.0.0.1:18782/install.sh | sh -s -- --join-code zcde_abc --host-id 028c8627-a6d8-4c62-964e-8f6b35cb2335 --server http://127.0.0.1:18782 && echo Host daemon installed. Leave this SSH session open to keep the tunnel. && sleep infinity'
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

  it('builds a public-origin SSH installer without a reverse tunnel', () => {
    expect(sshPublicPairingArgv({
      sshHost: 'limited-pony',
      serverUrl: 'https://zcc-7808c5bc8f3d.herokuapp.com/',
      joinCode: 'zcde_abc',
      hostId: '028c8627-a6d8-4c62-964e-8f6b35cb2335'
    })).toEqual({
      command: 'ssh',
      args: [
        'limited-pony',
        'curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 https://zcc-7808c5bc8f3d.herokuapp.com/install.sh | sh -s -- --join-code zcde_abc --host-id 028c8627-a6d8-4c62-964e-8f6b35cb2335 --server https://zcc-7808c5bc8f3d.herokuapp.com'
      ]
    });
  });
});
