import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConversationThread, getHost } from '@zana-ai/zcc-db';
import { handleHostInternalHttp } from './host-internal.js';
import type { ProductHttpContext } from './product-context.js';

vi.mock('@zana-ai/zcc-db', () => ({ getConversationThread: vi.fn(), getHost: vi.fn(), upsertHost: vi.fn() }));
vi.mock('./host-hub.js', async original => ({ ...await original<typeof import('./host-hub.js')>(), hostKeyMatches: () => true }));
const origin = vi.hoisted(() => ({ allowed: true }));
vi.mock('./public-app-url.js', async original => ({ ...await original<typeof import('./public-app-url.js')>(), isAllowedHostInternalHost: () => origin.allowed }));
const thread = { id: '11111111-1111-4111-8111-111111111111', projectId: 'project', environmentId: 'environment',
  hostId: 'host', providerId: 'provider-exact', providerThreadId: 'provider-thread', status: 'active', archivedAt: null };
const input = { sessionId: 'instance', threadId: thread.id, providerId: thread.providerId,
  providerThreadId: thread.providerThreadId, callId: 'call', toolName: 'Write', input: { path: 'file', token: 'secret' } };
let session: { instanceId: string; socket: { readyState: number; OPEN: number } } | undefined;
let decideToolPolicy: ReturnType<typeof vi.fn>;
function call(body: unknown = input, headers: Record<string, string> = {}, method = 'POST', raw?: string) {
  const request = Object.assign(Readable.from([Buffer.from(raw ?? JSON.stringify(body))]), { method,
    url: '/internal/hosts/native-tool-policy', headers: { authorization: 'Bearer key', 'x-zcc-host-id': 'host', ...headers } }) as IncomingMessage;
  const out = { status: 0, body: undefined as any };
  const response = Object.assign(new EventEmitter(), { writeHead(status: number) { out.status = status; },
    setHeader() {}, getHeader() {}, end(data: string) { out.body = JSON.parse(data); } }) as unknown as ServerResponse;
  const ctx = { db: {}, config: { getConfig: () => ({}) }, hostHub: { getSession: () => session },
    plugins: { decideToolPolicy } } as unknown as ProductHttpContext;
  return { out, ctx, response, run: () => handleHostInternalHttp(request, response, ctx) };
}
beforeEach(() => {
  origin.allowed = true;
  session = { instanceId: 'instance', socket: { readyState: 1, OPEN: 1 } };
  decideToolPolicy = vi.fn(async () => ({ action: 'allow' }));
  vi.mocked(getHost).mockReturnValue({ id: 'host', hostKeyHash: 'hash', enrollmentCapability: 'execution' } as never);
  vi.mocked(getConversationThread).mockReturnValue(thread as never);
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe('authenticated native tool policy route', () => {
  it('derives plugin identity from server records and redacts input', async () => {
    const test = call(); expect(await test.run()).toBe(true);
    expect(test.out).toEqual({ status: 200, body: { action: 'allow' } });
    expect(decideToolPolicy).toHaveBeenCalledWith({ invocationId: expect.stringMatching(/^[a-f0-9]{64}$/),
      threadId: thread.id, projectId: 'project', providerId: 'provider-exact', toolName: 'Write', input: { path: 'file', token: '[REDACTED]' } });
  });
  it.each(['hostId', 'providerId', 'providerThreadId', 'archivedAt', 'status'] as const)('denies mismatched live record %s before plugin dispatch', async field => {
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, [field]: field === 'archivedAt' ? 1 : field === 'status' ? 'stopping' : 'wrong' } as never);
    const test = call(); await test.run(); expect(test.out.body.action).toBe('deny'); expect(decideToolPolicy).not.toHaveBeenCalled();
  });
  it.each(['missing-thread', 'missing-session', 'old-instance', 'closed-socket'])('rejects %s', async mode => {
    if (mode === 'missing-thread') vi.mocked(getConversationThread).mockReturnValue(null);
    else if (mode === 'missing-session') session = undefined;
    else if (mode === 'old-instance') session!.instanceId = 'old';
    else session!.socket.readyState = 3;
    const test = call(); await test.run(); expect(test.out.body.action).toBe('deny'); expect(decideToolPolicy).not.toHaveBeenCalled();
  });
  it.each([null, { ...input, projectId: 'forged' }, { ...input, providerId: '' }, { ...input, input: [] }])('fails closed for invalid body %j', async body => {
    const test = call(body); await test.run(); expect(test.out.body.action).toBe('deny'); expect(decideToolPolicy).not.toHaveBeenCalled();
  });
  it.each(['invalid-json', 'oversized'])('denies %s body', async mode => {
    const test = call(input, {}, 'POST', mode === 'invalid-json' ? '{' : 'x'.repeat(1024 * 1024 + 1));
    await test.run(); expect(test.out.body.action).toBe('deny');
  });
  it.each(['Origin', 'fetch-site', 'untrusted-host', 'missing-key', 'wrong-method'])('rejects %s', async mode => {
    const headers = mode === 'Origin' ? { origin: 'https://evil.test' } : mode === 'fetch-site' ? { 'sec-fetch-site': 'same-origin' }
      : mode === 'missing-key' ? { authorization: '' } : {};
    if (mode === 'untrusted-host') origin.allowed = false;
    const test = call(input, headers, mode === 'wrong-method' ? 'GET' : 'POST'); await test.run();
    expect(test.out.status).toBe(mode === 'missing-key' ? 401 : mode === 'wrong-method' ? 405 : 403);
    expect(decideToolPolicy).not.toHaveBeenCalled();
  });
  it.each(['hostId', 'providerId', 'providerThreadId', 'projectId', 'environmentId', 'archivedAt', 'status', 'deleted', 'host-session', 'socket', 'closed-response'])('rejects late allow after %s changed', async field => {
    decideToolPolicy.mockImplementation(async () => {
      if (field === 'deleted') vi.mocked(getConversationThread).mockReturnValue(null);
      else if (field === 'host-session') session = { ...session! };
      else if (field === 'socket') session!.socket.readyState = 3;
      else if (field === 'closed-response') Object.assign(test.response, { destroyed: true });
      else vi.mocked(getConversationThread).mockReturnValue({ ...thread, [field]: field === 'archivedAt' ? 1 : field === 'status' ? 'error' : 'changed' } as never);
      return { action: 'allow' };
    });
    const test = call(); await test.run();
    if (field === 'closed-response') expect(test.out.status).toBe(0);
    else expect(test.out.body.action).toBe('deny');
  });
  it.each([{}, null, { action: 'allow', extra: true }, { action: 'deny', reason: 'blocked' }])('never coerces malformed policy replies to allow', async decision => {
    decideToolPolicy.mockResolvedValue(decision); const test = call(); await test.run(); expect(test.out.body.action).toBe('deny');
  });
  it('denies unavailable plugin service and policy errors', async () => {
    const test = call(); test.ctx.plugins = undefined; await test.run(); expect(test.out.body.action).toBe('deny');
    decideToolPolicy.mockRejectedValue(new Error('offline')); const failing = call(); await failing.run(); expect(failing.out.body.action).toBe('deny');
  });
  it('bounds plugin wait and ignores late allow', async () => {
    vi.useFakeTimers(); let finish!: (decision: { action: 'allow' }) => void;
    decideToolPolicy.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const test = call(); const running = test.run();
    await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(10_000); await running;
    expect(test.out.body).toEqual({ action: 'deny', reason: 'native policy timed out' });
    finish({ action: 'allow' }); await vi.advanceTimersByTimeAsync(0); expect(test.out.body.action).toBe('deny'); expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds concurrent policy work and releases capacity after timeout', async () => {
    vi.useFakeTimers(); decideToolPolicy.mockImplementation(() => new Promise(() => {}));
    const active = Array.from({ length: 128 }, () => call());
    const running = active.map(test => test.run());
    await vi.advanceTimersByTimeAsync(0);
    const overflow = call(); await overflow.run();
    expect(overflow.out.body).toEqual({ action: 'deny', reason: 'native policy capacity reached' });
    await vi.advanceTimersByTimeAsync(10_000); await Promise.all(running);
    decideToolPolicy.mockResolvedValue({ action: 'allow' });
    const next = call(); await next.run(); expect(next.out.body).toEqual({ action: 'allow' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
