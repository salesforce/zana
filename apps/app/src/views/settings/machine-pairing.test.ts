import { describe, expect, it } from 'vitest';
import {
  defaultSshHost,
  formatJoinCountdown,
  isLoopbackOrigin,
  joinCountdownMs,
  localListenPort,
  mergePairingSshHosts,
  pairingCommand,
  resolvePairingServerUrl,
  resolveRelayPairingServerUrl,
  sanitizeSshHost,
  sshHostOptionsFromProjects,
  sshHostsFromProjects,
  sshPairingArgv,
  sshPairingCommand
} from './machine-pairing.js';

describe('machine pairing command', () => {
  it('builds the curl|sh one-liner from a public origin', () => {
    expect(pairingCommand({
      publicAppUrl: 'https://box.tailnet.ts.net/',
      joinCode: 'zcde_abc',
      hostId: 'host-1'
    })).toBe(
      'curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 https://box.tailnet.ts.net/install.sh | sh -s -- --join-code zcde_abc --host-id host-1 --server https://box.tailnet.ts.net'
    );
  });

  it('falls back to a loopback origin so the local installer still copies, like BB', () => {
    expect(resolvePairingServerUrl('http://127.0.0.1:8780')).toMatch(/^http:\/\/(127\.0\.0\.1|localhost)/);
    expect(pairingCommand({
      publicAppUrl: 'http://127.0.0.1:8780',
      joinCode: 'zcde_abc',
      hostId: 'host-1'
    })).toContain('--join-code zcde_abc');
    expect(pairingCommand({
      publicAppUrl: 'http://127.0.0.1:8780',
      joinCode: 'zcde_abc',
      hostId: 'host-1'
    })).toContain('/install.sh');
    expect(isLoopbackOrigin('http://localhost:8780')).toBe(true);
    expect(formatJoinCountdown(65_000)).toBe('1:05');
  });

  it('prefixes a relay session origin and min()s the join countdown', () => {
    expect(resolveRelayPairingServerUrl({
      publicAppUrl: 'https://zcc.herokuapp.com/',
      relay: {
        state: 'connected',
        sessionId: 'zcrs_abcdefghijklmnopqr1234',
        joinUntil: 2_000
      },
      now: 1_000
    })).toEqual({ url: 'https://zcc.herokuapp.com/t/zcrs_abcdefghijklmnopqr1234' });
    expect(resolveRelayPairingServerUrl({
      publicAppUrl: 'https://zcc.herokuapp.com',
      relay: {
        state: 'connected',
        sessionId: 'zcrs_abcdefghijklmnopqr1234',
        joinUntil: 500
      },
      now: 1_000
    }).error).toBe('join_expired');
    expect(resolveRelayPairingServerUrl({
      publicAppUrl: 'https://box.tailnet.ts.net',
      relay: { state: 'unconfigured' }
    }).url).toBe('https://box.tailnet.ts.net');
    expect(joinCountdownMs(10_000, 4_000, 1_000)).toBe(3_000);
  });

  it('builds an SSH reverse-tunnel command for loopback pairing', () => {
    const argv = sshPairingArgv({
      sshHost: 'limited-pony',
      localListenPort: 8780,
      joinCode: 'zcde_abc',
      hostId: '028c8627-a6d8-4c62-964e-8f6b35cb2335'
    });
    expect(argv?.command).toBe('ssh');
    expect(sshPairingCommand({
      sshHost: 'limited-pony',
      localServerUrl: 'http://127.0.0.1:8780',
      joinCode: 'zcde_abc',
      hostId: '028c8627-a6d8-4c62-964e-8f6b35cb2335'
    })).toBe(
      "ssh -o ExitOnForwardFailure=yes -R 18782:127.0.0.1:8780 limited-pony 'curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 http://127.0.0.1:18782/install.sh | sh -s -- --join-code zcde_abc --host-id 028c8627-a6d8-4c62-964e-8f6b35cb2335 --server http://127.0.0.1:18782 && echo Host daemon installed. Leave this SSH session open to keep the tunnel. && sleep infinity'"
    );
  });

  it('rejects a flag-shaped SSH host', () => {
    expect(sanitizeSshHost('-oProxyCommand=x')).toBeNull();
    expect(sanitizeSshHost('limited-pony')).toBe('limited-pony');
    expect(sshPairingCommand({
      sshHost: '-evil',
      localServerUrl: 'http://127.0.0.1:8780',
      joinCode: 'zcde_abc',
      hostId: 'host-1'
    })).toBeNull();
  });

  it('defaults the SSH host from the last remote project', () => {
    const projects = [
      { id: 'a', remote: { host: 'kit-kat' } },
      { id: 'be5d9751-83df-4736-979a-2c77b14fcee7', remote: { host: 'limited-pony' } }
    ];
    expect(sshHostsFromProjects(projects)).toEqual(['kit-kat', 'limited-pony']);
    expect(defaultSshHost(projects, 'be5d9751-83df-4736-979a-2c77b14fcee7')).toBe('limited-pony');
    expect(defaultSshHost(projects, null)).toBe('kit-kat');
    expect(localListenPort('http://127.0.0.1:8780')).toBe(8780);
  });

  it('lists every remote project host, newest first, then extra ssh-config aliases', () => {
    const options = sshHostOptionsFromProjects([
      { name: 'Pony', lastActiveAt: 10, remote: { host: 'limited-pony' } },
      { name: 'Roadrunner', lastActiveAt: 30, remote: { host: 'educational-roadrunner' } },
      { name: 'kit-kat', lastActiveAt: 20, remote: { host: 'kit-kat' } }
    ]);
    expect(options).toEqual([
      { host: 'educational-roadrunner', label: 'Roadrunner', detail: 'educational-roadrunner', group: 'project' },
      { host: 'kit-kat', label: 'kit-kat', group: 'project' },
      { host: 'limited-pony', label: 'Pony', detail: 'limited-pony', group: 'project' }
    ]);
    expect(mergePairingSshHosts(options, [
      'kit-kat',
      { alias: 'github-work', hostname: 'github.com', user: 'grebmann' }
    ])).toEqual([
      ...options,
      {
        host: 'github-work',
        label: 'github-work',
        group: 'ssh-config',
        detail: 'github.com @grebmann'
      }
    ]);
  });
});
