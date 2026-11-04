import type { IncomingMessage, ServerResponse } from 'node:http';
import { beginNdjson, readJsonBody, rejectMobilePeerManagement, sendJson } from './json.js';
import type { ProductHttpContext } from './product-context.js';
import { InvitationError } from '../services/peers/peer-invitation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEARTBEAT_MS = 25_000;
const TOKEN_MAX = 2048;

/**
 * Core push channel for "a plugin wants to use a connection". Desktop main subscribes once at app init, draws its own
 * approval sheet from the core-built request and answers here with a proof it signed over that request's binding. A
 * plugin never reaches either side: it can only ask through the SDK.
 */
export async function handlePeerUsesApi(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext,
  path: string,
  method: string
): Promise<boolean> {
  if (path !== '/api/v1/peer-uses/prompts' && !path.startsWith('/api/v1/peer-uses/')) return false;
  if (rejectMobilePeerManagement(request, response)) return true;
  const uses = ctx.peerUseRequests;
  if (!uses) { sendJson(response, 503, { error: 'Computer connections are unavailable on this install.' }); return true; }

  if (path === '/api/v1/peer-uses/prompts' && method === 'GET') {
    const stream = beginNdjson(response);
    let closed = false;
    const push = () => { if (!closed) stream.write({ prompts: uses.prompts() }); };
    const off = uses.onChange(push);
    const beat = setInterval(() => { if (!closed) stream.write({ ping: true }); }, HEARTBEAT_MS);
    beat.unref?.();
    const close = () => { if (closed) return; closed = true; off(); clearInterval(beat); };
    request.on('close', close);
    response.on('close', close);
    push();
    return true;
  }

  const match = /^\/api\/v1\/peer-uses\/([^/]+)\/decision$/.exec(path);
  if (match && method === 'POST') {
    const id = match[1]!;
    if (!UUID.test(id)) { sendJson(response, 404, { error: 'use request not found', reason: 'not_found' }); return true; }
    let body: unknown;
    try { body = await readJsonBody(request, 8192); } catch { sendJson(response, 400, { error: 'invalid JSON' }); return true; }
    const { approved, token } = (body && typeof body === 'object' ? body : {}) as { approved?: unknown; token?: unknown };
    if (typeof approved !== 'boolean' || (token !== undefined && (typeof token !== 'string' || token.length > TOKEN_MAX))) {
      sendJson(response, 400, { error: 'invalid decision' });
      return true;
    }
    try { sendJson(response, 200, { status: await uses.decide(id, approved, token) }); }
    catch (error) {
      if (!(error instanceof InvitationError)) { sendJson(response, 503, { error: 'Approval is unavailable right now. Try again.' }); return true; }
      sendJson(response, error.code === 'not_found' ? 404 : error.code === 'owner_proof_required' ? 403 : 400, { error: error.message, reason: error.code });
    }
    return true;
  }
  sendJson(response, 404, { error: 'not found' });
  return true;
}
