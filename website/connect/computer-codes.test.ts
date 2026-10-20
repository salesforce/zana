import { afterEach, beforeEach, expect, it } from 'vitest';
import { openConnectDatabase } from './database.mjs';
import { createRegistry, CODE_TTL, digest } from './registry.mjs';

let db: any, registry: any, clock: number;
beforeEach(async () => {
  clock = 1_800_000_000_000;
  db = await openConnectDatabase(':memory:', { production: false }); await db.migrate();
  registry = createRegistry(db, { domain: 'connect.example.com', accountUrl: 'https://example.com', now: () => clock });
});
afterEach(() => db.close());

it('stores only digests and binds the new computer to the issuing account', async () => {
  const issued = await registry.createComputerCode('alice');
  expect(issued).toEqual({ code: expect.stringMatching(/^(?:[A-F0-9]{4}-){3}[A-F0-9]{4}$/), expiresAt: clock + CODE_TTL });
  const rows = await db.query('SELECT * FROM connect_codes');
  expect(rows[0].hash).toBe(digest(issued.code.replaceAll('-', '')));
  expect(JSON.stringify(rows)).not.toContain(issued.code);
  const result = await registry.redeemComputerCode(` ${issued.code.toLowerCase()} `, ' My Mac ');
  expect(result).toMatchObject({ accountUrl: 'https://example.com', name: 'My Mac' });
  expect(result.serverUrl).toMatch(/^https:\/\/s-[a-f0-9]{24}\.connect\.example\.com$/);
  expect(await registry.authenticateServer(result.credential)).toMatchObject({ user_id: 'alice', id: result.serverId });
  expect(await registry.listServers('bob')).toEqual([]);
  const [server] = await db.query('SELECT credential_hash FROM connect_servers');
  expect(server.credential_hash).toBe(digest(result.credential));
});
it('consumes a code once, including concurrent redemption attempts', async () => {
  const { code } = await registry.createComputerCode('alice');
  const attempts = await Promise.allSettled([registry.redeemComputerCode(code, 'One'), registry.redeemComputerCode(code, 'Two')]);
  expect(attempts.filter(x => x.status === 'fulfilled')).toHaveLength(1);
  expect(await registry.listServers('alice')).toHaveLength(1);
  await expect(registry.redeemComputerCode(code, 'Again')).rejects.toMatchObject({ status: 409 });
});
it('expires codes and invalidates the previous code only for the same account', async () => {
  const old = await registry.createComputerCode('alice');
  const bob = await registry.createComputerCode('bob');
  const next = await registry.createComputerCode('alice');
  await expect(registry.redeemComputerCode(old.code, 'Old')).rejects.toMatchObject({ status: 409 });
  expect(await registry.redeemComputerCode(bob.code, 'Bob')).toHaveProperty('credential');
  clock += CODE_TTL;
  await expect(registry.redeemComputerCode(next.code, 'Late')).rejects.toMatchObject({ status: 409 });
});
it('validates names and codes before creating or consuming anything', async () => {
  for (const code of [null, 123, '', 'a'.repeat(81), 'z'.repeat(16), '0123-4567']) {
    await expect(registry.redeemComputerCode(code, 'Mac')).rejects.toMatchObject({ status: 400 });
  }
  const { code } = await registry.createComputerCode('alice');
  for (const name of [null, '', '  ', 'a'.repeat(81), 'bad\nname']) {
    await expect(registry.redeemComputerCode(code, name)).rejects.toMatchObject({ status: 400 });
  }
  expect(await registry.redeemComputerCode(code, 'Mac')).toHaveProperty('credential');
});
it('rolls back code consumption when the account is full', async () => {
  const limited = createRegistry(db, { domain: 'connect.example.com', accountUrl: 'https://example.com', now: () => clock, limit: 1 });
  const first = await limited.redeemComputerCode((await limited.createComputerCode('alice')).code, 'First');
  const { code } = await limited.createComputerCode('alice');
  await expect(limited.redeemComputerCode(code, 'Second')).rejects.toMatchObject({ status: 409 });
  await limited.revoke('alice', 'server', first.serverId);
  expect(await limited.redeemComputerCode(code, 'Second')).toHaveProperty('credential');
});

