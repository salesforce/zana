import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MobileConnectionStore, validateMobileConnection as validate } from './connection.js';

const dirs: string[] = [];
const token = 'x'.repeat(43);
const connect = { mode: 'connect', publicUrl: 'https://one.connect.example', accountUrl: 'https://account.example', serverId: 'computer-1', relayToken: token };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function path() { const dir = mkdtempSync(join(tmpdir(), 'mobile-settings-')); dirs.push(dir); return join(dir, 'connection.json'); }
describe('phone connection configuration', () => {
  it('defaults to unconfigured and rejects local network setup', () => {
    expect(new MobileConnectionStore().view()).toEqual({ mode: 'unconfigured', hasRelayToken: false });
    expect(() => validate({ mode: 'local', publicUrl: 'bad', relayToken: token })).toThrow('Local-network');
    expect(new MobileConnectionStore(path()).read()).toEqual({ mode: 'unconfigured' });
  });
  it('accepts Connect enrollments with HTTPS origins', () => {
    expect(validate({ ...connect, publicUrl: 'https://one.connect.example/' })).toEqual(connect);
  });
  it('rejects the retired Heroku relay and loads a saved relay connection as unconfigured', async () => {
    expect(() => validate({ mode: 'relay', publicUrl: 'https://example.herokuapp.com', relayToken: token })).toThrow('Sign in to Zana Connect');
    const file = path();
    const legacy = JSON.stringify({ mode: 'relay', publicUrl: 'https://example.herokuapp.com', relayToken: token });
    writeFileSync(file, legacy);
    const store = new MobileConnectionStore(file);
    expect(store.read()).toEqual({ mode: 'unconfigured' });
    expect(store.view()).toEqual({ mode: 'unconfigured', hasRelayToken: false });
    expect(JSON.stringify(store.view())).not.toContain(token);
  });
  it.each(['tailscale', 'local'])('rejects removed %s configurations without rewriting them or revealing the old address', async mode => {
    const file = path();
    const legacy = JSON.stringify({ mode, publicUrl: 'https://private-machine.example', relayToken: token });
    writeFileSync(file, legacy);
    const store = new MobileConnectionStore(file);
    expect(() => validate(JSON.parse(legacy))).toThrow('Open Remote access');
    expect(() => store.read()).toThrow('connections are no longer supported');
    expect(() => store.view()).toThrow('Open Remote access');
    expect(readFileSync(file, 'utf8')).toBe(legacy);
    await store.write(validate({ mode: 'unconfigured' }));
    expect(new MobileConnectionStore(file).view()).toEqual({ mode: 'unconfigured', hasRelayToken: false });
  });
  it.each([null, {}, { mode: 'unknown' }, { mode: 'relay' }, { mode: 'connect' }, { ...connect, publicUrl: `https://${'a'.repeat(2048)}` }, { ...connect, publicUrl: 'not a url' },
    { mode: 'tailscale', publicUrl: 'https://private-machine.example' },
    ...['http://example.test', 'https://user:pass@example.test', 'https://example.test/path', 'https://example.test?q=x', 'https://example.test#x'].map(publicUrl => ({ ...connect, publicUrl })),
    { ...connect, accountUrl: 'http://account.example' }, { ...connect, accountUrl: 'https://account.example/path' },
    { ...connect, serverId: 'bad id' }, { ...connect, relayToken: 'short' }])('rejects malformed or unsafe configuration %#', input => { expect(() => validate(input)).toThrow(); });
  it('persists privately and never returns the secret in its public view', async () => {
    const file = path(); const store = new MobileConnectionStore(file);
    await store.write(validate(connect));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8')).relayToken).toBe(token);
    expect(JSON.stringify(store.view())).not.toContain(token);
    expect(new MobileConnectionStore(file).view()).toEqual({ mode: 'connect', publicUrl: 'https://one.connect.example', hasRelayToken: true, accountUrl: 'https://account.example', serverId: 'computer-1' });
    await store.write({ mode: 'unconfigured' }); expect(new MobileConnectionStore(file).view().hasRelayToken).toBe(false);
  });
  it('reports malformed and oversized private files without echoing their contents', () => {
    const file = path(); writeFileSync(file, token); expect(() => new MobileConnectionStore(file).read()).toThrow('Could not read phone connection configuration');
    writeFileSync(file, ' '.repeat(4097)); expect(() => new MobileConnectionStore(file).read()).toThrow('Could not read phone connection configuration');
  });
});
