import type { IncomingMessage, ServerResponse } from 'node:http';
import { approvePeerConnectionRequestSchema, joinPeerConnectionRequestSchema, type PeerConnection } from '@zana-ai/zcc-server-contract';
import { readJsonBody, rejectMobilePeerManagement, sendJson } from './json.js';
import type { ProductHttpContext } from './product-context.js';
import { InvitationError, type PublicInvitationStatus } from '../services/peers/peer-invitation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_LIMIT = 20;
const CHECK_MS = 20_000;

/** The renderer sees status only: never the consent digest, pairing id or any key. */
export function toPeerConnection(status: PublicInvitationStatus): PeerConnection {
  return {
    invitationId: status.invitationId,
    role: status.role,
    state: status.state,
    ...(status.reason ? { reason: status.reason } : {}),
    expiresAt: status.consentExpiresAt && status.state !== 'open' ? status.consentExpiresAt : status.expiresAt,
    ...(status.peer ? { peer: { name: status.peer.name, fingerprint: status.peer.fingerprint } } : {}),
    ...(status.pairingCode ? { pairingCode: status.pairingCode } : {}),
    awaitingApproval: status.role === 'inviter' && status.state === 'reserved' && status.inviterDecision === 'pending'
  };
}

function sendInvitationError(response: ServerResponse, error: unknown): void {
  // Only fixed-message InvitationErrors reach the renderer; anything else may embed a path, token or key.
  if (!(error instanceof InvitationError)) {
    // Error name only in the local log: the message may embed a path or key.
    console.warn(`[peer-connections] request failed: ${error instanceof Error ? error.name : typeof error}`);
    sendJson(response, 503, { error: 'Pairing is unavailable right now. Try again.' });
    return;
  }
  const status = error.code === 'not_found' ? 404 : error.code === 'unavailable' ? 503 : 400;
  sendJson(response, status, { error: error.message, reason: error.code });
}

/**
 * Core-owned Add / Join / Approve. Main-side validation: the renderer supplies only an invitation id and what the owner
 * typed. Records are core's own (no plugin id), so a plugin invitation id is simply not found. Approval needs the typed
 * pairing code; the single-use approval proof is minted here, after the code matched, never accepted from the renderer.
 */
export async function handlePeerConnectionsApi(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext,
  path: string,
  method: string
): Promise<boolean> {
  if (path !== '/api/v1/peer-connections' && !path.startsWith('/api/v1/peer-connections/')) return false;
  if (rejectMobilePeerManagement(request, response)) return true;
  const invitations = ctx.peerInvitations;
  if (!invitations) { sendJson(response, 503, { error: 'Computer connections are unavailable on this install.' }); return true; }

  if (path === '/api/v1/peer-connections' && method === 'GET') {
    try { sendJson(response, 200, { connections: (await invitations.list({ limit: LIST_LIMIT })).map(toPeerConnection) }); }
    catch (error) { sendInvitationError(response, error); }
    return true;
  }
  if (path === '/api/v1/peer-connections' && method === 'POST') {
    try {
      const created = await invitations.create({});
      sendJson(response, 201, { invitationId: created.invitationId, token: created.token, expiresAt: created.expiresAt, code: created.code });
    } catch (error) { sendInvitationError(response, error); }
    return true;
  }
  if (path === '/api/v1/peer-connections/remote-login' && method === 'POST') {
    if (!ctx.peerRemoteLoginCheck) { sendJson(response, 503, { error: 'Computer connections are unavailable on this install.' }); return true; }
    const signal = AbortSignal.timeout(CHECK_MS);
    sendJson(response, 200, await ctx.peerRemoteLoginCheck(signal));
    return true;
  }
  if (path === '/api/v1/peer-connections/join' && method === 'POST') {
    let body: unknown;
    try { body = await readJsonBody(request, 16_384); } catch { sendJson(response, 400, { error: 'invalid JSON' }); return true; }
    const parsed = joinPeerConnectionRequestSchema.safeParse(body);
    if (!parsed.success) { sendJson(response, 400, { error: 'invalid invitation', reason: 'invalid_invitation' }); return true; }
    try { sendJson(response, 201, toPeerConnection(await invitations.redeem({ token: parsed.data.token.trim(), code: parsed.data.code }))); }
    catch (error) { sendInvitationError(response, error); }
    return true;
  }

  const match = /^\/api\/v1\/peer-connections\/([^/]+)(?:\/(approve|deny))?$/.exec(path);
  if (!match) { sendJson(response, 404, { error: 'not found' }); return true; }
  const invitationId = match[1]!, action = match[2];
  if (!UUID.test(invitationId)) { sendJson(response, 404, { error: 'peer connection not found', reason: 'not_found' }); return true; }

  try {
    if (action === 'approve' && method === 'POST') {
      let body: unknown;
      try { body = await readJsonBody(request, 1024); } catch { sendJson(response, 400, { error: 'invalid JSON' }); return true; }
      const parsed = approvePeerConnectionRequestSchema.safeParse(body);
      if (!parsed.success) { sendJson(response, 400, { error: 'Type the code shown on the other computer.', reason: 'identity_mismatch' }); return true; }
      if (!ctx.mintCoreApproval) { sendJson(response, 503, { error: 'Approval is unavailable in this session.' }); return true; }
      const { binding } = await invitations.approvalRequest({ invitationId });
      sendJson(response, 200, toPeerConnection(await invitations.decide({
        invitationId, decision: 'approved', ownerProof: ctx.mintCoreApproval(binding), pairingCode: parsed.data.code
      })));
      return true;
    }
    if (action === 'deny' && method === 'POST') {
      sendJson(response, 200, toPeerConnection(await invitations.decide({ invitationId, decision: 'denied' })));
      return true;
    }
    if (!action && method === 'DELETE') {
      sendJson(response, 200, toPeerConnection(await invitations.cancel({ invitationId })));
      return true;
    }
  } catch (error) { sendInvitationError(response, error); return true; }
  sendJson(response, 404, { error: 'not found' });
  return true;
}
