import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, expect, it, vi } from 'vitest';
import { getHost } from '@zana-ai/zcc-db';
import { hashHostKey } from './host-hub.js';
import { handleHostInternalHttp } from './host-internal.js';
import { CliCallbackError } from '../services/launch/cli-callback-authority.js';
vi.mock('@zana-ai/zcc-db', async original => ({ ...await original<object>(), getHost: vi.fn() }));
const hostKey = 'fixture-host-key';
const input = { sessionId: '11111111-1111-4111-8111-111111111111', path: '/mcp/project/session/key', headers: {}, bodyBase64: '' };
beforeEach(() => { vi.mocked(getHost).mockReturnValue({ id: 'host', hostKeyHash: hashHostKey(hostKey), enrollmentCapability: 'execution' } as never); });
function request(body: unknown = input, extra: { method?: string; headers?: Record<string, string>; raw?: string } = {}): IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(extra.raw ?? JSON.stringify(body))]), { method: extra.method ?? 'POST', url: '/internal/hosts/cli-callback', headers: { host: '127.0.0.1:8780', authorization: `Bearer ${hostKey}`, 'x-zcc-host-id': 'host', ...extra.headers } }) as IncomingMessage;
}
function fixture() {
  const forward = vi.fn(async () => ({ status: 200, bodyBase64: '' }));
  const ctx = { db: {}, config: { getConfig: () => ({}) }, cliCallbacks: { forward } };
  function response() {
    const captured = { status: 0, body: undefined as unknown };
    const res = Object.assign(new EventEmitter(), { destroyed: false, writeHead(status: number) { captured.status = status; return res; }, end(body?: string) { captured.body = body ? JSON.parse(body) : undefined; }, getHeader() {} });
    return { ...captured, capture: captured, response: res as unknown as ServerResponse };
  }
  return { ctx, forward, response, async send(req = request()) { const r = response(); await handleHostInternalHttp(req, r.response, ctx as never); return r.capture; } };
}
it('requires inner host auth and a non-browser POST before dispatch', async () => {
  const f = fixture();
  expect((await f.send(request(input, { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
  for (const headers of [{ origin: '' }, { origin: 'https://elsewhere' }, { 'sec-fetch-site': 'none' }]) expect((await f.send(request(input, { headers }))).status).toBe(403);
  expect((await f.send(request(input, { method: 'GET' }))).status).toBe(405);
  expect(f.forward).not.toHaveBeenCalled();
});
it('validates the closed wire request, requires a callback owner, and hides upstream errors', async () => {
  const f = fixture();
  expect((await f.send(request({}, { raw: '{' }))).status).toBe(400);
  expect((await f.send(request({ ...input, destination: 'http://elsewhere' }))).status).toBe(400);
  expect(await f.send()).toEqual({ status: 200, body: { status: 200, bodyBase64: '' } });
  f.forward.mockRejectedValueOnce(new CliCallbackError(403, 'wrong session')); expect((await f.send()).status).toBe(403);
  f.forward.mockRejectedValueOnce(new Error('private credential failure')); expect(await f.send()).toEqual({ status: 502, body: { error: 'CLI callback unavailable or not authorized' } });
  f.ctx.cliCallbacks = undefined as never; expect((await f.send()).status).toBe(503);
});
it('bounds concurrent HTTP callbacks and aborts a disconnected caller', async () => {
  const f = fixture(); const held: Array<{ resolve: (value: { status: number; bodyBase64: string }) => void; signal: AbortSignal }> = [];
  f.forward.mockImplementation(((_host: string, _body: unknown, signal: AbortSignal) => new Promise(resolve => held.push({ resolve, signal }))) as never);
  const responses = Array.from({ length: 8 }, () => f.response());
  const running = responses.map(r => handleHostInternalHttp(request(), r.response, f.ctx as never));
  try {
    await vi.waitFor(() => expect(held).toHaveLength(8)); expect((await f.send()).status).toBe(429);
    responses[0]!.response.emit('close'); expect(held[0]!.signal.aborted).toBe(true);
  } finally { held.forEach(call => call.resolve({ status: 200, bodyBase64: '' })); await Promise.all(running); }
  f.forward.mockResolvedValue({ status: 200, bodyBase64: '' }); expect((await f.send()).status).toBe(200);
});
it('reserves a separate pool so held /mcp callbacks never starve native tool policy calls', async () => {
  const f = fixture(); const held: Array<(value: { status: number; bodyBase64: string }) => void> = [];
  f.forward.mockImplementation((() => new Promise(resolve => held.push(resolve))) as never);
  const nativeInput = { ...input, path: '/hook/nativetool/project/11111111-1111-4111-8111-111111111111' };
  const mcp = Array.from({ length: 8 }, () => handleHostInternalHttp(request(), f.response().response, f.ctx as never));
  try {
    await vi.waitFor(() => expect(held).toHaveLength(8));
    expect((await f.send()).status).toBe(429);
    const native = Array.from({ length: 64 }, () => handleHostInternalHttp(request(nativeInput), f.response().response, f.ctx as never));
    await vi.waitFor(() => expect(held).toHaveLength(72));
    expect((await f.send(request(nativeInput))).status).toBe(429);
    held.splice(0).forEach(resolve => resolve({ status: 200, bodyBase64: '' }));
    await Promise.all(native);
  } finally { held.splice(0).forEach(resolve => resolve({ status: 200, bodyBase64: '' })); await Promise.all(mcp); }
  f.forward.mockResolvedValue({ status: 200, bodyBase64: '' });
  expect((await f.send()).status).toBe(200); expect((await f.send(request(nativeInput))).status).toBe(200);
});
