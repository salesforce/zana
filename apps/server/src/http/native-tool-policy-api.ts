import type { IncomingMessage, ServerResponse } from 'node:http';
import { DispatchAdmissionMainRequestSchema, NATIVE_TOOL_POLICY_EVENT_MAX_BYTES, NativeToolPolicyRequestSchema } from '@zana-ai/zcc-contracts/runtime';
import { admitMainOwnedDispatch } from '../plugins/dispatch-admission.js';
import { decideMainOwnedToolPolicy } from '../plugins/native-tool-policy.js';
import { headerValue } from './browser-request-guard.js';
import { sendJson } from './json.js';
import { DISPATCH_ADMISSION_PATH, NATIVE_TOOL_POLICY_PATH, NATIVE_TOOL_POLICY_INVENTORY_PATH, NATIVE_TOOL_POLICY_PROOF_HEADER } from './native-tool-policy-proof.js';
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

/**
 * Pre-spawn tool-policy inventory (OBL-018) for when no runtime supervisor
 * carries the read (`pnpm dev`). The body is empty and the proof is bound to
 * that empty body, exactly as main signs it; a missing plugin service reads as
 * not-ready with an empty `required` so main does not refuse a dev launch.
 */
export async function handleNativeToolPolicyInventoryApi(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext,
  path: string,
  method: string
): Promise<boolean> {
  if (path !== NATIVE_TOOL_POLICY_INVENTORY_PATH || method !== 'POST') return false;
  let body: string;
  try {
    body = await readBody(request);
  } catch (error) {
    if (!(error instanceof BodyTooLarge)) throw error;
    sendJson(response, 413, { error: 'native tool policy inventory request is too large' });
    return true;
  }
  if (!ctx.verifyNativeToolPolicy?.(headerValue(request.headers, NATIVE_TOOL_POLICY_PROOF_HEADER), body)) {
    sendJson(response, 403, { error: 'native tool policy inventory request is not signed by the desktop app' });
    return true;
  }
  sendJson(response, 200, ctx.plugins
    ? await ctx.plugins.toolPolicyReadiness()
    : { ready: false, required: [], reason: 'plugin service is unavailable' });
  return true;
}

/**
 * PTY dispatch admission for when no runtime supervisor carries the request
 * (`pnpm dev`). Same proof as the tool-policy route; the body is the strict
 * request main asserted from its own state.
 */
export async function handleDispatchAdmissionApi(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext,
  path: string,
  method: string
): Promise<boolean> {
  if (path !== DISPATCH_ADMISSION_PATH || method !== 'POST') return false;
  let body: string;
  try {
    body = await readBody(request);
  } catch (error) {
    if (!(error instanceof BodyTooLarge)) throw error;
    sendJson(response, 413, { error: 'dispatch admission request is too large' });
    return true;
  }
  if (!ctx.verifyNativeToolPolicy?.(headerValue(request.headers, NATIVE_TOOL_POLICY_PROOF_HEADER), body)) {
    sendJson(response, 403, { error: 'dispatch admission request is not signed by the desktop app' });
    return true;
  }
  let parsed: ReturnType<typeof DispatchAdmissionMainRequestSchema.safeParse>;
  try {
    parsed = DispatchAdmissionMainRequestSchema.safeParse(JSON.parse(body));
  } catch {
    sendJson(response, 400, { error: 'dispatch admission request is not JSON' });
    return true;
  }
  if (!parsed.success) {
    sendJson(response, 400, { error: 'invalid dispatch admission request' });
    return true;
  }
  sendJson(response, 200, await admitMainOwnedDispatch(ctx, parsed.data));
  return true;
}
