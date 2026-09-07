import { describe, expect, it } from 'vitest';
import {
  JOIN_KEEPALIVE_FLOOR_MS,
  JOIN_KEEPALIVE_LEAD_MS,
  JOIN_KEEPALIVE_MIN_MS,
  joinKeepaliveDelayMs,
  pairingSessionServerUrl,
  relayJoinWindowOpen
} from './pairing-session-url.js';

describe('pairing session url', () => {
  it('appends /t/<id> and reports an open join window', () => {
    expect(pairingSessionServerUrl('https://zcc.example/', 'zcrs_abcdefghijklmnopqr1234')).toBe(
      'https://zcc.example/t/zcrs_abcdefghijklmnopqr1234'
    );
    expect(relayJoinWindowOpen({
      state: 'connected',
      sessionId: 'zcrs_abcdefghijklmnopqr1234',
      joinUntil: Date.now() + 10_000
    })).toBe(true);
    expect(relayJoinWindowOpen({
      state: 'connected',
      sessionId: 'zcrs_abcdefghijklmnopqr1234',
      joinUntil: Date.now() - 1
    })).toBe(false);
    expect(relayJoinWindowOpen({ state: 'unconfigured' })).toBe(false);
  });

  it('renews join keepalive before the remaining ttl elapses', () => {
    expect(joinKeepaliveDelayMs(1_000 + 5 * 60_000, 1_000)).toBe(4 * 60_000);
    expect(joinKeepaliveDelayMs(1_000 + JOIN_KEEPALIVE_LEAD_MS + JOIN_KEEPALIVE_FLOOR_MS, 1_000)).toBe(
      JOIN_KEEPALIVE_FLOOR_MS
    );
    expect(joinKeepaliveDelayMs(1_000 + 8_000, 1_000)).toBe(4_000);
    expect(joinKeepaliveDelayMs(1_000 + JOIN_KEEPALIVE_MIN_MS, 1_000)).toBe(JOIN_KEEPALIVE_FLOOR_MS);
    expect(joinKeepaliveDelayMs(undefined, 1_000)).toBe(JOIN_KEEPALIVE_FLOOR_MS);
  });
});
