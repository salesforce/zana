import { describe, expect, it, vi } from 'vitest';
import { BotConnections } from './broker';
import { SalesforceConnection, domain } from './salesforce';
import { BotVault } from '../vault/storage';

const origin = 'https://acme--qa.sandbox.my.salesforce.com';
const settings = { origin, clientId: 'unit-client', clientSecret: 'test-only-consumer-secret', mode: 'service' };
const identity = 'https://test.salesforce.com/id/00D000000000001/005000000000001';
const token = {
  instance_url: origin,
  id: identity,
  access_token: 'test-only-access',
  refresh_token: 'test-only-refresh'
};
const device = {
  verification_uri: origin + '/setup/connect',
  device_code: 'test-only-device',
  user_code: 'TEST1234',
  interval: 5
};
const record = { Id: '500123', CaseNumber: '001', Subject: 'Sample case', Status: 'Open' };
function fixture() {
  let time = 100;
  const map = new Map<string, unknown>();
  const kv = {
    get: async <T>(k: string) => map.get(k) as T | undefined,
    set: async (k: string, v: unknown) => {
      map.set(k, v);
    }
  };
  const http = vi.fn<typeof fetch>();
  const provider = new SalesforceConnection(http);
  const broker = new BotConnections(kv, provider, () => time);
  const vault = new BotVault(
    kv,
    () => time,
    () => {},
    broker
  );
  const reply = (data: unknown, status = 200) => http.mockResolvedValueOnce(Response.json(data, { status }));
  return {
    map,
    http,
    provider,
    broker,
    vault,
    reply,
    tick: (ms: number) => {
      time += ms;
    }
  };
}
const role = () => true;
const owner = () => {};
describe('bot connections', () => {
  it('authorizes an unattended read after the owner session expires, pauses on explicit lock/restart, and disconnects', async () => {
    const { vault, broker, http, reply, tick, map } = fixture();
    const { token: first } = await vault.unlock('unit test passphrase', true);
    reply(token);
    expect(await broker.connect('one', settings, () => vault.requireOwner(first))).toEqual({ state: 'connected' });
    expect(await broker.status('one', owner)).toEqual({ mode: 'service', origin });
    expect(await broker.status('other', owner)).toBeNull();
    expect(JSON.stringify([...map])).not.toContain(settings.clientSecret);
    tick(31 * 60_000);
    expect(() => vault.requireOwner(first)).toThrow('Unlock');
    reply({ ...token, instance_url: 'https://na123.salesforce.com/' });
    reply({ records: [{ ...record, secret: 'test-only-hidden' }] });
    const data = await broker.assignedCases('one', role);
    expect(data).toEqual({ cases: [{ id: '500123', number: '001', subject: 'Sample case', status: 'Open' }] });
    expect(JSON.stringify(data)).not.toMatch(/test-only/);
    expect(http.mock.calls[1][1]?.body?.toString()).toContain('grant_type=client_credentials');
    expect(String(http.mock.calls[2][0])).toMatch(/^https:\/\/acme--qa\.sandbox\.my\.salesforce\.com\/.*OwnerId/);
    expect(http.mock.calls[2][1]).toMatchObject({
      redirect: 'error',
      headers: { Authorization: 'Bearer ' + token.access_token }
    });
    await expect(broker.assignedCases('one', () => false)).rejects.toThrow('main thread');
    await expect(broker.assignedCases('other', role)).rejects.toThrow('Connect');
    const second = await vault.unlock('unit test passphrase', false);
    await vault.lock(second.token);
    await expect(broker.assignedCases('one', role)).rejects.toThrow('resume');
    await vault.unlock('unit test passphrase', false);
    expect(await broker.status('one', owner)).toEqual({ origin, mode: 'service' });
    await broker.disconnect('one', owner);
    expect(await broker.status('one', owner)).toBeNull();
    vault.dispose();
    await expect(broker.assignedCases('one', role)).rejects.toThrow('resume');
  });

  it('binds one-time device authorization, respects polling and commits a rotated token before returning data', async () => {
    const { vault, broker, http, reply, tick, map } = fixture();
    await vault.unlock('unit test passphrase', true);
    reply(device);
    const pending = await broker.connect('one', { ...settings, clientSecret: '', mode: 'delegated' }, owner);
    if (pending.state !== 'waiting') throw Error('Expected sign-in');
    expect(JSON.stringify(pending)).not.toContain(device.device_code);
    await expect(broker.finish('other', pending.ticket, owner)).rejects.toThrow('expired');
    await expect(broker.finish('one', 'wrong', owner)).rejects.toThrow('expired');
    expect(await broker.finish('one', pending.ticket, owner)).toMatchObject({ state: 'waiting', interval: 5 });
    expect(http).toHaveBeenCalledTimes(1);
    tick(5000);
    reply({ error: 'authorization_pending' }, 400);
    expect(await broker.finish('one', pending.ticket, owner)).toMatchObject({ interval: 5 });
    tick(5000);
    reply({ error: 'slow_down' }, 400);
    expect(await broker.finish('one', pending.ticket, owner)).toMatchObject({ interval: 10 });
    tick(10000);
    reply(token);
    expect(await broker.finish('one', pending.ticket, owner)).toEqual({ state: 'connected' });
    await expect(broker.finish('one', pending.ticket, owner)).rejects.toThrow('expired');
    await expect(broker.connect('one', settings, owner)).rejects.toThrow('Disconnect');
    reply({ ...token, refresh_token: 'rotated' });
    reply({ records: [] });
    await broker.assignedCases('one', role);
    reply({ ...token, refresh_token: undefined });
    reply({ records: [] });
    await broker.assignedCases('one', role);
    expect(http.mock.calls.at(-2)?.[1]?.body?.toString()).toContain('refresh_token=rotated');
    expect(JSON.stringify([...map])).not.toMatch(/test-only|rotated/);
    vault.dispose();
  });

  it('rejects untrusted destinations, changed identities, malformed replies and upstream diagnostics', async () => {
    const { broker, reply, vault, http } = fixture();
    await vault.unlock('unit test passphrase', true);
    for (const value of [
      null,
      'ftp://acme.my.salesforce.com',
      'https://acme.my.salesforce.com.other.test',
      origin + '/foo',
      origin + ':9000',
      'https://u:p@acme.my.salesforce.com'
    ])
      expect(() => domain(value)).toThrow();
    await expect(broker.connect('one', { ...settings, mode: 'bogus' }, owner)).rejects.toThrow('identity');
    await expect(broker.connect('one', { ...settings, clientSecret: '' }, owner)).rejects.toThrow('missing');
    reply({ ...device, verification_uri: 'https://other.test' });
    await expect(broker.connect('one', { ...settings, mode: 'delegated' }, owner)).rejects.toThrow(
      'verification page'
    );
    reply({ ...token, instance_url: 'https://other.my.salesforce.com' });
    await expect(broker.connect('one', settings, owner)).rejects.toThrow('different org');
    reply(token);
    await broker.connect('one', settings, owner);
    reply({ ...token, id: identity.slice(0, -1) + '2' });
    await expect(broker.assignedCases('one', role)).rejects.toThrow('verify');
    reply({ error_description: 'private-provider-diagnostic' }, 400);
    await expect(broker.assignedCases('one', role)).rejects.toThrow('declined');
    reply({ error: 'private-provider-diagnostic' }, 503);
    await expect(broker.assignedCases('one', role)).rejects.toThrow('temporarily unavailable');
    reply(token);
    reply({ error: 'hidden' }, 403);
    await expect(broker.assignedCases('one', role)).rejects.toThrow('Case read access');
    http.mockResolvedValueOnce(new Response('x'.repeat(132000)));
    await expect(broker.assignedCases('one', role)).rejects.toThrow('could not be reached');
    vault.dispose();
  });
  it('cancels or expires authorization and suppresses results after losing the thread', async () => {
    const { broker, reply, vault, tick } = fixture();
    await vault.unlock('unit test passphrase', true);
    reply(device);
    const attempt = await broker.connect('one', { ...settings, mode: 'delegated' }, owner);
    if (attempt.state !== 'waiting') throw Error();
    tick(600_001);
    await expect(broker.finish('one', attempt.ticket, owner)).rejects.toThrow('expired');
    await broker.disconnect('one', owner);
    reply(token);
    await broker.connect('one', settings, owner);
    reply(token);
    reply({ records: [record] });
    const check = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);
    await expect(broker.assignedCases('one', check)).rejects.toThrow('main thread');
    vault.dispose();
  });
});
