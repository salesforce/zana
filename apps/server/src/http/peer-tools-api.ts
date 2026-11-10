import { z } from 'zod';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { headerValue } from './browser-request-guard.js';
import { sendJson } from './json.js';
import type { ProductHttpContext } from './product-context.js';
import { invokeThreadPeerTool } from '../services/threads/thread-peer-communication.js';
import { PEER_TOOL_PATH, PEER_TOOL_PROOF_HEADER, PEER_TOOL_BODY_LIMIT } from './peer-tool-proof.js';

const requestSchema = z.object({
  caller: z.object({ sessionId: z.string().min(1).max(200), projectId: z.string().min(1).max(200),
    kind: z.literal('cli-agent'), displayName: z.string().min(1).max(200), hops: z.number().int().min(0).max(8).optional() }).strict(),
  name: z.enum(['list_agents', 'find_agent', 'agent_send']), input: z.unknown()
}).strict();

export async function handlePeerToolsApi(request: IncomingMessage, response: ServerResponse,
  ctx: ProductHttpContext, path: string, method: string): Promise<boolean> {
  if (path !== PEER_TOOL_PATH) return false;
  if (method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return true; }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > PEER_TOOL_BODY_LIMIT) { sendJson(response, 413, { error: 'Peer request is too large' }); return true; }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (!ctx.verifyPeerTool?.(headerValue(request.headers, PEER_TOOL_PROOF_HEADER), body)) {
    sendJson(response, 403, { error: 'Peer identity must be asserted by the desktop app' }); return true;
  }
  try {
    const parsed = requestSchema.parse(JSON.parse(body));
    const result = await invokeThreadPeerTool(ctx, parsed.caller, parsed.name, parsed.input, { threadsOnly: true });
    sendJson(response, 200, { ok: true, value: result });
  } catch (error) {
    sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : 'Peer operation failed' });
  }
  return true;
}
