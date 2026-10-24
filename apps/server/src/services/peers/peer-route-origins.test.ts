import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { PrivatePeerStorage } from './peer-auth.js';
import { PEER_ROUTE_ORIGINS_MAX, PeerRouteOrigins, normalizePeerRouteOrigin } from './peer-route-origins.js';

const roots: string[] = [], stores: PeerRouteOrigins[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) { store.dispose(); await store.whenIdle(); }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const keyProvider = { getKey: async () => Buffer.alloc(32, 7) };
async function store(directory?: string) {
  const dir = directory ?? join(await realpath(await mkdtemp(join(tmpdir(), 'route-origins-'))), 'origins');
  if (!directory) roots.push(join(dir, '..'));
  const origins = new PeerRouteOrigins({ directory: dir, instanceId: '11111111-1111-4111-8111-111111111111', keyProvider });
  stores.push(origins);
  return { origins, dir };
}

it('normalizes https and loopback http origins', () => {
  expect(normalizePeerRouteOrigin('https://Peer.Example')).toBe('https://peer.example');
  expect(normalizePeerRouteOrigin('https://peer.example/')).toBe('https://peer.example');
  expect(normalizePeerRouteOrigin('https://peer.example:8443')).toBe('https://peer.example:8443');
  expect(normalizePeerRouteOrigin('http://127.0.0.1:4100')).toBe('http://127.0.0.1:4100');
  expect(normalizePeerRouteOrigin('http://localhost:4100/')).toBe('http://localhost:4100');
  expect(normalizePeerRouteOrigin('http://[::1]:4100')).toBe('http://[::1]:4100');
});

it.each([
  ['non-string', 42], ['empty', ''], ['too long', `https://${'a'.repeat(260)}.example`], ['whitespace', ' https://peer.example'],
  ['wildcard', 'https://*.example'], ['unparseable', 'not a url'], ['credentials', 'https://user:pw@peer.example'],
  ['user only', 'https://user@peer.example'], ['path', 'https://peer.example/api'], ['query', 'https://peer.example/?x=1'],
  ['hash', 'https://peer.example/#x'], ['plain http', 'http://peer.example'], ['private http', 'http://10.0.0.1:4100'],
  ['ftp', 'ftp://peer.example'], ['explicit default port', 'https://peer.example:443'], ['double slash', 'https://peer.example//'],
  ['file', 'file:///etc/passwd'], ['opaque', 'mailto:a@b.example']
])('rejects %s origins', (_label, input) => {
  expect(() => normalizePeerRouteOrigin(input)).toThrow('invalid peer route origin');
});

it('persists sealed origins idempotently, removes them and enforces the cap', async () => {
  const { origins, dir } = await store();
  expect(await origins.list()).toEqual([]);
  expect(await origins.add('https://Peer.Example/')).toBe('https://peer.example');
  expect(await origins.add('https://peer.example')).toBe('https://peer.example');
  expect(await origins.list()).toEqual(['https://peer.example']);
  await expect(origins.add('http://peer.example')).rejects.toThrow('invalid peer route origin');
  await expect(origins.remove('https://peer.example/path')).rejects.toThrow('invalid peer route origin');
  await origins.whenIdle();
  for (const file of await readdir(dir)) expect((await readFile(join(dir, file))).includes(Buffer.from('peer.example'))).toBe(false);
  // Survives a restart.
  origins.dispose(); await origins.whenIdle();
  const reopened = (await store(dir)).origins;
  expect(await reopened.list()).toEqual(['https://peer.example']);
  expect(await reopened.remove('https://peer.example')).toBe(true);
  expect(await reopened.remove('https://peer.example')).toBe(false);
  for (let index = 0; index < PEER_ROUTE_ORIGINS_MAX; index++) await reopened.add(`https://p${index}.example`);
  await expect(reopened.add('https://overflow.example')).rejects.toThrow('peer route origin capacity exceeded');
  expect(await reopened.add('https://p0.example')).toBe('https://p0.example');
  expect(await reopened.list()).toHaveLength(PEER_ROUTE_ORIGINS_MAX);
});

it('rejects calls after dispose and tampered storage', async () => {
  const { origins, dir } = await store();
  await origins.add('https://peer.example'); await origins.whenIdle();
  origins.dispose(); origins.dispose();
  await expect(origins.list()).rejects.toThrow('disposed');
  await expect(origins.add('https://peer.example')).rejects.toThrow('disposed');
  await expect(origins.remove('https://peer.example')).rejects.toThrow('disposed');
  for (const file of await readdir(dir)) await writeFile(join(dir, file), '{"tampered":true}');
  const reopened = (await store(dir)).origins;
  await expect(reopened.list()).rejects.toThrow();
});

it.each([['non-canonical', ['https://Peer.Example']], ['duplicate', ['https://peer.example', 'https://peer.example']], ['unsafe', ['http://peer.example']]])(
  'refuses a %s stored allowlist', async (_label, stored) => {
    const { dir } = await store();
    const raw = new PrivatePeerStorage<{ version: 1; origins: string[] }>(dir, 'route-origins-v1', keyProvider, '11111111-1111-4111-8111-111111111111',
      () => ({ version: 1, origins: [] }), value => value as { version: 1; origins: string[] });
    await raw.transaction(async (state, save) => { state.origins = stored; await save(); });
    raw.dispose(); await raw.whenIdle();
    await expect((await store(dir)).origins.list()).rejects.toThrow();
  });
