import { describe, expect, it } from 'vitest';
import {
  formatJoinCountdown,
  isLoopbackOrigin,
  pairingCommand,
  resolvePairingServerUrl
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
});
