import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { handlePeerToolsApi } from './peer-tools-api.js';
import { createPeerToolVerifier, signPeerToolRequest, PEER_TOOL_PATH, PEER_TOOL_PROOF_HEADER, PEER_TOOL_BODY_LIMIT } from './peer-tool-proof.js';
import type { ProductHttpContext } from './product-context.js';
const invoke = vi.hoisted(() => vi.fn(async () => [{ sessionId: 'thread-1' }]));
vi.mock('../services/threads/thread-peer-communication.js', () => ({ invokeThreadPeerTool: invoke }));
const secret = 'peer-api-test-secret'.repeat(3);
const request = { caller: { sessionId: 'cli-1', projectId: 'p1', kind: 'cli-agent', displayName: 'Reviewer' }, name: 'list_agents', input: {} };
beforeEach(() => invoke.mockReset().mockResolvedValue([{ sessionId: 'thread-1' }]));
async function run(body = JSON.stringify(request), options: { proof?: string | null; method?: string; path?: string; noSecret?: boolean } = {}) {
  const proof = options.proof === undefined ? signPeerToolRequest(secret, body) : options.proof;
  const req = Object.assign(Readable.from([Buffer.from(body)]), { headers: proof ? { [PEER_TOOL_PROOF_HEADER]: proof } : {}, method: options.method ?? 'POST' }) as IncomingMessage;
  const output = { status: 0, body: null as unknown };
  const response = Object.assign(new EventEmitter(), { writeHead(status: number) { output.status = status; return response; },
    end(text: string) { output.body = JSON.parse(text); }, setHeader() {}, getHeader() {} }) as unknown as ServerResponse;
  const ctx = { verifyPeerTool: options.noSecret ? undefined : createPeerToolVerifier(secret) } as ProductHttpContext;
  const handled = await handlePeerToolsApi(req, response, ctx, options.path ?? PEER_TOOL_PATH, options.method ?? 'POST');
  return { handled, ...output };
}
describe('thread peer bridge route', () => {
  it('accepts only a signed main assertion and calls the thread-only facade', async () => {
    expect(await run()).toMatchObject({ handled: true, status: 200, body: { ok: true, value: [{ sessionId: 'thread-1' }] } });
    expect(invoke).toHaveBeenCalledWith(expect.anything(), request.caller, 'list_agents', {}, { threadsOnly: true });
  });
  it('refuses absent, forged, expired or secretless proofs before dispatch', async () => {
    for (const options of [{ proof: null }, { proof: 'forged' }, { noSecret: true }, { proof: signPeerToolRequest(secret, JSON.stringify(request), Date.now() - 20_000) }]) {
      expect((await run(undefined, options)).status).toBe(403);
    }
    expect(invoke).not.toHaveBeenCalled();
  });
  it('bounds bodies and methods', async () => {
    expect((await run('x'.repeat(PEER_TOOL_BODY_LIMIT + 1))).status).toBe(413);
    expect((await run(undefined, { method: 'GET' })).status).toBe(405);
    expect((await run(undefined, { path: '/other' })).handled).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON, identity changes and unsupported verbs', async () => {
    for (const body of ['{bad', JSON.stringify({ ...request, caller: { ...request.caller, kind: 'thread' } }),
      JSON.stringify({ ...request, name: 'register_agent' }), JSON.stringify({ ...request, extra: 'forged' })]) {
      expect((await run(body)).status).toBe(400);
    }
    expect(invoke).not.toHaveBeenCalled();
  });
  it('returns an explicit error for a refused delivery', async () => {
    invoke.mockRejectedValueOnce(new Error('Peer name is ambiguous'));
    expect(await run()).toMatchObject({ status: 400, body: { ok: false, error: 'Peer name is ambiguous' } });
  });
});
