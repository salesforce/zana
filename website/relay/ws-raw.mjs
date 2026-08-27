import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

export const WS_OP = {
  CONT: 0,
  TEXT: 1,
  BINARY: 2,
  CLOSE: 8,
  PING: 9,
  PONG: 10
};

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 1024 * 1024;

export function acceptKey(secWebSocketKey) {
  return createHash('sha1').update(`${secWebSocketKey}${GUID}`).digest('base64');
}

/**
 * @param {{ opcode: number, payload?: Buffer, masked?: boolean, fin?: boolean }} input
 */
export function encodeWsFrame(input) {
  const payload = input.payload ?? Buffer.alloc(0);
  const masked = Boolean(input.masked);
  const fin = input.fin !== false;
  const opcode = input.opcode;
  const length = payload.length;
  let headerSize = 2;
  if (length >= 65536) headerSize += 8;
  else if (length >= 126) headerSize += 2;
  if (masked) headerSize += 4;
  const out = Buffer.allocUnsafe(headerSize + length);
  out[0] = (fin ? 0x80 : 0) | (opcode & 0x0f);
  let offset = 2;
  if (length >= 65536) {
    out[1] = (masked ? 0x80 : 0) | 127;
    out.writeUInt32BE(0, 2);
    out.writeUInt32BE(length, 6);
    offset = 10;
  } else if (length >= 126) {
    out[1] = (masked ? 0x80 : 0) | 126;
    out.writeUInt16BE(length, 2);
    offset = 4;
  } else {
    out[1] = (masked ? 0x80 : 0) | length;
  }
  if (masked) {
    const mask = randomBytes(4);
    mask.copy(out, offset);
    offset += 4;
    for (let i = 0; i < length; i++) {
      out[offset + i] = payload[i] ^ mask[i & 3];
    }
  } else {
    payload.copy(out, offset);
  }
  return out;
}

/**
 * @param {Buffer} buf
 * @returns {{ opcode: number, fin: boolean, payload: Buffer, rest: Buffer } | null}
 */
export function decodeWsFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let length = buf[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buf.length < 4) return null;
    length = buf.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buf.length < 10) return null;
    const high = buf.readUInt32BE(2);
    if (high !== 0) return null;
    length = buf.readUInt32BE(6);
    offset = 10;
  }
  if (length > MAX_FRAME) return null;
  if (masked) offset += 4;
  if (buf.length < offset + length) return null;
  let payload = buf.subarray(offset, offset + length);
  if (masked) {
    const mask = buf.subarray(offset - 4, offset);
    const copy = Buffer.from(payload);
    for (let i = 0; i < copy.length; i++) copy[i] ^= mask[i & 3];
    payload = copy;
  }
  return { opcode, fin, payload, rest: buf.subarray(offset + length) };
}

/**
 * Wrap a TCP socket after the HTTP 101 handshake.
 * Incoming client frames are masked; server frames are not.
 *
 * @param {import('node:net').Socket} socket
 * @param {{ masked?: boolean, leftover?: Buffer }} [options]
 */
export function createWsConnection(socket, options = {}) {
  const masked = Boolean(options.masked);
  let buf = Buffer.isBuffer(options.leftover) && options.leftover.length > 0
    ? options.leftover
    : Buffer.alloc(0);
  let closed = false;
  /** @type {Record<string, Array<(...args: unknown[]) => void>>} */
  const listeners = { message: [], close: [], error: [], ping: [], pong: [] };

  function emit(event, ...args) {
    for (const fn of listeners[event] ?? []) fn(...args);
  }

  function pump() {
    while (true) {
      const frame = decodeWsFrame(buf);
      if (!frame) break;
      buf = frame.rest;
      if (frame.opcode === WS_OP.CLOSE) {
        close(1000);
        return;
      }
      if (frame.opcode === WS_OP.PING) {
        send(frame.payload, WS_OP.PONG);
        emit('ping', frame.payload);
        continue;
      }
      if (frame.opcode === WS_OP.PONG) {
        emit('pong', frame.payload);
        continue;
      }
      if (frame.opcode === WS_OP.TEXT || frame.opcode === WS_OP.BINARY) {
        emit('message', frame.payload, frame.opcode);
      }
    }
  }

  function send(payload, opcode = WS_OP.BINARY) {
    if (closed || socket.destroyed) return;
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    socket.write(encodeWsFrame({ opcode, payload: body, masked }));
  }

  function close(code = 1000, reason = '') {
    if (closed) return;
    closed = true;
    const reasonBuf = Buffer.from(reason, 'utf8');
    const payload = Buffer.allocUnsafe(2 + reasonBuf.length);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    try {
      socket.write(encodeWsFrame({ opcode: WS_OP.CLOSE, payload, masked }));
    } catch {
      /* already gone */
    }
    socket.end();
    emit('close', code, reason);
  }

  socket.on('data', (chunk) => {
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
    try {
      pump();
    } catch (error) {
      emit('error', error);
      close(1002);
    }
  });
  socket.on('error', (error) => emit('error', error));
  socket.on('close', () => {
    if (!closed) {
      closed = true;
      emit('close', 1006, '');
    }
  });

  return {
    send,
    ping(payload = Buffer.alloc(0)) {
      send(payload, WS_OP.PING);
    },
    close,
    on(event, fn) {
      (listeners[event] ?? (listeners[event] = [])).push(fn);
    },
    get closed() {
      return closed;
    }
  };
}

export function writeServerHandshake(socket, secWebSocketKey) {
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(secWebSocketKey)}\r\n` +
      '\r\n'
  );
}

export function writeHttpError(socket, status, reason) {
  const body = `${reason}\n`;
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      '\r\n' +
      body
  );
  socket.destroy();
}

/**
 * Client helper used by tests (and not by the production laptop — that uses `ws`).
 *
 * @param {{ hostname: string, port: number, path: string, headers?: Record<string, string>, tls?: boolean }} input
 * @returns {Promise<ReturnType<typeof createWsConnection>>}
 */
export function connectWs(input) {
  return new Promise((resolve, reject) => {
    const connect = input.tls ? tls.connect : net.connect;
    const socket = connect({
      host: input.hostname,
      port: input.port,
      servername: input.hostname
    });
    const key = randomBytes(16).toString('base64');
    const headerLines = [
      `GET ${input.path} HTTP/1.1`,
      `Host: ${input.hostname}:${input.port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13'
    ];
    for (const [name, value] of Object.entries(input.headers ?? {})) {
      headerLines.push(`${name}: ${value}`);
    }
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.write(`${headerLines.join('\r\n')}\r\n\r\n`);
    });
    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      socket.off('data', onData);
      const head = buf.subarray(0, idx).toString('utf8');
      const leftover = buf.subarray(idx + 4);
      if (!head.startsWith('HTTP/1.1 101')) {
        socket.destroy();
        reject(new Error(`websocket handshake failed: ${head.split('\r\n')[0]}`));
        return;
      }
      socket.off('error', reject);
      resolve(createWsConnection(socket, { masked: true, leftover }));
    };
    socket.on('data', onData);
  });
}
