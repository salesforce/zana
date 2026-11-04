import type { IncomingMessage, ServerResponse } from 'node:http';
import { PeerRequestEnvelopeSchema } from '@zana-ai/zcc-contracts/host-rpc';
import type { ProductHttpContext } from './product-context.js';
import { headerValue } from './browser-request-guard.js';
import { sendJson } from './json.js';
import { MAX_PEER_BODY_BYTES, peerRoute } from '../services/peers/peer-auth.js';
import { createPluginPeerCommit } from '../plugins/plugin-worker-bridge.js';

export const MAX_INBOUND_PEER_REQUESTS = 4;
export const PEER_BODY_READ_TIMEOUT_MS = 15_000;
let activeRequests = 0;

/** Pair-authenticated data plane. Browser/daemon credentials never grant plugin access. */
export async function handlePeerApi(request: IncomingMessage, response: ServerResponse, ctx: ProductHttpContext, path: string, method: string): Promise<boolean> {
  if (!path.startsWith('/api/v1/peer/')) return false;
  // Reserve before body allocation. All listeners share the process-wide 32 MiB budget.
  if (activeRequests >= MAX_INBOUND_PEER_REQUESTS) {
    sendJson(response, 429, { ok: false, code: 'peer-request-busy' });
    return true;
  }
  activeRequests++;
  try { return await handleAdmittedPeer(request, response, ctx, path, method); }
  finally { activeRequests--; }
}

async function handleAdmittedPeer(request: IncomingMessage, response: ServerResponse, ctx: ProductHttpContext, path: string, method: string): Promise<boolean> {
  const match = path.match(/^\/api\/v1\/peer\/([a-z][a-z0-9-]{0,63})\/([a-z][a-z0-9-]{0,63})$/);
  if (!match || request.url !== path || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) {
    sendJson(response, 400, { ok: false, code: 'invalid-peer-request' });
    return true;
  }
  if (method !== 'POST') {
    sendJson(response, 405, { ok: false, code: 'method-not-allowed' });
    return true;
  }
  const pluginId = match[1]!, peerMethod = match[2]!;
  let envelope;
  try {
    const encoded = headerValue(request.headers, 'x-zcc-peer-envelope') ?? '';
    if (encoded.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('invalid envelope');
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) throw new Error('invalid encoding');
    envelope = PeerRequestEnvelopeSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    sendJson(response, 400, { ok: false, code: 'invalid-peer-request' });
    return true;
  }
  let raw: Buffer;
  try { raw = await readBoundedBody(request); }
  catch (error) {
    const tooLarge = error instanceof Error && error.message === 'too large';
    if (!response.destroyed) {
      if (tooLarge) sendJson(response, 413, { ok: false, code: 'peer-body-too-large' });
      else sendJson(response, 408, { ok: false, code: 'peer-body-read-failed' });
    }
    return true;
  }
  let lease;
  try {
    lease = await ctx.peerPairs.authenticateRequest({ envelope, body: raw, pluginId,
      scope: envelope.scope, route: peerRoute(pluginId, peerMethod), httpMethod: method });
  } catch {
    sendJson(response, 503, { ok: false, code: 'peer-auth-unavailable' });
    return true;
  }
  if (!lease) {
    sendJson(response, 401, { ok: false, code: 'peer-auth-failed' });
    return true;
  }
  const disconnected = new AbortController();
  const lifetime = new AbortController();
  const abort = () => { if (!response.writableEnded) disconnected.abort(); };
  response.once('close', abort);
  const signal = AbortSignal.any([lease.signal, disconnected.signal, AbortSignal.timeout(30_000)]);
  let cancel: (() => void) | undefined;
  try {
    let body: unknown;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
    catch {
      sendJson(response, 400, { ok: false, code: 'invalid-peer-json' });
      return true;
    }
    if (!ctx.plugins) {
      sendJson(response, 404, { ok: false, code: 'unknown-peer-method' });
      return true;
    }
    signal.throwIfAborted();
    const operation = ctx.plugins.dispatchPeer(pluginId, peerMethod, {
      peerId: lease.grant.remoteInstanceId, body, scope: lease.grant.scope, grantEpoch: lease.grant.epoch, signal,
      commitSync: createPluginPeerCommit(lease, signal, lifetime.signal)
    });
    const result = await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      cancel = () => reject(signal.reason);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    })]);
    signal.throwIfAborted();
    await lease.assertActive();
    const encoded = JSON.stringify({ ok: true, result });
    if (Buffer.byteLength(encoded) > MAX_PEER_BODY_BYTES) {
      sendJson(response, 413, { ok: false, code: 'peer-response-too-large' });
    } else {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(encoded);
    }
  } catch {
    if (!response.destroyed) sendJson(response, signal.aborted ? 409 : 400,
      { ok: false, code: signal.aborted ? 'peer-request-cancelled' : 'peer-request-rejected' });
  } finally {
    lifetime.abort();
    if (cancel) signal.removeEventListener('abort', cancel);
    response.off('close', abort);
    lease.release();
  }
  return true;
}

async function readBoundedBody(request: IncomingMessage): Promise<Buffer> {
  if (Number(request.headers['content-length']) > MAX_PEER_BODY_BYTES) throw new Error('too large');
  const bytes = Buffer.allocUnsafe(MAX_PEER_BODY_BYTES);
  let size = 0;
  const timer = setTimeout(() => request.destroy(new Error('peer body read timed out')), PEER_BODY_READ_TIMEOUT_MS);
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buffer.length > bytes.length - size) throw new Error('too large');
      bytes.set(buffer, size);
      size += buffer.length;
    }
    return bytes.subarray(0, size);
  } finally { clearTimeout(timer); }
}
