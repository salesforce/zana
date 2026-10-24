import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { readJsonBody, sendJson } from '../../http/json.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { PEER_ID, PEER_TOKEN, validScope } from './peer-auth.js';

const id = z.string().regex(PEER_ID);
const proposal = z.object({ pairId: id, remoteInstanceId: id, targetHostId: id, pluginId: z.string().regex(PEER_TOKEN),
  scope: z.string().refine(validScope), proposalId: id, epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
const command = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('propose'), proposal }).strict(),
  z.object({ operation: z.literal('activate'), proposal }).strict(),
  z.object({ operation: z.literal('revoke'), pairId: id }).strict(),
  z.object({ operation: z.literal('recover') }).strict()
]);

/** Composed after product browser/desktop authorization, not a credential endpoint. */
export async function handleScopedLinkApi(request: IncomingMessage, response: ServerResponse, ctx: ProductHttpContext,
  path: string, method: string): Promise<boolean> {
  if (path !== '/api/v1/peer-links') return false;
  // The owner's read-only link listing (core Peers hub) shares this path; hosts-api serves it.
  if (method === 'GET') return false;
  if (method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return true; }
  let parsed;
  try { parsed = command.safeParse(await readJsonBody(request, 8192)); }
  catch { sendJson(response, 400, { error: 'invalid peer link command' }); return true; }
  if (!parsed.success) { sendJson(response, 400, { error: 'invalid peer link command' }); return true; }
  try {
    const input = parsed.data;
    if (input.operation === 'revoke') { await ctx.peerAuthority.revoke(input.pairId); sendJson(response, 200, { revoked: true }); }
    else if (input.operation === 'recover') sendJson(response, 200, await ctx.peerAuthority.recover());
    else sendJson(response, 200, await ctx.peerAuthority[input.operation]({ ...input.proposal, localInstanceId: ctx.productInstanceId }));
  } catch { sendJson(response, 409, { error: 'peer link authority unavailable or not authorized' }); }
  return true;
}
