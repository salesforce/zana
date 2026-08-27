/** Byte-identical twin of website/relay/protocol.mjs. Guarded by pairing-relay-allowlist.guard.test.ts. */

export const TYPE = {
  PING: 1,
  PONG: 2,
  HTTP_REQ: 3,
  HTTP_RES: 4,
  WS_OPEN: 5,
  WS_DATA: 6,
  WS_CLOSE: 7
} as const;

export const FLAG = {
  FIN: 0x01,
  META: 0x02,
  TEXT: 0x04
} as const;

export const HEADER_SIZE = 10;
export const MAX_PAYLOAD = 256 * 1024;
export const BODY_CHUNK = 64 * 1024;

export function encodeFrame(
  type: number,
  flags: number,
  streamId: number,
  payload: Buffer | Uint8Array | string = Buffer.alloc(0)
): Buffer {
  const body = Buffer.isBuffer(payload)
    ? payload
    : typeof payload === 'string'
      ? Buffer.from(payload, 'utf8')
      : Buffer.from(payload);
  if (body.length > MAX_PAYLOAD) {
    throw new Error(`pairing frame payload exceeds ${MAX_PAYLOAD}`);
  }
  const buf = Buffer.allocUnsafe(HEADER_SIZE + body.length);
  buf.writeUInt8(type, 0);
  buf.writeUInt8(flags, 1);
  buf.writeUInt32BE(streamId >>> 0, 2);
  buf.writeUInt32BE(body.length, 6);
  body.copy(buf, HEADER_SIZE);
  return buf;
}

export function decodeFrame(buf: Buffer): {
  type: number;
  flags: number;
  streamId: number;
  payload: Buffer;
} | null {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER_SIZE) return null;
  const type = buf.readUInt8(0);
  const flags = buf.readUInt8(1);
  const streamId = buf.readUInt32BE(2);
  const length = buf.readUInt32BE(6);
  if (length > MAX_PAYLOAD) return null;
  if (buf.length !== HEADER_SIZE + length) return null;
  return {
    type,
    flags,
    streamId,
    payload: buf.subarray(HEADER_SIZE, HEADER_SIZE + length)
  };
}

export function encodeJsonPayload(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

export function decodeJsonPayload(payload: Buffer): unknown {
  return JSON.parse(payload.toString('utf8')) as unknown;
}
