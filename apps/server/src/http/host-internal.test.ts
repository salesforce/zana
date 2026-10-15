import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { handleHostInternalHttp } from './host-internal.js';
import type { ProductHttpContext } from './product-context.js';
import { createJoinCodeStore, JOIN_CODE_TTL_MS } from '../services/hosts/join-codes.js';

const allowed = { value: true };
vi.mock('./public-app-url.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./public-app-url.js')>();
  return { ...actual, isAllowedHostInternalHost: () => allowed.value };
});

const ENROLL_TOKEN = 'enroll-token-enroll-token-enroll';
const OTHER_HOST = '22222222-2222-4222-8222-222222222222';

function req(headers: Record<string, string>, body: unknown = {}): IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: 'POST',
    url: '/internal/hosts/enroll',
    headers
  }) as IncomingMessage;
}

function capture() {
  const out = { status: 0, body: undefined as unknown };
  const response = Object.assign(new EventEmitter(), {
    writeHead(status: number) { out.status = status; return response; },
    end(chunk?: string) { out.body = chunk ? JSON.parse(chunk) : undefined; },
    setHeader() {},
    getHeader() { return undefined; }
  });
  return { response: response as unknown as ServerResponse, out };
}

function context(joinCodes = createJoinCodeStore()): ProductHttpContext {
  return {
    config: { getConfig: () => ({}) },
    joinCodes,
    enrollToken: ENROLL_TOKEN,
    productInstanceId: 'instance-1'
  } as unknown as ProductHttpContext;
}

async function enroll(ctx: ProductHttpContext, headers: Record<string, string>, body: unknown = {}) {
  const { response, out } = capture();
  await handleHostInternalHttp(req(headers, body), response, ctx);
  return out;
}

afterEach(() => {
  allowed.value = true;
  vi.restoreAllMocks();
});

describe('host enroll rejection diagnostics', () => {
  it('logs a distinct reason per failure with an identical 401 response and no secrets', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createJoinCodeStore();
    const ctx = context(store);
    const redeemed = store.mint(Date.now());
    store.redeem(redeemed.joinCode);
    const expired = store.mint(Date.now() - JOIN_CODE_TTL_MS - 1000);
    const cases: Array<[string, Record<string, string>]> = [
      ['missing', { authorization: 'Bearer zcde_unknown-token-value' }],
      ['missing', {}],
      ['expired', { authorization: `Bearer ${expired.joinCode}` }],
      ['redeemed', { authorization: `Bearer ${redeemed.joinCode}` }],
      ['missing', { authorization: 'Bearer zcde_unknown-token-value', 'x-zcc-connect-machine-host': OTHER_HOST }]
    ];
    const bodies: unknown[] = [];
    for (const [, headers] of cases) {
      const out = await enroll(ctx, { 'x-zcc-correlation-id': 'corr-12345678', ...headers });
      expect(out.status).toBe(401);
      bodies.push(out.body);
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(bodies[0]).toEqual({ error: 'unauthorized' });

    const lines = warn.mock.calls.map((call) => call.join(' '));
    expect(lines).toHaveLength(cases.length);
    cases.forEach(([reason], i) => {
      expect(lines[i]).toContain('host enroll rejected');
      expect(lines[i]).toContain(`reason=${reason}`);
      expect(lines[i]).toContain('correlationId=corr-12345678');
    });
    expect(lines[4]).toContain(`hostId=${OTHER_HOST}`);
    expect(lines[2]).toContain(`hostId=${expired.hostId}`);

    const { createHash } = await import('node:crypto');
    const secrets = [redeemed, expired].flatMap((c) => [c.joinCode, createHash('sha256').update(c.joinCode).digest('hex')]);
    secrets.push('zcde_unknown-token-value', ENROLL_TOKEN);
    const all = lines.join('\n');
    for (const secret of secrets) expect(all).not.toContain(secret);
  });

  it('generates a correlation id when none is supplied or the supplied one is malformed, and omits an untrusted host', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = context();
    await enroll(ctx, { authorization: 'Bearer zcde_x', 'x-zcc-correlation-id': 'bad id!', 'x-zcc-connect-machine-host': 'not-a-uuid' });
    const line = warn.mock.calls[0]!.join(' ');
    expect(line).toMatch(/correlationId=[0-9a-f-]{36}/);
    expect(line).toContain('hostId=-');
  });

  it('does not log for a valid loopback token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await enroll(context(), { authorization: `Bearer ${ENROLL_TOKEN}` }, { protocolVersion: 999 });
    expect(out.status).toBe(409);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps 403 origin and 400 invalid JSON behavior unchanged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    allowed.value = false;
    expect((await enroll(context(), { authorization: `Bearer ${ENROLL_TOKEN}` })).status).toBe(403);
    allowed.value = true;
    expect((await enroll(context(), { authorization: `Bearer ${ENROLL_TOKEN}`, origin: 'https://x.test' })).status).toBe(403);
    const { response, out } = capture();
    const bad = Object.assign(Readable.from([Buffer.from('{nope')]), { method: 'POST', url: '/internal/hosts/enroll', headers: { authorization: `Bearer ${ENROLL_TOKEN}` } }) as IncomingMessage;
    await handleHostInternalHttp(bad, response, context());
    expect(out.status).toBe(400);
    const mismatch = await enroll(context(), { authorization: `Bearer ${ENROLL_TOKEN}` }, { protocolVersion: 0 });
    expect(mismatch.status).toBe(409);
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs host_mismatch for 403 and 400 mismatches without changing responses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createJoinCodeStore();
    const issued = store.mint();
    const ctx = context(store);
    const body = { protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId: OTHER_HOST, hostName: 'h', instanceId: OTHER_HOST, homeDir: '/tmp' };
    const bad = await enroll(ctx, { authorization: `Bearer ${issued.joinCode}` }, body);
    expect(bad).toEqual({ status: 400, body: { error: 'join code hostId mismatch' } });
    const forbidden = await enroll(ctx, { authorization: `Bearer ${issued.joinCode}`, 'x-zcc-connect-machine-host': OTHER_HOST }, { ...body, hostId: undefined });
    expect(forbidden).toEqual({ status: 403, body: { error: 'machine enrollment does not belong to this instance and host' } });
    const lines = warn.mock.calls.map((call) => call.join(' '));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(`reason=host_mismatch hostId=${issued.hostId}`);
    expect(lines[1]).toContain(`reason=host_mismatch hostId=${OTHER_HOST}`);
    expect(lines.join('\n')).not.toContain(issued.joinCode);
  });

  it('rejects a join code minted by another product instance', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storeA = createJoinCodeStore();
    const issuedOnA = storeA.mint();
    const instanceB = context(createJoinCodeStore());
    const out = await enroll(instanceB, { authorization: `Bearer ${issuedOnA.joinCode}` }, {
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId: issuedOnA.hostId,
      hostName: 'h',
      instanceId: issuedOnA.hostId,
      homeDir: '/tmp'
    });
    expect(out).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(warn.mock.calls[0]!.join(' ')).toContain('reason=missing');
    expect(storeA.inspect(issuedOnA.joinCode)).toMatchObject({ ok: true });
  });

  it('inspect reports host_mismatch when the claimed host differs from a live code', () => {
    const store = createJoinCodeStore();
    const issued = store.mint();
    expect(store.inspect(issued.joinCode, OTHER_HOST)).toMatchObject({ ok: false, reason: 'host_mismatch' });
  });
});
