import { BODY_CHUNK, FLAG, TYPE, encodeFrame, encodeJsonPayload, decodeFrame, decodeJsonPayload } from './protocol.mjs';
import { headersToPairs, pairsToObject } from './headers.mjs';
import { WS_OP, createWsConnection, writeHttpError, writeServerHandshake } from './ws-raw.mjs';

const FIRST_RES_MS = 60_000;
const STREAM_IDLE_MS = 120_000;
const PING_MS = 20_000;
const PONG_GRACE_MS = 40_000;
const MAX_HTTP = 16;
const MAX_WS = 8;
const MAX_REQ_BODY = 1_000_000;

/**
 * @param {() => void} [onChange]
 */
export function createPairingSession(onChange) {
  /** @type {ReturnType<typeof createWsConnection> | null} */
  let laptop = null;
  let nextId = 1;
  /** @type {Map<number, { res: import('node:http').ServerResponse, timeout: NodeJS.Timeout, headersSent: boolean }>} */
  const httpStreams = new Map();
  /** @type {Map<number, ReturnType<typeof createWsConnection>>} */
  const remoteWs = new Map();
  let pingTimer = null;
  let lastPongAt = 0;

  function emitChange() {
    onChange?.();
  }

  function allocId() {
    const id = nextId >>> 0 || 1;
    nextId = (id + 1) >>> 0 || 1;
    return id;
  }

  function send(type, flags, streamId, payload) {
    if (!laptop || laptop.closed) return false;
    laptop.send(encodeFrame(type, flags, streamId, payload));
    return true;
  }

  function failHttp(streamId, status, body) {
    const pending = httpStreams.get(streamId);
    if (!pending) return;
    httpStreams.delete(streamId);
    clearTimeout(pending.timeout);
    if (pending.res.writableEnded) return;
    if (!pending.headersSent && !pending.res.headersSent) {
      pending.res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      pending.res.end(JSON.stringify(body));
      return;
    }
    pending.res.destroy();
  }

  function armTimeout(streamId, ms) {
    const pending = httpStreams.get(streamId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pending.timeout = setTimeout(() => failHttp(streamId, 504, { error: 'relay_timeout' }), ms);
  }

  function clearLaptop() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    for (const streamId of [...httpStreams.keys()]) {
      failHttp(streamId, 503, { error: 'relay_offline' });
    }
    for (const [id, conn] of remoteWs) {
      remoteWs.delete(id);
      conn.close(1001, 'relay_offline');
    }
    laptop = null;
    emitChange();
  }

  function onLaptopFrame(payload) {
    const frame = decodeFrame(payload);
    if (!frame) return;
    if (frame.type === TYPE.PONG) {
      lastPongAt = Date.now();
      return;
    }
    if (frame.type === TYPE.PING) {
      send(TYPE.PONG, 0, frame.streamId);
      return;
    }
    if (frame.type === TYPE.HTTP_RES) {
      const pending = httpStreams.get(frame.streamId);
      if (!pending) return;
      if (frame.flags & FLAG.META) {
        let meta;
        try {
          meta = decodeJsonPayload(frame.payload);
        } catch {
          failHttp(frame.streamId, 502, { error: 'relay_protocol' });
          return;
        }
        if (!pending.headersSent && !pending.res.headersSent) {
          const headers = pairsToObject(meta.headers ?? []);
          pending.res.writeHead(Number(meta.status) || 502, headers);
          pending.headersSent = true;
        }
      } else if (frame.payload.length > 0 && pending.headersSent) {
        pending.res.write(frame.payload);
      }
      armTimeout(frame.streamId, STREAM_IDLE_MS);
      if (frame.flags & FLAG.FIN) {
        httpStreams.delete(frame.streamId);
        clearTimeout(pending.timeout);
        pending.res.end();
      }
      return;
    }
    if (frame.type === TYPE.WS_DATA) {
      const conn = remoteWs.get(frame.streamId);
      if (!conn) return;
      const opcode = frame.flags & FLAG.TEXT ? WS_OP.TEXT : WS_OP.BINARY;
      conn.send(frame.payload, opcode);
      return;
    }
    if (frame.type === TYPE.WS_CLOSE) {
      const conn = remoteWs.get(frame.streamId);
      if (!conn) return;
      remoteWs.delete(frame.streamId);
      let code = 1000;
      let reason = '';
      try {
        const meta = decodeJsonPayload(frame.payload);
        code = Number(meta.code) || 1000;
        reason = typeof meta.reason === 'string' ? meta.reason : '';
      } catch {
        /* default close */
      }
      conn.close(code, reason);
    }
  }

  function attach(connection) {
    if (laptop && !laptop.closed) {
      laptop.close(4000, 'replaced');
    }
    clearLaptop();
    laptop = connection;
    lastPongAt = Date.now();
    pingTimer = setInterval(() => {
      if (!laptop || laptop.closed) return;
      if (Date.now() - lastPongAt > PONG_GRACE_MS) {
        laptop.close(4001, 'ping timeout');
        clearLaptop();
        return;
      }
      send(TYPE.PING, 0, 0);
    }, PING_MS);
    connection.on('message', (payload) => onLaptopFrame(payload));
    connection.on('close', () => {
      if (laptop === connection) clearLaptop();
    });
    connection.on('error', () => {
      if (laptop === connection) {
        connection.close(1011, 'error');
        clearLaptop();
      }
    });
    emitChange();
  }

  async function handleHttp(request, response) {
    if (httpStreams.size >= MAX_HTTP) {
      response.writeHead(429, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'relay_busy' }));
      return;
    }
    if (!laptop || laptop.closed) {
      response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'relay_offline' }));
      return;
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of request) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        if (size > MAX_REQ_BODY) {
          response.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'payload_too_large' }));
          return;
        }
        chunks.push(buf);
      }
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const body = chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
    const streamId = allocId();
    const url = request.url ?? '/';
    const meta = {
      method: (request.method ?? 'GET').toUpperCase(),
      url,
      headers: headersToPairs(request.headers)
    };
    httpStreams.set(streamId, {
      res: response,
      headersSent: false,
      timeout: setTimeout(() => failHttp(streamId, 504, { error: 'relay_timeout' }), FIRST_RES_MS)
    });
    response.on('close', () => {
      if (httpStreams.has(streamId)) {
        httpStreams.delete(streamId);
      }
    });
    send(TYPE.HTTP_REQ, FLAG.META | (body.length === 0 ? FLAG.FIN : 0), streamId, encodeJsonPayload(meta));
    if (body.length === 0) return;
    for (let offset = 0; offset < body.length; offset += BODY_CHUNK) {
      const slice = body.subarray(offset, offset + BODY_CHUNK);
      const last = offset + slice.length >= body.length;
      send(TYPE.HTTP_REQ, last ? FLAG.FIN : 0, streamId, slice);
    }
  }

  function handleUpgrade(request, socket, head) {
    if (remoteWs.size >= MAX_WS) {
      writeHttpError(socket, 429, 'Too Many Requests');
      return;
    }
    if (!laptop || laptop.closed) {
      writeHttpError(socket, 503, 'Service Unavailable');
      return;
    }
    const key = request.headers['sec-websocket-key'];
    if (typeof key !== 'string' || key.length === 0) {
      writeHttpError(socket, 400, 'Bad Request');
      return;
    }
    writeServerHandshake(socket, key);
    const leftover = Buffer.isBuffer(head) ? head : Buffer.alloc(0);
    const remote = createWsConnection(socket, { leftover });
    const streamId = allocId();
    remoteWs.set(streamId, remote);
    const url = request.url ?? '/';
    send(
      TYPE.WS_OPEN,
      FLAG.META | FLAG.FIN,
      streamId,
      encodeJsonPayload({
        url,
        headers: headersToPairs(request.headers)
      })
    );
    remote.on('message', (payload, opcode) => {
      const flags = opcode === WS_OP.TEXT ? FLAG.TEXT : 0;
      send(TYPE.WS_DATA, flags, streamId, payload);
    });
    remote.on('close', (code, reason) => {
      if (!remoteWs.has(streamId)) return;
      remoteWs.delete(streamId);
      send(TYPE.WS_CLOSE, FLAG.FIN, streamId, encodeJsonPayload({ code, reason }));
    });
  }

  return {
    attach,
    hasLaptop() {
      return Boolean(laptop && !laptop.closed);
    },
    handleHttp,
    handleUpgrade,
    dispose() {
      if (laptop && !laptop.closed) laptop.close(1001, 'shutdown');
      clearLaptop();
    }
  };
}
