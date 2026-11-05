import { describe, expect, it, vi } from 'vitest';
import { createInteractionProofVerifier, INTERACTION_PROOF_HEADER } from '@zana-ai/zcc-server/http/interaction-proof';
import { createInteractionResponder, NativeSheetRequiredError } from './interaction-proof.js';

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
    await expect(createInteractionResponder({ serverUrl: () => 'http://127.0.0.1/', secret: () => secret, fetch: fetchImpl })(input, 'human', 'window:7')).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects remote endpoints, server refusal and missing signer', async () => {
    await expect(createInteractionResponder({ serverUrl: () => 'https://example.com/', secret: () => secret })(input, 'human', 'window:7')).rejects.toThrow('loopback');
    await expect(createInteractionResponder({ serverUrl: () => 'http://localhost/', secret: () => '' })(input, 'human', 'window:7')).rejects.toThrow('unavailable');
    const respond = createInteractionResponder({ serverUrl: () => 'http://localhost/', secret: () => secret, fetch: async () => Response.json({ message: 'Human proof required' }, { status: 403 }) });
    await expect(respond(input, 'agent', 'control:agent')).rejects.toThrow('Human proof required');
  });
  it('answers a PTY session interaction on the session route with a session-bound proof', async () => {
    const verify = createInteractionProofVerifier(secret);
    const session = { sessionId: 'pty/1', interactionId: 'interaction', value: { ok: true } };
    const fetchImpl = vi.fn<typeof fetch>(async (url, options) => {
      expect(String(url)).toContain('/api/v1/pty-sessions/pty%2F1/interactions/interaction/respond');
      const proof = (options?.headers as Record<string, string>)[INTERACTION_PROOF_HEADER];
      expect(verify(proof, { threadId: 'pty/1', interactionId: 'interaction', body: String(options?.body) })).toBeNull();
      return Response.json({ id: 'interaction' });
    });
    const respond = createInteractionResponder({ serverUrl: () => 'http://127.0.0.1/', secret: () => secret, fetch: fetchImpl });
    expect(await respond(session, 'human', 'window:7')).toEqual({ id: 'interaction' });
    // A proof is single-use, so mint again to check the session binding verifies.
    let seen = '';
    const second = createInteractionResponder({ serverUrl: () => 'http://127.0.0.1/', secret: () => secret, fetch: async (_url, options) => {
      seen = (options?.headers as Record<string, string>)[INTERACTION_PROOF_HEADER]!;
      expect(verify(seen, { sessionId: 'pty/1', interactionId: 'interaction', body: String(options?.body) })).toBe('human');
      return Response.json({});
    } });
    await second(session, 'human', 'window:7');
    expect(seen).not.toBe('');
  });
  it.each([
    { threadId: 'a', sessionId: 'b', interactionId: 'i', value: true },
    { sessionId: '', interactionId: 'i', value: true },
    { sessionId: 'x'.repeat(257), interactionId: 'i', value: true },
    { threadId: 7, interactionId: 'i', value: true }
  ])('rejects an ambiguous or malformed owner %#', async bad => {
    const fetchImpl = vi.fn();
    await expect(createInteractionResponder({ serverUrl: () => 'http://127.0.0.1/', secret: () => secret, fetch: fetchImpl })(bad, 'human', 'window:7')).rejects.toThrow('Invalid interaction response');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('turns a native-sheet-required refusal into a typed error carrying what to show', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ error: 'native-sheet-required', message: 'x', title: 'Approve plan', pluginId: 'p' }, { status: 403 }));
    const respond = createInteractionResponder({ serverUrl: () => 'http://127.0.0.1/', secret: () => secret, fetch: fetchImpl });
    const error = await respond(input, 'human', 'window:7').catch(e => e);
    expect(error).toBeInstanceOf(NativeSheetRequiredError);
    expect(error).toMatchObject({ title: 'Approve plan', pluginId: 'p' });
    // A malformed refusal is an ordinary failure, not a sheet prompt.
    const bad = vi.fn<typeof fetch>(async () => Response.json({ error: 'native-sheet-required', message: 'nope' }, { status: 403 }));
    await expect(createInteractionResponder({ serverUrl: () => 'http://127.0.0.1/', secret: () => secret, fetch: bad })(input, 'human', 'window:7')).rejects.toThrow('nope');
  });
});