it('reserves a permanent browser address before pairing and redeems into that exact server', async () => {
  const issued = await registry.reserveComputer('alice', 'alice-laptop');
  expect(issued.browserUrl).toBe('https://alice-laptop.connect.example.com');
  expect(await registry.listServers('alice')).toEqual([expect.objectContaining({ id: issued.serverId, paired: false, live: false, browserUrl: issued.browserUrl })]);
  expect(await registry.resolveServer('alice-laptop')).toMatchObject({ id: issued.serverId, credential_hash: null });
  const enrolled = await registry.redeemComputerCode(issued.code, 'Alice’s Mac');
  expect(enrolled.serverId).toBe(issued.serverId);
  expect(await registry.listServers('alice')).toEqual([expect.objectContaining({ id: issued.serverId, paired: true, name: 'Alice’s Mac', browserUrl: issued.browserUrl })]);
  await expect(registry.createComputerCode('alice', issued.serverId)).rejects.toMatchObject({ message: 'already_connected' });
});
it('resumes reserved setup with a fresh code without changing its address or another code', async () => {
  const one = await registry.reserveComputer('alice', 'alice-one');
  const two = await registry.reserveComputer('alice', 'alice-two');
  const fresh = await registry.createComputerCode('alice', one.serverId);
  await expect(registry.redeemComputerCode(one.code, 'Old')).rejects.toMatchObject({ status: 409 });
  expect((await registry.redeemComputerCode(fresh.code, 'One')).serverId).toBe(one.serverId);
  expect((await registry.redeemComputerCode(two.code, 'Two')).serverId).toBe(two.serverId);
});
it('enforces ownership, reservation uniqueness and revocation before issuing credentials', async () => {
  const issued = await registry.reserveComputer('alice', 'taken-name');
  for (const id of [issued.serverId, 'missing', 123, 'x'.repeat(65)]) {
    await expect(registry.createComputerCode('bob', id)).rejects.toMatchObject({ status: 404 });
  }
  await expect(registry.reserveComputer('bob', 'taken-name')).rejects.toMatchObject({ message: 'address_taken' });
  expect(await registry.listServers('bob')).toEqual([]);
  await registry.revoke('alice', 'server', issued.serverId);
  await expect(registry.createComputerCode('alice', issued.serverId)).rejects.toMatchObject({ status: 404 });
  await expect(registry.redeemComputerCode(issued.code, 'Revoked')).rejects.toMatchObject({ status: 409 });
  await expect(registry.reserveComputer('bob', 'taken-name')).rejects.toMatchObject({ message: 'address_taken' });
});
it('validates reservation labels and limits before issuing codes; reserved slots remain redeemable at capacity', async () => {
  for (const label of [null, 'a', 'www', 's-private', 'bad--name', 'Capital']) {
    await expect(registry.reserveComputer('alice', label)).rejects.toMatchObject({ status: 400 });
  }
  const limited = createRegistry(db, { domain: 'connect.example.com', accountUrl: 'https://example.com', now: () => clock, limit: 1 });
  const issued = await limited.reserveComputer('alice', 'only-one');
  await expect(limited.reserveComputer('alice', 'second-one')).rejects.toMatchObject({ message: 'account_limit' });
  expect((await limited.redeemComputerCode(issued.code, 'First')).serverId).toBe(issued.serverId);
  await limited.revoke('alice', 'server', issued.serverId);
  await expect(limited.reserveComputer('alice', 'second-one')).rejects.toMatchObject({ message: 'account_limit' });
});
it('atomically awards a contested label to one account without orphaned servers', async () => {
  const attempts = await Promise.allSettled(['alice', 'bob'].map(owner => registry.reserveComputer(owner, 'contested')));
  expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(await db.query('SELECT id FROM connect_servers')).toHaveLength(1);
  expect(await db.query('SELECT hash FROM connect_codes')).toHaveLength(1);
});
it('reserves a new computer under the owner’s revoked address without another reservation slot', async () => {
  const limited = createRegistry(db, { domain: 'connect.example.com', accountUrl: 'https://example.com', now: () => clock, limit: 1 });
  const first = await limited.reserveComputer('alice', 'alice-mac');
  await expect(limited.reserveComputer('alice', 'alice-mac')).rejects.toMatchObject({ status: 409 });
  await limited.revoke('alice', 'server', first.serverId);
  await expect(limited.reserveComputer('bob', 'alice-mac')).rejects.toThrow('address_taken');
  await expect(limited.reserveComputer('alice', 'alice-air')).rejects.toThrow('account_limit');
  const again = await limited.reserveComputer('alice', 'alice-mac');
  expect(again).toMatchObject({ browserUrl: first.browserUrl, serverId: expect.not.stringMatching(first.serverId) });
  expect(await db.query('SELECT server_id FROM connect_addresses WHERE label=$1', ['alice-mac'])).toEqual([{ server_id: again.serverId }]);
});
