import { PEER_TOOL_PATH, PEER_TOOL_PROOF_HEADER, signPeerToolRequest } from '@zana-ai/zcc-server/http/peer-tool-proof';
import type { PeerCaller } from '@zana-ai/zcc-server/services/agents/peer-tool-contract';

/** Bounded main-to-server bridge; caller identity is resolved from main's PTY. */
export function createThreadPeerTools(deps: {
  serverUrl(): string; credential(): string; caller(sessionId: string): PeerCaller | null; fetch?: typeof fetch
}) {
  return async (sessionId: string, name: 'list_agents' | 'find_agent' | 'agent_send', input: unknown): Promise<unknown> => {
    const caller = deps.caller(sessionId);
    if (!caller) throw new Error('Peer communication requires a live CLI Agent session');
    const body = JSON.stringify({ caller, name, input });
    const response = await (deps.fetch ?? fetch)(new URL(PEER_TOOL_PATH, deps.serverUrl()), {
      method: 'POST', headers: { 'content-type': 'application/json',
        [PEER_TOOL_PROOF_HEADER]: signPeerToolRequest(deps.credential(), body) },
      body, signal: AbortSignal.timeout(10_000)
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Peer response is empty');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 512_000) throw new Error('Peer response is too large');
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const raw = Buffer.concat(chunks).toString('utf8');
    const result = JSON.parse(raw) as { ok?: boolean; value?: unknown; error?: string };
    if (!response.ok || result.ok !== true) throw new Error(result.error || 'Thread peer service is unavailable');
    return result.value;
  };
}
