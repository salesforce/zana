import { describe, expect, it } from 'vitest';
import {
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
});
