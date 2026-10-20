import { request } from 'node:http';
import { PREVIEW_PATH, previewTargets, previewHeaders, previewPathAllowed } from './preview-policy.mjs';
import { WebSocket } from 'ws';
import { isMachinePath, machineIdentity } from './machine-routes.mjs';
import { TUNNEL_PATH, LIMITS, headers, validPath, parseFrame, send, dataFramesFlushed, bytes, heartbeat, remoteOrigin, validToken } from './protocol.mjs';

/** Dials ONLY the supplied loopback mobile gateway, never the product server or a frame-supplied host. */
export function connectRelay({ publicUrl, token, gatewayPort, gatewayCredential, productInstanceId, allowLocal = false, onState = () => {}, retryMs = 1000, heartbeatMs = 20_000, helloTimeoutMs = 10_000, previews, machineCredential, random = Math.random }) {
  const origin = remoteOrigin(publicUrl, allowLocal);
  if (!validToken(token)) throw new Error('Invalid relay token');
  if (gatewayCredential !== undefined && !validToken(gatewayCredential)) throw new Error('Invalid local gateway credential');
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) throw new Error('Invalid gateway port');
  const target = new URL(previews ? PREVIEW_PATH : TUNNEL_PATH, origin);
  target.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
  let socket;
  let retry;
  let stopped = false;
  let backoff = retryMs;
  let state = 'connecting';
  const streams = new Map();
  const update = value => { state = value; onState(value); };
  const dispose = key => {
    const stream = streams.get(key);
    if (!stream) return;
    streams.delete(key);
    stream.releaseUpload?.();
    stream.request?.destroy();
    stream.response?.destroy();
    stream.ws?.terminate();
  };
  const cleanup = () => { for (const key of streams.keys()) dispose(key); };
  const dial = () => {
    if (stopped) return;
    update('connecting');
    const ws = new WebSocket(target, { headers: { authorization: `Bearer ${token}`, ...(machineCredential ? { 'x-zcc-machine-credential': machineCredential } : {}), ...(previews ? { 'x-zcc-preview-version': '1' } : {}), ...(productInstanceId ? { 'x-zcc-relay-machine-version': '1', 'x-zcc-product-instance': productInstanceId } : {}) }, handshakeTimeout: 10_000, maxPayload: LIMITS.frame, perMessageDeflate: false, followRedirects: false });
    let ready = false;
    let helloTimer;
    let previewTimer;
    let previewSignature = '';
    const targets = () => { try { return previewTargets(previews?.() ?? []); } catch { return []; } };
    const syncPreviews = () => {
      const active = targets();
      for (const [id, stream] of streams) if (stream.previewPort && !active.some(item => item.port === stream.previewPort)) { send(ws, { type: 'error', id }); dispose(id); }
      const signature = JSON.stringify(active);
      if (signature !== previewSignature) { previewSignature = signature; send(ws, { type: 'preview-targets', id: 0, targets: active }); }
    };
    // All HTTP responses share one socket budget. Pause each producer and drain
    // one chunk at a time, so concurrent app assets cannot overflow the tunnel.
    let responseWrites = Promise.resolve();
    let pendingResponseBytes = 0;
    let pendingResponseWrites = 0;
    const blockedUploads = new Set();
    socket = ws;
    ws.on('open', () => {
      heartbeat(ws, heartbeatMs);
      helloTimer = setTimeout(() => ws.terminate(), helloTimeoutMs);
      helloTimer.unref();
    });
    ws.on('unexpected-response', (_req, response) => {
      response.resume();
      if (previews && [404, 409].includes(response.statusCode)) { stopped = true; update('update-required'); }
      ws.terminate();
    });
    ws.on('error', () => { /* close owns cleanup/retry; never surface headers or secrets */ });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(previewTimer);
      if (socket !== ws) return;
      cleanup();
      if (stopped) return;
      update('reconnecting');
      // Equal jitter: [0.5x, 1x] of the backoff so desktops don't redial in lockstep after a web restart.
      retry = setTimeout(dial, Math.floor(backoff * (0.5 + 0.5 * random())));
      retry.unref();
      backoff = Math.min(30_000, backoff * 2);
    });
    ws.on('message', raw => {
      try {
        const frame = parseFrame(raw);
        if (frame.type === 'hello' && frame.id === 0 && !ready) {
          clearTimeout(helloTimer);
          if (previews && frame.previewVersion !== 1) { update('update-required'); stopped = true; ws.close(1008, 'Preview protocol unavailable'); return; }
          ready = true; backoff = retryMs; update('connected');
          if (previews) { syncPreviews(); previewTimer = setInterval(syncPreviews, 1000); previewTimer.unref(); }
          return;
        }
        if (!ready) throw new Error('Missing relay handshake');
        if (frame.id === 0) throw new Error('Invalid stream');
        if (frame.type === 'cancel') { dispose(frame.id); return; }
        if (frame.type === 'request' || frame.type === 'ws-open') {
          if (streams.has(frame.id) || streams.size >= LIMITS.streams) throw new Error('Too many streams');
          const previewPort = previews ? frame.target : undefined;
          if (previews && (!targets().some(item => item.port === previewPort) || !previewPathAllowed(frame.path))) { send(ws, { type: 'error', id: frame.id }); return; }
          const incoming = previews ? previewHeaders(frame.headers, false, previewPort) : { ...headers(frame.headers), host: origin.host };
          const localPort = previewPort ?? gatewayPort;
          const machine = gatewayCredential ? machineIdentity(incoming) : null;
          const path = frame.type === 'ws-open' ? frame.path ?? '/ws' : frame.path;
          if (machine && !isMachinePath(frame.type === 'ws-open' ? 'GET' : frame.method, path, frame.type === 'ws-open')) throw new Error('Invalid machine route');
          // Only the authenticated outbound tunnel can mint this local capability.
          // It is never accepted from a phone or transported across the relay.
          if (gatewayCredential) {
            delete incoming.cookie;
            if (!machine) delete incoming.authorization;
            incoming['x-zcc-connect-gateway'] = gatewayCredential;
          }
          if (frame.type === 'request') {
            if (!validPath(frame.path) || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(frame.method)) throw new Error('Invalid request');
            const stream = { size: 0, ended: false, previewPort };
            streams.set(frame.id, stream);
            const local = request({ hostname: '127.0.0.1', port: localPort, path: frame.path, method: frame.method, headers: incoming, timeout: 120_000 }, response => {
              if (!streams.has(frame.id)) { response.destroy(); return; }
              stream.response = response;
              let size = 0;
              try { send(ws, { type: 'response', id: frame.id, status: response.statusCode, headers: previews ? previewHeaders(response.headers, true, previewPort) : headers(response.headers, true) }); }
              catch { send(ws, { type: 'error', id: frame.id }); dispose(frame.id); return; }
              response.on('data', chunk => {
                response.pause();
                size += chunk.length;
                if (size > LIMITS.response || pendingResponseBytes + chunk.length > LIMITS.buffer || pendingResponseWrites >= LIMITS.streams) {
                  send(ws, { type: 'error', id: frame.id }); dispose(frame.id);
                  return;
                }
                pendingResponseBytes += chunk.length;
                pendingResponseWrites++;
                const active = () => streams.get(frame.id) === stream;
                responseWrites = responseWrites.then(async () => {
                  const sent = await dataFramesFlushed(ws, 'response-data', frame.id, chunk, active);
                  if (!active()) return;
                  if (sent) response.resume();
                  else { send(ws, { type: 'error', id: frame.id }); dispose(frame.id); }
                }).catch(() => { if (active()) { send(ws, { type: 'error', id: frame.id }); dispose(frame.id); } })
                  .finally(() => { pendingResponseBytes -= chunk.length; pendingResponseWrites--; });
                stream.responseWrite = responseWrites;
              });
              response.on('end', async () => {
                await stream.responseWrite;
                stream.releaseUpload();
                if (streams.delete(frame.id)) send(ws, { type: 'response-end', id: frame.id });
              });
              response.on('error', () => { if (streams.has(frame.id)) { send(ws, { type: 'error', id: frame.id }); dispose(frame.id); } });
            });
            stream.request = local;
            stream.releaseUpload = () => {
              local.off('drain', stream.releaseUpload);
              if (blockedUploads.delete(local) && blockedUploads.size === 0) ws.resume();
            };
            local.on('timeout', () => local.destroy(new Error('Timeout')));
            local.on('error', () => { if (streams.has(frame.id)) { send(ws, { type: 'error', id: frame.id }); dispose(frame.id); } });
          } else {
            if (!previews && !machine && !['/ws', '/ws/'].includes(path)) throw new Error('Invalid socket route');
            const local = new WebSocket(`ws://127.0.0.1:${localPort}${path}`, previews ? frame.protocols ?? [] : [], { headers: incoming, handshakeTimeout: 10_000, maxPayload: 1024 * 1024, perMessageDeflate: false });
            const stream = { ws: local, queued: [], queuedBytes: 0, previewPort };
            streams.set(frame.id, stream);
            local.on('open', () => { if (previews) send(ws, { type: 'ws-ready', id: frame.id, protocol: local.protocol }); for (const queued of stream.queued) local.send(queued.data, { binary: queued.binary }); stream.queued = []; stream.queuedBytes = 0; });
            local.on('message', (data, binary) => send(ws, { type: 'ws-data', id: frame.id, data: data.toString('base64'), binary }));
            local.on('error', () => { /* close reports failure */ });
            local.on('close', () => { if (streams.delete(frame.id)) send(ws, { type: 'ws-close', id: frame.id }); });
          }
          return;
        }
        const stream = streams.get(frame.id);
        // A cancellation can race in-flight response data; retired IDs are ignored.
        if (!stream) return;
        if (frame.type === 'request-data' && stream.request && !stream.ended) {
          const chunk = bytes(frame);
          stream.size += chunk.length;
          if (stream.size > LIMITS.request || stream.request.writableLength > LIMITS.buffer) { send(ws, { type: 'error', id: frame.id }); dispose(frame.id); }
          else if (!stream.request.write(chunk) && !blockedUploads.has(stream.request)) {
            // The relay's send callback only drains the tunnel socket. Propagate
            // the loopback request's backpressure before its buffer reaches the cap.
            blockedUploads.add(stream.request);
            ws.pause();
            stream.request.once('drain', stream.releaseUpload);
          }
        } else if (frame.type === 'request-end' && stream.request && !stream.ended) { stream.ended = true; stream.request.end(); }
        else if (frame.type === 'ws-data' && stream.ws) {
          const data = bytes(frame, 1024 * 1024);
          const binary = frame.binary === true;
          if (stream.ws.readyState === WebSocket.CONNECTING) {
            stream.queuedBytes += data.length;
            if (stream.queuedBytes > 64 * 1024) { send(ws, { type: 'error', id: frame.id }); dispose(frame.id); }
            else stream.queued.push({ data, binary });
          } else if (stream.ws.bufferedAmount > LIMITS.buffer) { send(ws, { type: 'error', id: frame.id }); dispose(frame.id); }
          else if (stream.ws.readyState === WebSocket.OPEN) stream.ws.send(data, { binary });
        } else throw new Error('Invalid frame sequence');
      } catch { ws.close(1008, 'Invalid tunnel frame'); }
    });
  };
  dial();
  return { state: () => state, close() { stopped = true; clearTimeout(retry); cleanup(); socket?.terminate(); update('stopped'); } };
}
