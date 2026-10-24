import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { handleScopedLinkApi } from './scoped-link-api.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const proposal = { pairId: 'pair-1', remoteInstanceId: 'remote', targetHostId: 'host', pluginId: 'test-plugin', scope: 'opaque', proposalId: 'proposal', epoch: 1 };
function fixture() {
  const authority = { propose: vi.fn(async () => ({ pairId: 'pair-1', status: 'proposed' })), activate: vi.fn(async () => ({ status: 'active' })),
    revoke: vi.fn(async () => {}), recover: vi.fn(async () => ({ pending: 0, blocked: 0 })) };
  return { authority, async send(body: unknown, method = 'POST', path = '/api/v1/peer-links', raw?: string) {
    const req = Object.assign(Readable.from([Buffer.from(raw ?? JSON.stringify(body))]), { url: path, method, headers: {} }) as IncomingMessage;
    let status = 0, output: unknown;
    const res = Object.assign(new EventEmitter(), { writeHead(code: number) { status = code; return res; }, getHeader() {}, end(bytes: string) { output = JSON.parse(bytes); } }) as unknown as ServerResponse;
    const handled = await handleScopedLinkApi(req, res, { productInstanceId: 'local', peerAuthority: authority } as never, path, method);
    return { handled, status, output };
  } };
}
it('routes bounded lifecycle commands and stamps local identity from core', async () => {
  const f = fixture();
  expect((await f.send({ operation: 'propose', proposal })).status).toBe(200);
  expect(f.authority.propose).toHaveBeenCalledWith({ ...proposal, localInstanceId: 'local' });
  expect((await f.send({ operation: 'activate', proposal })).status).toBe(200);
  expect((await f.send({ operation: 'revoke', pairId: 'pair-1' })).output).toEqual({ revoked: true });
  expect((await f.send({ operation: 'recover' })).output).toEqual({ pending: 0, blocked: 0 });
  expect((await f.send({}, 'POST', '/api/v1/other')).handled).toBe(false);
  expect((await f.send({}, 'PUT')).status).toBe(405);
  // GET is the owner's link listing, served by hosts-api.
  expect((await f.send({}, 'GET')).handled).toBe(false);
});
it('rejects unknown fields, plaintext credential imports, oversized and malformed payloads', async () => {
  const f = fixture();
  for (const body of [{ operation: 'import', proposal, secret: 'forbidden' }, { operation: 'propose', proposal: { ...proposal, localInstanceId: 'spoofed' } },
    { operation: 'propose', proposal: { ...proposal, capability: 'execution' } }, {}]) expect((await f.send(body)).status).toBe(400);
  expect((await f.send({}, 'POST', undefined, '{')).status).toBe(400);
  expect((await f.send({}, 'POST', undefined, 'x'.repeat(8193))).status).toBe(400);
  expect(f.authority.propose).not.toHaveBeenCalled();
});
it('redacts authority/provider/credential failures', async () => {
  const f = fixture(); f.authority.propose.mockRejectedValueOnce(new Error('private credential'));
  expect(await f.send({ operation: 'propose', proposal })).toEqual({ handled: true, status: 409, output: { error: 'peer link authority unavailable or not authorized' } });
});
