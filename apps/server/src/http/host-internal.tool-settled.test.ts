import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConversationThread, getHost } from '@zana-ai/zcc-db';
import { handleHostInternalHttp } from './host-internal.js';
import type { ProductHttpContext } from './product-context.js';

vi.mock('@zana-ai/zcc-db', () => ({ getConversationThread: vi.fn(), getHost: vi.fn(), getThreadPluginMetadata: vi.fn(), upsertHost: vi.fn() }));
vi.mock('./host-hub.js', async importOriginal => ({ ...await importOriginal<typeof import('./host-hub.js')>(), hostKeyMatches: () => true }));
vi.mock('./public-app-url.js', async importOriginal => ({ ...await importOriginal<typeof import('./public-app-url.js')>(), isAllowedHostInternalHost: () => true }));

const THREAD = '11111111-1111-4111-8111-111111111111';
const thread = { id: THREAD, projectId: 'project-1', hostId: 'host-1', providerId: 'claude-code', providerThreadId: 'provider', status: 'active' };

beforeEach(() => {
  vi.mocked(getHost).mockReturnValue({ id: 'host-1', hostKeyHash: 'hash', enrollmentCapability: 'execution' } as never);
  vi.mocked(getConversationThread).mockReturnValue(thread as never);
});
afterEach(() => vi.clearAllMocks());

async function post(path: string, payload: unknown, ctx: Record<string, unknown>) {
  const request = Object.assign(Readable.from([Buffer.from(JSON.stringify(payload))]), {
    method: 'POST', url: path, headers: { authorization: 'Bearer host-key-host-key-host-key-host', 'x-zcc-host-id': 'host-1' }
  }) as IncomingMessage;
  const result: { status: number; body?: string } = { status: 0 };
  const response = Object.assign(new EventEmitter(), {
    statusCode: 0, headersSent: false, destroyed: false,
    writeHead(code: number) { result.status = code; return response; },
    setHeader() {}, getHeader() { return undefined; },
    end(value?: string) { result.status ||= response.statusCode; result.body = value; }
  }) as unknown as ServerResponse & { statusCode: number };
  await handleHostInternalHttp(request, response, ctx as unknown as ProductHttpContext);
  return result;
}

const session = { instanceId: 'instance', socket: { readyState: 1, OPEN: 1 } };
const base = { config: { getConfig: () => ({}) }, db: {}, hostHub: { getSession: () => session } };
const policy = { sessionId: 'instance', threadId: THREAD, providerId: 'claude-code', providerThreadId: 'provider', callId: 'call-1', toolName: 'Bash', input: { command: 'ls' } };
const settled = {
  sessionId: 'instance', threadId: THREAD, providerId: 'claude-code', providerThreadId: 'provider', callId: 'call-1',
  toolName: 'Bash', state: 'succeeded', durationMs: 7, exitCode: 0, outputBytes: 3, output: 'a\nb'
};

describe('POST /internal/hosts/tool-settled', () => {
  it('delivers under the invocation id the policy approved, answers 204, and consumes the correlation', async () => {
    const decideToolPolicy = vi.fn(async () => ({ action: 'allow' as const }));
    const emitToolSettled = vi.fn(async () => undefined);
    const ctx = { ...base, plugins: { decideToolPolicy, emitToolSettled } };
    await post('/internal/hosts/native-tool-policy', policy, ctx);
    const invocationId = (decideToolPolicy.mock.calls[0] as unknown as [{ invocationId: string }])[0].invocationId;
    expect((await post('/internal/hosts/tool-settled', settled, ctx)).status).toBe(204);
    expect(emitToolSettled).toHaveBeenCalledWith({
      invocationId, threadId: THREAD, projectId: 'project-1', providerId: 'claude-code', toolName: 'Bash', state: 'succeeded',
      durationMs: 7, exitCode: 0, outputBytes: 3, output: 'a\nb'
    });
    await post('/internal/hosts/tool-settled', settled, ctx);
    expect(emitToolSettled).toHaveBeenCalledOnce();
  });

  it('drops a denied call and never delays the response on a hung plugin', async () => {
    const hung = vi.fn(() => new Promise<void>(() => undefined));
    const ctx = { ...base, plugins: { decideToolPolicy: vi.fn(async () => ({ action: 'deny' as const, reason: 'no' })), emitToolSettled: hung } };
    await post('/internal/hosts/native-tool-policy', { ...policy, callId: 'call-2' }, ctx);
    expect((await post('/internal/hosts/tool-settled', { ...settled, callId: 'call-2' }, ctx)).status).toBe(204);
    expect(hung).not.toHaveBeenCalled();
    const allow = { ...base, plugins: { decideToolPolicy: vi.fn(async () => ({ action: 'allow' as const })), emitToolSettled: hung } };
    await post('/internal/hosts/native-tool-policy', { ...policy, callId: 'call-3' }, allow);
    expect((await post('/internal/hosts/tool-settled', { ...settled, callId: 'call-3' }, allow)).status).toBe(204);
    expect(hung).toHaveBeenCalledOnce();
  });

  it('rejects malformed bodies, extra fields, and threads that are not this host\'s live session', async () => {
    const emitToolSettled = vi.fn();
    const ctx = { ...base, plugins: { emitToolSettled } };
    expect((await post('/internal/hosts/tool-settled', { ...settled, state: 'weird' }, ctx)).status).toBe(400);
    expect((await post('/internal/hosts/tool-settled', { ...settled, extra: 1 }, ctx)).status).toBe(400);
    expect((await post('/internal/hosts/tool-settled', { ...settled, sessionId: 'other' }, ctx)).status).toBe(409);
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, hostId: 'host-2' } as never);
    expect((await post('/internal/hosts/tool-settled', settled, ctx)).status).toBe(409);
    expect(emitToolSettled).not.toHaveBeenCalled();
  });

  it('answers 204 and emits nothing when the call was never approved on this server', async () => {
    const emitToolSettled = vi.fn();
    expect((await post('/internal/hosts/tool-settled', { ...settled, callId: 'unseen' }, { ...base, plugins: { emitToolSettled } })).status).toBe(204);
    expect(emitToolSettled).not.toHaveBeenCalled();
  });
});
