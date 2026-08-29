import { describe, expect, it } from 'vitest';
import { FLAG, TYPE, decodeFrame, encodeFrame, encodeJsonPayload } from './protocol.mjs';

describe('pairing protocol', () => {
  it('round-trips meta and binary payloads', () => {
    const meta = encodeFrame(TYPE.HTTP_REQ, FLAG.META | FLAG.FIN, 7, encodeJsonPayload({ method: 'GET', url: '/install.sh' }));
    const decoded = decodeFrame(meta);
    expect(decoded?.type).toBe(TYPE.HTTP_REQ);
    expect(decoded?.streamId).toBe(7);
    expect(JSON.parse(decoded!.payload.toString())).toMatchObject({ method: 'GET' });

    const chunk = Buffer.alloc(64 * 1024, 0xab);
    const framed = encodeFrame(TYPE.HTTP_RES, 0, 7, chunk);
    expect(decodeFrame(framed)?.payload.equals(chunk)).toBe(true);
  });

  it('rejects truncated or oversized frames', () => {
    expect(decodeFrame(Buffer.from([1, 2, 3]))).toBeNull();
    const ok = encodeFrame(TYPE.PING, 0, 0);
    expect(decodeFrame(Buffer.concat([ok, Buffer.from([0])]))).toBeNull();
  });
});
