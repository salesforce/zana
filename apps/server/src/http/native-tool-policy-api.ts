import type { IncomingMessage, ServerResponse } from 'node:http';
import { NATIVE_TOOL_POLICY_EVENT_MAX_BYTES, NativeToolPolicyRequestSchema } from '@zana-ai/zcc-contracts/runtime';
import { decideMainOwnedToolPolicy } from '../plugins/native-tool-policy.js';
import { headerValue } from './browser-request-guard.js';
import { sendJson } from './json.js';
import { NATIVE_TOOL_POLICY_PATH, NATIVE_TOOL_POLICY_PROOF_HEADER } from './native-tool-policy-proof.js';
import type { ProductHttpContext } from './product-context.js';

class BodyTooLarge extends Error {}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  // No encoding is set on the request, so every chunk is a Buffer.
  for await (const bytes of request as AsyncIterable<Buffer>) {
    size += bytes.length;
    if (size > NATIVE_TOOL_POLICY_EVENT_MAX_BYTES) throw new BodyTooLarge();
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * OBL-004 for PTYs Electron-main owns when no runtime supervisor carries the
 * request (`pnpm dev`, where the product server is its own process). The
 * body is the runtime channel's strict request, so main asserts the identity
 * from its live session exactly as it does there; the proof shows main sent
 * it. Decides with the same function as the runtime channel.
 */
export async function handleNativeToolPolicyApi(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext,
  path: string,
  method: string
): Promise<boolean> {
  if (path !== NATIVE_TOOL_POLICY_PATH || method !== 'POST') return false;
  let body: string;
  try {
    body = await readBody(request);
  } catch (error) {
    if (!(error instanceof BodyTooLarge)) throw error;
    sendJson(response, 413, { error: 'native tool policy request is too large' });
    return true;
  }
  if (!ctx.verifyNativeToolPolicy?.(headerValue(request.headers, NATIVE_TOOL_POLICY_PROOF_HEADER), body)) {
    sendJson(response, 403, { error: 'native tool policy request is not signed by the desktop app' });
    return true;
  }
  let parsed: ReturnType<typeof NativeToolPolicyRequestSchema.safeParse>;
  try {
    parsed = NativeToolPolicyRequestSchema.safeParse(JSON.parse(body));
  } catch {
    sendJson(response, 400, { error: 'native tool policy request is not JSON' });
    return true;
  }
  if (!parsed.success) {
    sendJson(response, 400, { error: 'invalid native tool policy request' });
    return true;
  }
  sendJson(response, 200, await decideMainOwnedToolPolicy(ctx.plugins, parsed.data));
  return true;
}
