import { describe, expect, it } from 'vitest';
import { formatJoinCountdown, isLoopbackOrigin, pairingCommand } from './machine-pairing.js';

describe('machine pairing command', () => {
  it('builds the curl|sh one-liner from a public origin', () => {
    expect(pairingCommand({
      publicAppUrl: 'https://box.tailnet.ts.net/',
      joinCode: 'zcde_abc',
      hostId: 'host-1'
    })).toBe(
      'curl -fL https://box.tailnet.ts.net/install.sh | sh -s -- --join-code zcde_abc --host-id host-1 --server https://box.tailnet.ts.net'
    );
  });

  it('refuses loopback origins so a remote box cannot enroll against 127.0.0.1', () => {
    expect(pairingCommand({
      publicAppUrl: 'http://127.0.0.1:8780',
      joinCode: 'zcde_abc',
      hostId: 'host-1'
    })).toBeNull();
    expect(isLoopbackOrigin('http://localhost:8780')).toBe(true);
    expect(formatJoinCountdown(65_000)).toBe('1:05');
  });
});
