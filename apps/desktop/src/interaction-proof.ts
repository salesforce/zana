import type { InteractionActor } from '@zana-ai/zcc-domain';
import { jsonValueSchema, PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES } from '@zana-ai/zcc-domain/thread-runtime';
import { INTERACTION_PROOF_HEADER, signInteractionProof } from '@zana-ai/zcc-server/http/interaction-proof';

export function createInteractionResponder(deps: {
  serverUrl(): string;
  secret(): string;
  fetch?: typeof fetch;
}) {
  return async (raw: unknown, actor: InteractionActor, source: string): Promise<unknown> => {
    const input = raw as { threadId?: unknown; interactionId?: unknown; value?: unknown } | null;
    if (!input || typeof input.threadId !== 'string' || !input.threadId || input.threadId.length > 256
      || typeof input.interactionId !== 'string' || !input.interactionId || input.interactionId.length > 256) {
      throw new Error('Invalid interaction response');
    }
    const value = jsonValueSchema.parse(input.value);
    const body = JSON.stringify({ value });
    if (Buffer.byteLength(body) > PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES) throw new Error('Interaction response exceeds 64 KiB');
    const base = new URL(deps.serverUrl());
    if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost'].includes(base.hostname)) {
      throw new Error('Interaction proof requires loopback product server');
    }
    const proof = signInteractionProof(deps.secret(), {
      threadId: input.threadId, interactionId: input.interactionId, body
    }, actor, source);
    const response = await (deps.fetch ?? fetch)(new URL(
      `api/v1/threads/${encodeURIComponent(input.threadId)}/interactions/${encodeURIComponent(input.interactionId)}/respond`, base
    ), { method: 'POST', headers: { 'content-type': 'application/json', [INTERACTION_PROOF_HEADER]: proof }, body,
      redirect: 'error', signal: AbortSignal.timeout(5000) });
    const result = await response.json() as { message?: string; error?: string };
    if (!response.ok) throw new Error(result.message ?? result.error ?? `HTTP ${response.status}`);
    return result;
  };
}
