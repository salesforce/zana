import type { IncomingMessage, ServerResponse } from 'node:http';
import { peerRouteOriginRequestSchema, peerSshEndpointSchema } from '@zana-ai/zcc-server-contract';
import { readJsonBody, rejectMobilePeerManagement, sendJson } from '../../http/json.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { PEER_ID } from './peer-auth.js';

const ENROLL = /^\/api\/v1\/peers\/introductions\/([^/]+)\/enroll$/;
const ENDPOINT = /^\/api\/v1\/peers\/ssh-endpoints\/([^/]+)$/;
const SAFE_ERRORS = /^(introduction is not approved|introduction expired|peer is already enrolled|peer installation conflicts|peer installer capacity exceeded|local peer route unavailable)$/;
const ROUTE_ORIGINS = '/api/v1/peers/route-origins';

function pathId(match: RegExpMatchArray | null): string | null | undefined {
  if (!match) return undefined;
  try { const value = decodeURIComponent(match[1]!); return PEER_ID.test(value) ? value : null; } catch { return null; }
}

/** Composed after product browser/desktop authorization. Responses never include codes, keys or tunnels. */
export async function handlePeerInstallerApi(request: IncomingMessage, response: ServerResponse, ctx: ProductHttpContext,
  path: string, method: string): Promise<boolean> {
  if (path === ROUTE_ORIGINS) return (method !== 'GET' && rejectMobilePeerManagement(request, response)) || handleRouteOrigins(request, response, ctx, method);
  const enrollId = pathId(path.match(ENROLL)), endpointId = pathId(path.match(ENDPOINT));
  if (enrollId === undefined && endpointId === undefined && path !== '/api/v1/peers/installations' && path !== '/api/v1/peers/ssh-endpoints') return false;
  const installer = ctx.peerInstaller, endpoints = ctx.peerSshEndpoints;
  if (method !== 'GET' && rejectMobilePeerManagement(request, response)) return true;
  if (enrollId !== undefined) {
    if (method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return true; }
    if (!installer) { sendJson(response, 503, { error: 'peer installer unavailable' }); return true; }
    if (enrollId === null) { sendJson(response, 400, { error: 'invalid introduction id' }); return true; }
    const controller = new AbortController(), cancel = () => controller.abort();
    response.once('close', cancel);
    try { sendJson(response, 200, await installer.enroll(enrollId, controller.signal)); }
    catch (error) {
      const message = error instanceof Error && SAFE_ERRORS.test(error.message) ? error.message : 'peer enrollment failed';
      if (!response.destroyed) sendJson(response, 409, { error: message });
    } finally { response.off('close', cancel); }
    return true;
  }
  if (path === '/api/v1/peers/installations') {
    if (method !== 'GET') { sendJson(response, 405, { error: 'method not allowed' }); return true; }
    if (!installer) { sendJson(response, 503, { error: 'peer installer unavailable' }); return true; }
    try { sendJson(response, 200, { installations: await installer.list() }); }
    catch { sendJson(response, 503, { error: 'peer installer unavailable' }); }
    return true;
  }
  if (!endpoints) { sendJson(response, 503, { error: 'peer ssh endpoints unavailable' }); return true; }
  if (endpointId !== undefined) {
    if (method !== 'DELETE') { sendJson(response, 405, { error: 'method not allowed' }); return true; }
    if (endpointId === null) { sendJson(response, 400, { error: 'invalid peer id' }); return true; }
    try { sendJson(response, 200, { removed: await endpoints.remove(endpointId) }); }
    catch { sendJson(response, 503, { error: 'peer ssh endpoints unavailable' }); }
    return true;
  }
  if (method === 'GET') {
    try { sendJson(response, 200, { endpoints: await endpoints.list() }); }
    catch { sendJson(response, 503, { error: 'peer ssh endpoints unavailable' }); }
    return true;
  }
  if (method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return true; }
  let body: unknown;
  try { body = await readJsonBody(request, 8192); } catch { sendJson(response, 400, { error: 'invalid JSON' }); return true; }
  const parsed = peerSshEndpointSchema.safeParse(body);
  if (!parsed.success) { sendJson(response, 400, { error: 'invalid pinned SSH endpoint' }); return true; }
  try { sendJson(response, 201, await endpoints.register(parsed.data)); }
  catch (error) {
    const invalid = error instanceof Error && /^invalid pinned SSH endpoint$/i.test(error.message);
    sendJson(response, invalid ? 400 : 409, { error: invalid ? 'invalid pinned SSH endpoint' : 'peer ssh endpoint unavailable' });
  }
  return true;
}

/** Owner-managed advertised-route allowlist. Validation failures are 400; capacity is 409; storage failures are 503. */
async function handleRouteOrigins(request: IncomingMessage, response: ServerResponse, ctx: ProductHttpContext, method: string): Promise<boolean> {
  const origins = ctx.peerRouteAllowlist;
  if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') { sendJson(response, 405, { error: 'method not allowed' }); return true; }
  if (!origins) { sendJson(response, 503, { error: 'peer route origins unavailable' }); return true; }
  if (method === 'GET') {
    try { sendJson(response, 200, { origins: await origins.list() }); }
    catch { sendJson(response, 503, { error: 'peer route origins unavailable' }); }
    return true;
  }
  let body: unknown;
  try { body = await readJsonBody(request, 4096); } catch { sendJson(response, 400, { error: 'invalid JSON' }); return true; }
  const parsed = peerRouteOriginRequestSchema.safeParse(body);
  if (!parsed.success) { sendJson(response, 400, { error: 'invalid peer route origin' }); return true; }
  try {
    if (method === 'POST') sendJson(response, 201, { origin: await origins.add(parsed.data.origin) });
    else sendJson(response, 200, { removed: await origins.remove(parsed.data.origin) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'invalid peer route origin') sendJson(response, 400, { error: message });
    else if (message === 'peer route origin capacity exceeded') sendJson(response, 409, { error: message });
    else sendJson(response, 503, { error: 'peer route origins unavailable' });
  }
  return true;
}
