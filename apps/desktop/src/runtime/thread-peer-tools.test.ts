import { describe, expect, it, vi } from 'vitest';
import { createThreadPeerTools } from './thread-peer-tools.js';
import { createPeerToolVerifier, PEER_TOOL_PROOF_HEADER } from '@zana-ai/zcc-server/http/peer-tool-proof';

const secret = 'peer-bridge-test'.repeat(4), caller = { sessionId: 'cli-1', projectId: 'p1', kind: 'cli-agent' as const, displayName: 'Reviewer' };
describe('main to thread peer tools bridge', () => {
  it('derives identity in main, binds the body, and sends a bounded request', async () => {
    const fetcher = vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
      expect(JSON.parse(init!.body as string)).toEqual({ caller, name: 'list_agents', input: {} });
      expect(createPeerToolVerifier(secret)((init!.headers as Record<string, string>)[PEER_TOOL_PROOF_HEADER], init!.body as string)).toBe(true);
      expect(init!.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ ok: true, value: [{ sessionId: 'thread-1' }] });
    });
    const call = createThreadPeerTools({ serverUrl: () => 'http://localhost', credential: () => secret, caller: id => id === 'cli-1' ? caller : null, fetch: fetcher as typeof fetch });
    expect(await call('cli-1', 'list_agents', {})).toEqual([{ sessionId: 'thread-1' }]);
    await expect(call('dead-session', 'list_agents', {})).rejects.toThrow('live CLI'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    [Response.json({ ok: false, error: 'recipient archived' }, { status: 400 }), 'recipient archived'],
    [Response.json({}), 'unavailable'], [new Response('bad JSON'), 'JSON'],
    [new Response(null), 'empty'], [new Response('x'.repeat(512_001)), 'too large']
  ])('rejects invalid or refused responses', async (response, error) => {
    const call = createThreadPeerTools({ serverUrl: () => 'http://localhost', credential: () => secret, caller: () => caller,
      fetch: vi.fn(async () => response) as typeof fetch });
    await expect(call('cli-1', 'agent_send', { to: 'peer', message: 'hi' })).rejects.toThrow(error as string);
  });
});
