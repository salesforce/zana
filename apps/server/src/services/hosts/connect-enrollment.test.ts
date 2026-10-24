import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, upsertHost } from '@zana-ai/zcc-db';
import { MobileConnectionStore } from '../../mobile/connection.js';
import { createJoinCodeStore } from './join-codes.js';
import {
  CONNECT_PEER_REQUIRED_MESSAGE, PEER_LINK_PLACEHOLDER_NAME, PEER_LINK_ROTATION_MS, PeerLinkConnectError,
  connectAttemptSecret, connection, connectInstallCommand, issueConnectHostCode, issueConnectPeerLinkCode, listConnectPeerLinkNames,
  peerLinkHostName, peerLinkRotationDue, redeemConnectPeerLinkCode, revokeConnectHost, revokeConnectPeerLink, rotateConnectPeerLinkCode,
  sameAccountInstance, usesConnect
} from './connect-enrollment.js';
import { openConnectDatabase } from '../../../../../website/connect/database.mjs';
import { createRegistry } from '../../../../../website/connect/registry.mjs';
import { createConnectApi } from '../../../../../website/connect/http.mjs';
import type { ProductHttpContext } from '../../http/product-context.js';
it('binds enrollment to this instance, cleans failures, and preserves a repaired host identity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'connect-enrollment-')), db = openDatabase(join(dir, 'state.sqlite'));
  try {
    const ctx = { dataDir: dir, db, productInstanceId: randomUUID(), joinCodes: createJoinCodeStore(db) } as ProductHttpContext;
    const store = new MobileConnectionStore(join(dir, 'mobile', 'connection.json'));
    expect(usesConnect(ctx)).toBe(false);
    await expect(issueConnectHostCode(ctx, { name: 'Laptop' })).rejects.toThrow('Connect this');
    const serverId = randomUUID(), accountUrl = 'https://zana-ide.com', publicUrl = 'https://fixture.zana-ide.com';
    await store.write({ mode: 'connect', accountUrl, serverId, publicUrl, relayToken: 'a'.repeat(43) });
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.instanceId).toBe(ctx.productInstanceId);
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + 'a'.repeat(43));
      return Response.json({ code: 'ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD', serverId, hostId: body.hostId, serverUrl: publicUrl, expiresAt: Date.now() + 60_000 });
    }) as unknown as typeof fetch;
    const issued = await issueConnectHostCode(ctx, { name: 'Laptop' }, fetcher);
    expect(ctx.joinCodes.status(issued.enrollmentId)?.hostId).toBe(issued.hostId);
    const primary = upsertHost(db, { name: 'Primary', hostKeyHash: 'a'.repeat(64) });
    upsertHost(db, { id: issued.hostId, name: 'Laptop', hostKeyHash: 'b'.repeat(64), isPrimary: false });
    const repaired = await issueConnectHostCode(ctx, { name: 'Laptop', hostId: issued.hostId }, fetcher);
    expect(repaired.hostId).toBe(issued.hostId);
    expect(ctx.joinCodes.status(issued.enrollmentId)).toBeNull();
    for (const input of [null, [], {}, { name: 'bad\nname' }, { name: 'Laptop', hostId: primary.id }, { name: 'Laptop', hostId: randomUUID() }, { name: 'Laptop', extra: true }]) await expect(issueConnectHostCode(ctx, input, fetcher)).rejects.toThrow();
    await expect(issueConnectHostCode(ctx, { name: 'Failed' }, (async () => Response.json({ serverId: 'wrong' })) as typeof fetch)).rejects.toThrow('Invalid');
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM host_join_codes').get()).toEqual({ n: 1 });
    const revoke = vi.fn(async () => Response.json({ ok: true })) as unknown as typeof fetch;
    await revokeConnectHost(ctx, issued.hostId, revoke);
    expect(revoke).toHaveBeenCalledWith(accountUrl + '/api/connect/hosts/revoke', expect.objectContaining({ body: JSON.stringify({ hostId: issued.hostId }) }));
    await expect(revokeConnectHost(ctx, issued.hostId, (async () => new Response('', { status: 503 })) as typeof fetch)).rejects.toThrow('503');
    expect(connectInstallCommand({ accountUrl, serverId, code: "quote'code" })).toContain("quote'\\''code");
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('exposes the persisted Connect enrollment to main-side peer grants', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'connect-connection-'));
  try {
    expect(connection({ dataDir: dir }).mode).toBe('unconfigured');
    const serverId = randomUUID(), relayToken = 'b'.repeat(43);
    await new MobileConnectionStore(join(dir, 'mobile', 'connection.json')).write({ mode: 'connect', accountUrl: 'https://zana-ide.com', serverId, publicUrl: 'https://fixture.zana-ide.com', relayToken });
    expect(connection({ dataDir: dir })).toMatchObject({ mode: 'connect', serverId, relayToken, publicUrl: 'https://fixture.zana-ide.com' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------
// Peer-link client
// ---------------------------------------------------------------------------------------------------------------

const ACCOUNT = 'https://connect.example.com';
const CODE = 'ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD';
const reply = (body: unknown, status = 200) => Response.json(body, { status });
const asFetch = (fn: (url: string, init: RequestInit) => Response | Promise<Response>) => vi.fn(fn as never) as unknown as typeof fetch;
const cleanups: Array<() => unknown> = [];
afterEach(() => { for (const fn of cleanups.splice(0).reverse()) fn(); });
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const chars = (...codes: number[]) => String.fromCharCode(...codes);

describe('peerLinkHostName', () => {
  const none = new Set<string>();
  it('formats the name and exposes the placeholder', () => {
    expect(peerLinkHostName('Alice', randomUUID(), none)).toBe('Zana peer link: Alice (sync only)');
    expect(PEER_LINK_PLACEHOLDER_NAME).toBe('Zana peer link: pending invitation (sync only)');
  });

  it('replaces C0, DEL, C1 and bidi controls and collapses whitespace', () => {
    const bidi = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
    expect(peerLinkHostName(`a${chars(1)}b${chars(0x7f)}c${chars(0x85)}d${chars(0)}e`, 'x', none)).toBe('Zana peer link: a b c d e (sync only)');
    for (const code of bidi) {
      const name = peerLinkHostName(`Al${chars(code)}ice`, 'x', none);
      expect(name).toBe('Zana peer link: Al ice (sync only)');
    }
    expect(peerLinkHostName(`  ${chars(0x202e)}  Bob \t\n  Smith  `, 'x', none)).toBe('Zana peer link: Bob Smith (sync only)');
  });

  it('falls back to "unnamed peer" for empty, blank or non-string names', () => {
    for (const value of ['', '   ', chars(0x202e, 0x200f), undefined as unknown as string, 5 as unknown as string]) {
      expect(peerLinkHostName(value, 'x', none)).toBe('Zana peer link: unnamed peer (sync only)');
    }
  });

  it('keeps the whole name within 80 UTF-16 units and never splits a surrogate pair', () => {
    const long = peerLinkHostName('x'.repeat(300), 'x', none);
    expect(long.length).toBe(80);
    expect(long.endsWith(' (sync only)')).toBe(true);
    const odd = peerLinkHostName('a' + '\u{1F600}'.repeat(60), 'x', none);
    expect(odd.length).toBeLessThanOrEqual(80);
    expect(odd).not.toMatch(LONE_SURROGATE);
    expect(odd).toContain('\u{1F600}');
    const even = peerLinkHostName('\u{1F600}'.repeat(60), 'x', none);
    expect(even.length).toBeLessThanOrEqual(80);
    expect(even).not.toMatch(LONE_SURROGATE);
    expect(peerLinkHostName('a'.repeat(51) + ' bbbb', 'x', none)).toBe(`Zana peer link: ${'a'.repeat(51)} (sync only)`);
  });

  it('appends the instance tag on collision and stays within 80', () => {
    const plain = peerLinkHostName('Alice', 'x', none);
    expect(peerLinkHostName('Alice', 'AB-c1_23-zzz', new Set([plain]))).toBe('Zana peer link: Alice (sync only) [abc123]');
    expect(peerLinkHostName('Alice', '---', new Set([plain]))).toBe('Zana peer link: Alice (sync only) [peer]');
    expect(peerLinkHostName('Alice', undefined as unknown as string, new Set([plain]))).toBe('Zana peer link: Alice (sync only) [peer]');
    // Two peers sharing a six-character id prefix must still get distinct names.
    const first = peerLinkHostName('Alice', 'abcdef111', new Set([plain]));
    expect(first).toBe('Zana peer link: Alice (sync only) [abcdef]');
    const second = peerLinkHostName('Alice', 'abcdef222', new Set([plain, first]));
    expect(second).toBe('Zana peer link: Alice (sync only) [abcdef2]');
    expect(second).not.toBe(first);
    const longPlain = peerLinkHostName('x'.repeat(300), 'x', none);
    const tagged = peerLinkHostName('x'.repeat(300), 'abcdef123', new Set([longPlain]));
    expect(tagged.length).toBeLessThanOrEqual(80);
    expect(tagged.endsWith(' (sync only) [abcdef]')).toBe(true);
    const emojiTagged = peerLinkHostName('\u{1F600}'.repeat(100), 'abcdef123', new Set([peerLinkHostName('\u{1F600}'.repeat(100), 'x', none)]));
    expect(emojiTagged.length).toBeLessThanOrEqual(80);
    expect(emojiTagged).not.toMatch(LONE_SURROGATE);
  });
});

describe('peerLinkRotationDue', () => {
  it('flips exactly at the rotation interval', () => {
    expect(peerLinkRotationDue(1000, 1000 + PEER_LINK_ROTATION_MS - 1)).toBe(false);
    expect(peerLinkRotationDue(1000, 1000 + PEER_LINK_ROTATION_MS)).toBe(true);
    expect(peerLinkRotationDue(1000, 1000 + PEER_LINK_ROTATION_MS + 1)).toBe(true);
    expect(peerLinkRotationDue(Number.NaN, 5)).toBe(true);
    expect(peerLinkRotationDue(Infinity, 5)).toBe(true);
    expect(peerLinkRotationDue(Date.now())).toBe(false);
  });
});

describe('connectAttemptSecret', () => {
  it('is a fresh 43-character base64url value', () => {
    const a = connectAttemptSecret(), b = connectAttemptSecret();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(a).not.toBe(b);
  });
});

async function peerFixture(opts: { connect?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'peer-link-')), db = openDatabase(join(dir, 'state.sqlite'));
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const ctx = { dataDir: dir, db, productInstanceId: randomUUID(), joinCodes: createJoinCodeStore(db) } as ProductHttpContext;
  const serverId = randomUUID(), publicUrl = 'https://s-fixture.connect.example.com', relayToken = 'r'.repeat(43);
  if (opts.connect !== false) await new MobileConnectionStore(join(dir, 'mobile', 'connection.json')).write({ mode: 'connect', accountUrl: ACCOUNT, serverId, publicUrl, relayToken });
  return { dir, db, ctx, serverId, publicUrl, relayToken };
}
const okCode = (f: { serverId: string; publicUrl: string }, body: Record<string, any>, over: Record<string, unknown> = {}) =>
  reply({ code: CODE, serverId: f.serverId, hostId: body.hostId, serverUrl: f.publicUrl, expiresAt: Date.now() + 60_000, ...over });
const NAME = 'Zana peer link: Alice (sync only)';

describe('issueConnectPeerLinkCode', () => {
  it('rejects invalid names and host ids before touching Connect', async () => {
    const f = await peerFixture();
    const fetcher = asFetch(() => reply({}));
    const longName = 'Zana peer link: ' + 'x'.repeat(80);
    for (const name of ['', 'Alice', ' Zana peer link: Alice', 'Zana peer link: a  b', `Zana peer link: a${chars(7)}b`, longName, 5 as unknown as string]) {
      await expect(issueConnectPeerLinkCode(f.ctx, { name }, fetcher)).rejects.toMatchObject({ reason: 'invalid_name' });
    }
    await expect(issueConnectPeerLinkCode(f.ctx, null as never, fetcher)).rejects.toMatchObject({ reason: 'invalid_name' });
    for (const hostId of ['nope', 5 as unknown as string]) {
      await expect(issueConnectPeerLinkCode(f.ctx, { name: NAME, hostId }, fetcher)).rejects.toMatchObject({ reason: 'invalid_host' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires connect mode, with the user-facing message', async () => {
    const f = await peerFixture({ connect: false });
    const error = await issueConnectPeerLinkCode(f.ctx, { name: NAME }, asFetch(() => reply({}))).catch(e => e);
    expect(error).toBeInstanceOf(PeerLinkConnectError);
    expect(error).toMatchObject({ name: 'PeerLinkConnectError', reason: 'connect_required', message: CONNECT_PEER_REQUIRED_MESSAGE });
  });

  it('posts the bound request with the server bearer and returns the validated code', async () => {
    const f = await peerFixture();
    const fetcher = asFetch((url, init) => {
      expect(url).toBe(`${ACCOUNT}/api/connect/hosts/code`);
      expect(init.method).toBe('POST');
      expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${f.relayToken}`);
      const body = JSON.parse(String(init.body));
      expect(Object.keys(body).sort()).toEqual(['enrollToken', 'hostId', 'instanceId', 'name']);
      expect(body).toMatchObject({ instanceId: f.ctx.productInstanceId, name: NAME });
      expect(body.enrollToken).toMatch(/^zcde_/);
      return okCode(f, body);
    });
    const issued = await issueConnectPeerLinkCode(f.ctx, { name: NAME }, fetcher);
    expect(issued).toMatchObject({ code: CODE, serverId: f.serverId, accountUrl: ACCOUNT });
    expect(f.db.sqlite.prepare('SELECT enrollment_capability AS c FROM host_join_codes WHERE host_id=?').get(issued.hostId)).toEqual({ c: 'peer.forward' });
  });

  it('invalidates the local join code on every response validation failure', async () => {
    const f = await peerFixture();
    const cases: Array<[string, (body: any) => Record<string, unknown>]> = [
      ['wrong serverId', () => ({ serverId: randomUUID() })],
      ['wrong hostId', () => ({ hostId: randomUUID() })],
      ['wrong serverUrl', () => ({ serverUrl: 'https://evil.example.com' })],
      ['bad code', () => ({ code: 'nope' })],
      ['numeric code', () => ({ code: 5 })],
      ['past expiry', () => ({ expiresAt: Date.now() - 1 })],
      ['beyond join code expiry', () => ({ expiresAt: Date.now() + 60 * 60_000 })],
      ['non-integer expiry', () => ({ expiresAt: Date.now() + 1000.5 })],
      ['string expiry', () => ({ expiresAt: 'soon' })]
    ];
    for (const [label, over] of cases) {
      let hostId = '';
      const fetcher = asFetch((_url, init) => { const body = JSON.parse(String(init.body)); hostId = body.hostId; return okCode(f, body, over(body)); });
      const error = await issueConnectPeerLinkCode(f.ctx, { name: NAME }, fetcher).catch(e => e);
      expect(error, label).toMatchObject({ reason: 'invalid_response' });
      expect(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM host_join_codes WHERE host_id=?').get(hostId), label).toEqual({ n: 0 });
    }
  });

  it('maps Connect and network failures to bounded reasons and cleans up', async () => {
    const f = await peerFixture();
    const run = (fetcher: typeof fetch) => issueConnectPeerLinkCode(f.ctx, { name: NAME }, fetcher).catch(e => e);
    expect(await run(asFetch(() => reply({ error: 'account_limit' }, 409)))).toMatchObject({ reason: 'account_limit', status: 409 });
    expect(await run(asFetch(() => new Response('', { status: 401 })))).toMatchObject({ reason: 'unauthorized', status: 401 });
    expect(await run(asFetch(() => new Response('', { status: 403 })))).toMatchObject({ reason: 'unauthorized' });
    expect(await run(asFetch(() => reply({ error: 'unknown_thing' }, 500)))).toMatchObject({ reason: 'connect_failed', status: 500 });
    expect(await run(asFetch(() => { throw new TypeError('fetch failed: https://secret'); }))).toMatchObject({ reason: 'connect_unreachable', message: 'Zana Connect peer link request failed.' });
    expect(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM host_join_codes').get()).toEqual({ n: 0 });
  });

  it('reports capacity exhaustion and capability mismatch', async () => {
    const f = await peerFixture();
    const invalidateHost = vi.fn();
    const throwing = { ...f.ctx, joinCodes: { mintForwardOnly: () => { throw new Error('Too many'); }, mintForwardOnlyForHost: () => { throw new Error('nope'); }, invalidateHost } } as unknown as ProductHttpContext;
    await expect(issueConnectPeerLinkCode(throwing, { name: NAME })).rejects.toMatchObject({ reason: 'enrollment_capacity' });
    await expect(issueConnectPeerLinkCode(throwing, { name: NAME, hostId: randomUUID() })).rejects.toMatchObject({ reason: 'invalid_host' });
    const wrongCap = { ...f.ctx, joinCodes: { mintForwardOnly: () => ({ joinCode: 'zcde_x', hostId: 'h', expiresAt: Date.now() + 1000, enrollmentCapability: 'execution' }), invalidateHost } } as unknown as ProductHttpContext;
    const fetcher = asFetch(() => reply({}));
    await expect(issueConnectPeerLinkCode(wrongCap, { name: NAME }, fetcher)).rejects.toMatchObject({ reason: 'invalid_host' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(invalidateHost).toHaveBeenCalledWith('h');
  });

  it('rotates an existing peer.forward host via hostId and refuses execution hosts', async () => {
    const f = await peerFixture();
    upsertHost(f.db, { name: 'Primary', hostKeyHash: 'a'.repeat(64), isPrimary: true });
    const peer = upsertHost(f.db, { name: 'Peer', hostKeyHash: 'b'.repeat(64), isPrimary: false, enrollmentCapability: 'peer.forward' });
    const exec = upsertHost(f.db, { name: 'Exec', hostKeyHash: 'c'.repeat(64), isPrimary: false });
    const fetcher = asFetch((_url, init) => okCode(f, JSON.parse(String(init.body))));
    const rotated = await rotateConnectPeerLinkCode(f.ctx, peer.id, NAME, fetcher);
    expect(rotated.hostId).toBe(peer.id);
    expect(f.db.sqlite.prepare('SELECT enrollment_capability AS c FROM host_join_codes WHERE host_id=?').get(peer.id)).toEqual({ c: 'peer.forward' });
    await expect(rotateConnectPeerLinkCode(f.ctx, exec.id, NAME, fetcher)).rejects.toMatchObject({ reason: 'invalid_host' });
    await expect(rotateConnectPeerLinkCode(f.ctx, randomUUID(), NAME, fetcher)).rejects.toMatchObject({ reason: 'invalid_host' });
  });

  it('rejects an execution code for a plugin-link host (repair check)', async () => {
    const f = await peerFixture();
    upsertHost(f.db, { name: 'Primary', hostKeyHash: 'a'.repeat(64), isPrimary: true });
    const peer = upsertHost(f.db, { name: 'Peer', hostKeyHash: 'b'.repeat(64), isPrimary: false, enrollmentCapability: 'peer.forward' });
    await expect(issueConnectHostCode(f.ctx, { name: 'Laptop', hostId: peer.id }, asFetch(() => reply({})))).rejects.toThrow('Choose an existing execution machine');
    // Defensive: a row whose purpose or capability disagrees is also refused.
    const hostId = randomUUID();
    const spoof = { ...f.ctx, db: f.db } as ProductHttpContext;
    upsertHost(f.db, { id: hostId, name: 'Odd', hostKeyHash: 'd'.repeat(64), isPrimary: false });
    f.db.sqlite.prepare("UPDATE hosts SET purpose_kind='plugin-link' WHERE id=?").run(hostId);
    await expect(issueConnectHostCode(spoof, { name: 'Odd', hostId }, asFetch(() => reply({})))).rejects.toThrow('Choose an existing execution machine');
    f.db.sqlite.prepare("UPDATE hosts SET purpose_kind='execution', enrollment_capability='peer.forward' WHERE id=?").run(hostId);
    await expect(issueConnectHostCode(spoof, { name: 'Odd', hostId }, asFetch(() => reply({})))).rejects.toThrow('Choose an existing execution machine');
  });
});

describe('redeemConnectPeerLinkCode', () => {
  const grant = () => ({
    accountUrl: ACCOUNT, serverUrl: 'https://abc.connect.example.com', hostId: randomUUID(), serverId: randomUUID(), instanceId: randomUUID(),
    credential: 'c'.repeat(43), enrollToken: 'zcde_' + 'e'.repeat(24), expiresAt: Date.now() + 1000
  });

  it('rejects bad inputs without calling Connect', async () => {
    const fetcher = asFetch(() => reply(grant()));
    for (const url of ['http://connect.example.com', `${ACCOUNT}/path`, `${ACCOUNT}/`, 'not a url', 5 as unknown as string, 'https://' + 'a'.repeat(2100) + '.com']) {
      await expect(redeemConnectPeerLinkCode(url, CODE, fetcher)).rejects.toMatchObject({ reason: 'invalid_account' });
    }
    for (const code of ['abcd-abcd-abcd-abcd-abcd-abcd-abcd-abcd', 'ABCD', 5 as unknown as string]) {
      await expect(redeemConnectPeerLinkCode(ACCOUNT, code, fetcher)).rejects.toMatchObject({ reason: 'invalid_code' });
    }
    for (const attemptSecret of ['short', 'x'.repeat(44), '!'.repeat(43)]) {
      await expect(redeemConnectPeerLinkCode(ACCOUNT, CODE, fetcher, { attemptSecret })).rejects.toMatchObject({ reason: 'invalid_attempt' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends a provided attempt secret verbatim, otherwise a fresh 43-char one, unauthenticated with redirect:error', async () => {
    const bodies: any[] = [];
    const fetcher = asFetch((url, init) => {
      expect(url).toBe(`${ACCOUNT}/api/connect/hosts/redeem`);
      expect(init.redirect).toBe('error');
      expect(new Headers(init.headers).get('authorization')).toBeNull();
      bodies.push(JSON.parse(String(init.body)));
      return reply(grant());
    });
    const secret = 's'.repeat(43);
    await redeemConnectPeerLinkCode(ACCOUNT, CODE, fetcher, { attemptSecret: secret });
    expect(bodies[0]).toEqual({ code: CODE, attemptSecret: secret });
    const result = await redeemConnectPeerLinkCode(ACCOUNT, CODE, fetcher);
    expect(bodies[1].attemptSecret).toMatch(/^[\w-]{43}$/);
    expect(bodies[1].attemptSecret).not.toBe(secret);
    expect(result).toMatchObject({ serverUrl: 'https://abc.connect.example.com', credential: 'c'.repeat(43) });
    // accepts the account origin itself as the server origin too
    await expect(redeemConnectPeerLinkCode(ACCOUNT, CODE, asFetch(() => reply({ ...grant(), serverUrl: ACCOUNT })))).resolves.toBeTruthy();
  });

  it('validates the response shape and never leaks secrets in errors', async () => {
    const mutate: Array<Record<string, unknown>> = [
      { accountUrl: 'https://other.example.com' }, { serverUrl: 'http://abc.connect.example.com' }, { serverUrl: 'https://evil.com' },
      { serverUrl: 'https://notconnect.example.com' }, { serverUrl: 'https://abc.connect.example.com:8443' }, { serverUrl: 'https://abc.connect.example.com/x' },
      { serverUrl: 5 }, { hostId: 'nope' }, { hostId: 5 }, { serverId: 'nope' }, { serverId: undefined }, { instanceId: 'nope' }, { instanceId: undefined },
      { credential: 'short' }, { credential: undefined }, { enrollToken: 'zcde_short' }, { enrollToken: undefined }, { expiresAt: 1.5 }, { expiresAt: 'x' }
    ];
    for (const over of mutate) {
      const base = grant();
      const error = await redeemConnectPeerLinkCode(ACCOUNT, CODE, asFetch(() => reply({ ...base, ...over }))).catch(e => e);
      expect(error, JSON.stringify(over)).toMatchObject({ reason: 'invalid_response' });
      for (const secret of [CODE, base.credential, base.enrollToken]) expect(error.message).not.toContain(secret);
    }
    const sub = grant();
    await expect(redeemConnectPeerLinkCode('https://connect.example.com:8443', CODE, asFetch(() => reply({ ...sub, accountUrl: 'https://connect.example.com:8443', serverUrl: 'https://abc.connect.example.com:8443' })))).resolves.toBeTruthy();
  });

  it('maps redirects, oversize bodies, non-JSON and Connect errors without echoing secrets', async () => {
    const redirect = await redeemConnectPeerLinkCode(ACCOUNT, CODE, asFetch(() => { throw new TypeError(`redirect mode is set to error: ${CODE}`); })).catch(e => e);
    expect(redirect).toMatchObject({ reason: 'connect_unreachable' });
    expect(redirect.message).not.toContain(CODE);
    const huge = await redeemConnectPeerLinkCode(ACCOUNT, CODE, asFetch(() => reply({ pad: 'x'.repeat(300_000) }))).catch(e => e);
    expect(huge).toMatchObject({ reason: 'connect_unreachable' });
    expect(await redeemConnectPeerLinkCode(ACCOUNT, CODE, asFetch(() => new Response('<html>', { headers: { 'content-type': 'text/html' } }))).catch(e => e)).toMatchObject({ reason: 'connect_unreachable' });
    expect(await redeemConnectPeerLinkCode(ACCOUNT, CODE, asFetch(() => reply({ error: 'expired_or_used' }, 409))).catch(e => e)).toMatchObject({ reason: 'expired_or_used', status: 409 });
    expect(await redeemConnectPeerLinkCode(ACCOUNT, CODE, asFetch(() => reply({ error: 'too_many_attempts' }, 429))).catch(e => e)).toMatchObject({ reason: 'too_many_attempts' });
  });

  it('rejects an already-expired redeem result', async () => {
    const expired = await redeemConnectPeerLinkCode(ACCOUNT, CODE, asFetch(() => reply({ ...grant(), expiresAt: Date.now() - 1 }))).catch(e => e);
    expect(expired).toMatchObject({ reason: 'invalid_response' });
  });

  it('treats inherited Object.prototype keys as unknown Connect error codes', async () => {
    for (const code of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      const error = await redeemConnectPeerLinkCode(ACCOUNT, CODE, asFetch(() => reply({ error: code }, 400))).catch(e => e);
      expect(error).toMatchObject({ reason: 'connect_failed', status: 400, message: 'Zana Connect peer link request failed.' });
    }
    expect(new PeerLinkConnectError('toString').message).toBe('Zana Connect peer link request failed.');
    expect(new PeerLinkConnectError('constructor').message).toBe('Zana Connect peer link request failed.');
  });
});

describe('sameAccountInstance / listConnectPeerLinkNames / revokeConnectPeerLink', () => {
  it('is true only for a matching non-revoked server row', async () => {
    const f = await peerFixture();
    const instanceId = randomUUID(), serverId = randomUUID(), other = randomUUID();
    const servers = [
      null, 'junk', { id: serverId, instanceId: other, revoked: false }, { id: other, instanceId, revoked: false },
      { id: serverId, instanceId, revoked: false }
    ];
    let calls = 0;
    const fetcher = asFetch((url, init) => {
      calls++;
      expect(url).toBe(`${ACCOUNT}/api/connect/servers`);
      expect(init.method).toBe('GET');
      expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${f.relayToken}`);
      return reply({ servers });
    });
    expect(await sameAccountInstance(f.ctx, instanceId, serverId, fetcher)).toBe(true);
    servers.pop(); servers.push({ id: serverId, instanceId, revoked: true });
    expect(await sameAccountInstance(f.ctx, instanceId, serverId, fetcher)).toBe(false);
    servers.length = 0;
    expect(await sameAccountInstance(f.ctx, instanceId, serverId, fetcher)).toBe(false);
    servers.push({ id: serverId, instanceId: other, revoked: false });
    expect(await sameAccountInstance(f.ctx, instanceId, serverId, fetcher)).toBe(false);
    const before = calls;
    expect(await sameAccountInstance(f.ctx, f.ctx.productInstanceId, serverId, fetcher)).toBe(false);
    expect(await sameAccountInstance(f.ctx, instanceId, f.serverId, fetcher)).toBe(false);
    expect(await sameAccountInstance(f.ctx, 'nope', serverId, fetcher)).toBe(false);
    expect(await sameAccountInstance(f.ctx, instanceId, 'nope', fetcher)).toBe(false);
    expect(await sameAccountInstance(f.ctx, 5 as unknown as string, serverId, fetcher)).toBe(false);
    expect(await sameAccountInstance(f.ctx, instanceId, 5 as unknown as string, fetcher)).toBe(false);
    expect(calls).toBe(before);
  });

  it('fails closed on auth errors, malformed or oversize lists, and non-connect mode', async () => {
    const f = await peerFixture();
    const a = randomUUID(), b = randomUUID();
    await expect(sameAccountInstance(f.ctx, a, b, asFetch(() => new Response('', { status: 401 })))).rejects.toBeInstanceOf(PeerLinkConnectError);
    await expect(sameAccountInstance(f.ctx, a, b, asFetch(() => new Response('', { status: 401 })))).rejects.toMatchObject({ reason: 'unauthorized' });
    await expect(sameAccountInstance(f.ctx, a, b, asFetch(() => reply({ servers: 'x' })))).rejects.toMatchObject({ reason: 'invalid_response' });
    await expect(sameAccountInstance(f.ctx, a, b, asFetch(() => reply({})))).rejects.toMatchObject({ reason: 'invalid_response' });
    await expect(sameAccountInstance(f.ctx, a, b, asFetch(() => reply({ servers: Array.from({ length: 501 }, () => ({})) })))).rejects.toMatchObject({ reason: 'invalid_response' });
    const off = await peerFixture({ connect: false });
    await expect(sameAccountInstance(off.ctx, a, b, asFetch(() => reply({ servers: [] })))).rejects.toMatchObject({ reason: 'connect_required' });
  });

  it('lists only active, bounded-length machine names', async () => {
    const f = await peerFixture();
    const fetcher = asFetch((url, init) => {
      expect(url).toBe(`${ACCOUNT}/api/connect/hosts`);
      expect(init.method).toBe('GET');
      return reply({ machines: [
        { name: 'A', revoked: false }, { name: 'B', revoked: true }, { name: 'x'.repeat(81), revoked: false }, { name: 5, revoked: false },
        null, 'str', { name: 'C' }
      ] });
    });
    expect([...await listConnectPeerLinkNames(f.ctx, fetcher)]).toEqual(['A']);
    await expect(listConnectPeerLinkNames(f.ctx, asFetch(() => reply({ machines: {} })))).rejects.toMatchObject({ reason: 'invalid_response' });
    await expect(listConnectPeerLinkNames(f.ctx, asFetch(() => reply({ machines: Array.from({ length: 501 }, () => ({})) })))).rejects.toMatchObject({ reason: 'invalid_response' });
    const off = await peerFixture({ connect: false });
    await expect(listConnectPeerLinkNames(off.ctx, fetcher)).rejects.toMatchObject({ reason: 'connect_required' });
  });

  it('revokes via Connect and reports whether a machine was active', async () => {
    const f = await peerFixture();
    const hostId = randomUUID();
    let revoked = true;
    const fetcher = asFetch((url, init) => {
      expect(url).toBe(`${ACCOUNT}/api/connect/hosts/revoke`);
      expect(JSON.parse(String(init.body))).toEqual({ hostId });
      return reply({ revoked });
    });
    expect(await revokeConnectPeerLink(f.ctx, hostId, fetcher)).toBe(true);
    revoked = false;
    expect(await revokeConnectPeerLink(f.ctx, hostId, fetcher)).toBe(false);
    await expect(revokeConnectPeerLink(f.ctx, 'nope', fetcher)).rejects.toMatchObject({ reason: 'invalid_host' });
    await expect(revokeConnectPeerLink(f.ctx, 5 as unknown as string, fetcher)).rejects.toMatchObject({ reason: 'invalid_host' });
    await expect(revokeConnectPeerLink(f.ctx, hostId, asFetch(() => new Response('', { status: 503 })))).rejects.toMatchObject({ reason: 'connect_failed', status: 503 });
    const off = await peerFixture({ connect: false });
    expect(await revokeConnectPeerLink(off.ctx, hostId, fetcher)).toBe(false);
  });
});

describe('peer links against the base in-process Connect', () => {
  const ACCOUNT_URL = 'https://example.com';
  async function world() {
    const connectDb = await openConnectDatabase(':memory:', { production: false }); await connectDb.migrate();
    cleanups.push(() => connectDb.close());
    let offset = 0;
    const now = () => Date.now() + offset;
    const registry = createRegistry(connectDb, { domain: 'connect.example.com', accountUrl: ACCOUNT_URL, now });
    const api = createConnectApi({ registry, db: connectDb, sessionSecret: 'fixture', now });
    const fetcher = ((url: string, init?: RequestInit) => api.dispatch(new Request(url, init))) as unknown as typeof fetch;
    const enroll = async (user: string, name: string) => registry.redeemComputerCode((await registry.createComputerCode(user)).code, name);
    const alice = await enroll('alice', 'Alice server');
    const f = await peerFixture({ connect: false });
    await new MobileConnectionStore(join(f.dir, 'mobile', 'connection.json')).write({ mode: 'connect', accountUrl: ACCOUNT_URL, serverId: alice.serverId, publicUrl: alice.serverUrl, relayToken: alice.credential });
    return { ...f, registry, fetcher, enroll, alice, advance: (ms: number) => { offset += ms; } };
  }

  it('issues, redeems idempotently, rotates, and revokes through real Connect', async () => {
    const w = await world();
    const issued = await issueConnectPeerLinkCode(w.ctx, { name: NAME }, w.fetcher);
    expect(issued).toMatchObject({ serverId: w.alice.serverId, accountUrl: ACCOUNT_URL });
    expect(issued.code).toMatch(/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);

    const secret = connectAttemptSecret();
    const redeemed = await redeemConnectPeerLinkCode(ACCOUNT_URL, issued.code, w.fetcher, { attemptSecret: secret });
    expect(redeemed).toMatchObject({ hostId: issued.hostId, serverId: w.alice.serverId, instanceId: w.ctx.productInstanceId });
    const redo = await redeemConnectPeerLinkCode(ACCOUNT_URL, issued.code, w.fetcher, { attemptSecret: secret });
    expect(redo.credential).toBe(redeemed.credential);
    expect(redo.enrollToken).toBe(redeemed.enrollToken);
    await expect(redeemConnectPeerLinkCode(ACCOUNT_URL, issued.code, w.fetcher, { attemptSecret: connectAttemptSecret() })).rejects.toMatchObject({ reason: 'expired_or_used' });

    // The enroll token is the local join code: redeeming it locally yields the peer.forward capability.
    expect(w.ctx.joinCodes.redeem(redeemed.enrollToken)).toMatchObject({ hostId: issued.hostId, enrollmentCapability: 'peer.forward' });
    expect(await listConnectPeerLinkNames(w.ctx, w.fetcher)).toEqual(new Set([NAME]));

    // Rotation: the host now exists locally as peer.forward; a new code yields a new credential.
    upsertHost(w.db, { name: 'Primary', hostKeyHash: 'a'.repeat(64), isPrimary: true });
    upsertHost(w.db, { id: issued.hostId, name: 'Peer', hostKeyHash: 'b'.repeat(64), isPrimary: false, enrollmentCapability: 'peer.forward' });
    const rotatedName = 'Zana peer link: Alice renamed (sync only)';
    const rotated = await rotateConnectPeerLinkCode(w.ctx, issued.hostId, rotatedName, w.fetcher);
    expect(rotated.hostId).toBe(issued.hostId);
    const second = await redeemConnectPeerLinkCode(ACCOUNT_URL, rotated.code, w.fetcher);
    expect(second.hostId).toBe(issued.hostId);
    expect(second.credential).not.toBe(redeemed.credential);
    expect(await listConnectPeerLinkNames(w.ctx, w.fetcher)).toEqual(new Set([rotatedName]));

    // Revocation.
    expect(await revokeConnectPeerLink(w.ctx, issued.hostId, w.fetcher)).toBe(true);
    expect(await revokeConnectPeerLink(w.ctx, issued.hostId, w.fetcher)).toBe(false);
    expect((await listConnectPeerLinkNames(w.ctx, w.fetcher)).size).toBe(0);
    await expect(redeemConnectPeerLinkCode(ACCOUNT_URL, rotated.code, w.fetcher)).rejects.toMatchObject({ reason: 'expired_or_used' });
  });

  it('treats an expired code as expired_or_used', async () => {
    const w = await world();
    const issued = await issueConnectPeerLinkCode(w.ctx, { name: NAME }, w.fetcher);
    w.advance(11 * 60_000);
    await expect(redeemConnectPeerLinkCode(ACCOUNT_URL, issued.code, w.fetcher)).rejects.toMatchObject({ reason: 'expired_or_used' });
  });

  it('answers sameAccountInstance per Connect account', async () => {
    const w = await world();
    const peer = await w.enroll('alice', 'Alice second'), stranger = await w.enroll('bob', 'Bob server');
    const peerInstance = randomUUID(), strangerInstance = randomUUID();
    await w.registry.bindInstance(await w.registry.authenticateServer(peer.credential), peerInstance);
    await w.registry.bindInstance(await w.registry.authenticateServer(stranger.credential), strangerInstance);
    expect(await sameAccountInstance(w.ctx, peerInstance, peer.serverId, w.fetcher)).toBe(true);
    expect(await sameAccountInstance(w.ctx, strangerInstance, stranger.serverId, w.fetcher)).toBe(false);
    expect(await sameAccountInstance(w.ctx, peerInstance, stranger.serverId, w.fetcher)).toBe(false);
    expect(await sameAccountInstance(w.ctx, randomUUID(), peer.serverId, w.fetcher)).toBe(false);
    await w.registry.revoke('alice', 'server', peer.serverId);
    expect(await sameAccountInstance(w.ctx, peerInstance, peer.serverId, w.fetcher)).toBe(false);
  });
});
