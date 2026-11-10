import type { InteractionActor } from '@zana-ai/zcc-domain';
import { jsonValueSchema, PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES } from '@zana-ai/zcc-domain/thread-runtime';
import { INTERACTION_PROOF_HEADER, signInteractionProof } from '@zana-ai/zcc-server/http/interaction-proof';

/** The server wants a confirmation sheet main draws itself; `title` and `pluginId` are server-supplied. */
export class NativeSheetRequiredError extends Error {
  constructor(readonly title: string, readonly pluginId: string) {
    super('Native approval sheet required');
    this.name = 'NativeSheetRequiredError';
  }
}

export function createInteractionResponder(deps: {
  serverUrl(): string;
  secret(): string;
  fetch?: typeof fetch;
}) {
  return async (raw: unknown, actor: InteractionActor, source: string): Promise<unknown> => {
    const input = raw as { threadId?: unknown; sessionId?: unknown; interactionId?: unknown; value?: unknown } | null;
    const key = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
    // Exactly one key names the interaction's owner: a thread record, or a PTY session without one.
    if (!input || key(input.threadId) === key(input.sessionId)
      || (input.threadId !== undefined && !key(input.threadId)) || (input.sessionId !== undefined && !key(input.sessionId))
      || !key(input.interactionId)) {
      throw new Error('Invalid interaction response');
    }
    const owner = typeof input.sessionId === 'string' ? { sessionId: input.sessionId } : { threadId: input.threadId as string };
    const value = jsonValueSchema.parse(input.value);
    const body = JSON.stringify({ value });
    if (Buffer.byteLength(body) > PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES) throw new Error('Interaction response exceeds 64 KiB');
    const base = new URL(deps.serverUrl());
    if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost'].includes(base.hostname)) {
      throw new Error('Interaction proof requires loopback product server');
    }
    const proof = signInteractionProof(deps.secret(), {
      ...owner, interactionId: input.interactionId, body
    }, actor, source);
    const response = await (deps.fetch ?? fetch)(new URL(
      `api/v1/${'sessionId' in owner ? 'pty-sessions' : 'threads'}/${encodeURIComponent(owner.sessionId ?? owner.threadId)}/interactions/${encodeURIComponent(input.interactionId)}/respond`, base
    ), { method: 'POST', headers: { 'content-type': 'application/json', [INTERACTION_PROOF_HEADER]: proof }, body,
      redirect: 'error', signal: AbortSignal.timeout(5000) });
    // A proxy or empty error body is not JSON; keep the HTTP status instead of a SyntaxError.
    const result = await response.json().catch(() => ({})) as { message?: string; error?: string; title?: unknown; pluginId?: unknown };
    if (response.status === 403 && result.error === 'native-sheet-required'
      && typeof result.title === 'string' && typeof result.pluginId === 'string') {
      throw new NativeSheetRequiredError(result.title, result.pluginId);
    }
    if (!response.ok) throw new Error(result.message ?? result.error ?? `HTTP ${response.status}`);
    return result;
  };
}
