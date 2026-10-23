import { describe, expect, it, vi } from 'vitest';
import { createInteractionProofVerifier, INTERACTION_PROOF_HEADER } from '@zana-ai/zcc-server/http/interaction-proof';
import { createInteractionResponder } from './interaction-proof.js';

const secret = 's'.repeat(32);
const input = { threadId: 'thread/1', interactionId: 'interaction', value: true };
describe('main interaction responder', () => {
  it('sends proof to loopback only, returns response without proof material', async () => {
    const verify = createInteractionProofVerifier(secret);
    const fetchImpl = vi.fn<typeof fetch>(async (url, options) => {
      expect(String(url)).toContain('/threads/thread%2F1/interactions/interaction/respond');
      expect(options?.redirect).toBe('error');
      expect(verify((options?.headers as Record<string, string>)[INTERACTION_PROOF_HEADER], { ...input, body: String(options?.body) })).toBe('human');
      return Response.json({ resolution: { actor: 'human' } });
    });
    expect(await createInteractionResponder({ serverUrl: () => 'http://127.0.0.1/', secret: () => secret, fetch: fetchImpl })(input, 'human', 'window:7')).toEqual({ resolution: { actor: 'human' } });
  });
  it.each([null, {}, { ...input, value: undefined }, { ...input, threadId: '' }, { ...input, interactionId: 'x'.repeat(257) }, { ...input, value: 'x'.repeat(65 * 1024) }])('rejects malformed or oversized response %#', async input => {
    const fetchImpl = vi.fn();
    await expect(createInteractionResponder({ serverUrl: () => 'http://127.0.0.1/', secret: () => secret, fetch: fetchImpl })(input, 'human', 'window')).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects remote endpoints, server refusal and missing signer', async () => {
    await expect(createInteractionResponder({ serverUrl: () => 'https://example.com/', secret: () => secret })(input, 'human', 'window')).rejects.toThrow('loopback');
    await expect(createInteractionResponder({ serverUrl: () => 'http://localhost/', secret: () => '' })(input, 'human', 'window')).rejects.toThrow('unavailable');
    const respond = createInteractionResponder({ serverUrl: () => 'http://localhost/', secret: () => secret, fetch: async () => Response.json({ message: 'Human proof required' }, { status: 403 }) });
    await expect(respond(input, 'agent', 'control:agent')).rejects.toThrow('Human proof required');
  });
});
