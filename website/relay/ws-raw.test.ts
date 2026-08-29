import { describe, expect, it } from 'vitest';
import { WS_OP, decodeWsFrame, encodeWsFrame } from './ws-raw.mjs';

describe('raw websocket frames', () => {
  it('round-trips masked and unmasked binary payloads', () => {
    const payload = Buffer.from('install-tarball-chunk');
    const unmasked = encodeWsFrame({ opcode: WS_OP.BINARY, payload, masked: false });
    const decoded = decodeWsFrame(unmasked);
    expect(decoded?.opcode).toBe(WS_OP.BINARY);
    expect(decoded?.payload.equals(payload)).toBe(true);
    expect(decoded?.rest.length).toBe(0);

    const masked = encodeWsFrame({ opcode: WS_OP.TEXT, payload, masked: true });
    const decodedMasked = decodeWsFrame(masked);
    expect(decodedMasked?.payload.equals(payload)).toBe(true);
  });
});
