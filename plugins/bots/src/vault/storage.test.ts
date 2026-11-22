import { createHmac, scryptSync } from 'node:crypto';
import { open, seal, type Envelope } from './encryption.js';
import { describe, expect, it } from 'vitest';
import { botScopeKey, httpsOrigin, prepareItem } from './items.js';
import { BotVault } from './storage.js';

const a = { id: 'scout', name: 'Scout', createdAt: 1 };
const b = { id: 'coach', name: 'Coach', createdAt: 1 };
const pass = 'an isolated test passphrase';
const login = { kind: 'login', sites: ['https://accounts.example.com/login'], username: 'dev', password: ' fixture secret! ', scope: [botScopeKey(a)] };
function fixture() {
  const device = async () => Buffer.alloc(32, 7);
  const values = new Map<string, unknown>();
  const kv = { get: async <T,>(key: string) => structuredClone(values.get(key)) as T | undefined, set: async (key: string, data: unknown) => { values.set(key, structuredClone(data)); } };
  const vault = new BotVault(kv, device);
  return { vault, values, kv, device };
}

describe('encrypted bot Vault', () => {
  it('persists authenticated ciphertext, exposes only shared metadata, and preserves write-only fields across edits and restart', async () => {
    const { vault, kv, values, device } = fixture();
    expect(await vault.status()).toEqual({ migrationRequired: false });
    const entry = await vault.save(login, [a,b]);
    expect(entry.sites).toEqual(['https://accounts.example.com']);
    expect(await vault.shared(a)).toEqual([entry]);
    expect(await vault.shared(b)).toEqual([]);
    expect(await vault.shared({ ...a, createdAt: 5 })).toEqual([]);
    expect(JSON.stringify(await vault.list())).not.toContain(login.password);
    const persisted = JSON.stringify([...values.values()]);
    for (const text of [pass, login.password, entry.sites[0]]) expect(persisted).not.toContain(text);
    vault.dispose();
    const reopened = new BotVault(kv, device);
    expect(await reopened.shared(a)).toEqual([entry]);
    const edited = await reopened.save({ ...entry, username:'new', scope:'all' }, [a,b]);
    expect((await reopened.shared(b))[0]).toEqual(edited);
    await expect(reopened.remove(entry.id, entry.revision)).rejects.toThrow('changed');
    await reopened.remove(edited.id, edited.revision);
    expect(await reopened.list()).toEqual([]);
    reopened.dispose();
  });
  it('hides unshared billing contact references and clears links on contact deletion', async () => {
    const { vault } = fixture();
    const contact = await vault.save({ kind:'contact', fullName:'Billing', scope:[botScopeKey(a)] },[a]);
    const card = { kind:'card', label:'Work card', scope:'all', number:'4242424242424242', expiry:'12/30' };
    await expect(vault.save({...card,billingContactId:'missing'},[a])).rejects.toThrow('billing contact');
    const saved = await vault.save({...card,billingContactId:contact.id},[a]);
    expect((await vault.shared(a)).find(row => row.id === saved.id)?.billingContactId).toBe(contact.id);
    expect((await vault.shared(b))[0]).not.toHaveProperty('billingContactId');
    await vault.remove(contact.id,contact.revision);
    expect((await vault.list())[0]).not.toHaveProperty('billingContactId');
    vault.dispose();
  });
  it('migrates existing items and preserves the OAuth encryption key across restart', async () => {
    const { kv, device, values } = fixture();
    const salt = Buffer.alloc(16, 3).toString('base64');
    const dataKey = scryptSync(pass, Buffer.from(salt, 'base64'), 32);
    const row = prepareItem(login, [a], 'saved', 'r');
    const aad = Buffer.from('zana-bot-vault/v1');
    const original = seal([row], dataKey, salt, aad);
    const store = 'vault.encrypted.v1';
    await kv.set(store, original);
    const vault = new BotVault(kv, device);
    expect(await vault.status()).toEqual({ migrationRequired: true });
    await expect(vault.list()).rejects.toThrow('migrate');
    await expect(vault.migrate('wrong passphrase attempt')).rejects.toThrow('previous Vault passphrase');
    await expect(vault.migrate(pass)).rejects.toThrow('Wait');
    expect(values.get(store)).toEqual(original);
    vault.dispose();
    let resumed: Buffer | undefined;
    const migrated = new BotVault(kv, device, () => {}, { resume(k) { resumed = k; }, pause() {} });
    await migrated.migrate(pass);
    expect(resumed).toEqual(createHmac('sha256', dataKey).update('zana-bot-connections/v1').digest());
    expect(await migrated.list()).toEqual([row.item]);
    expect(values.get(store)).toMatchObject({...original, salt:''});
    migrated.dispose();
    const restarted = new BotVault(kv, device);
    expect(await restarted.status()).toEqual({ migrationRequired: false });
    const replaced = await restarted.save({ ...login, ...row.item, password:'replacement password' }, [a]);
    expect(JSON.stringify(replaced)).not.toContain('replacement password');
    expect(open<{fields:{password:string}}>(await kv.get<Envelope>(store) as Envelope, dataKey, aad)[0].fields.password).toBe('replacement password');
    restarted.dispose();
    const before = values.get(store);
    await expect(new BotVault(kv, async () => Buffer.alloc(32, 8)).list()).rejects.toThrow('decrypt');
    expect(values.get(store)).toBe(before);
  });
  it('preserves storage if the device key is unavailable or migration cannot persist', async () => {
    const { kv, values, device } = fixture();
    await expect(new BotVault(kv, async () => { throw Error('Unavailable'); }).status()).rejects.toThrow('Unavailable');
    expect(values.size).toBe(0);
    const original = seal([], scryptSync(pass, 'salt', 32), Buffer.from('salt').toString('base64'), Buffer.from('zana-bot-vault/v1'));
    await kv.set('vault.encrypted.v1', original);
    const broken = new BotVault({ ...kv, set: async () => { throw Error('Disk full'); } }, device);
    await expect(broken.migrate('')).rejects.toThrow('previous');
    await expect(broken.migrate(undefined)).rejects.toThrow('previous');
    await expect(broken.migrate(pass)).rejects.toThrow('Disk full');
    expect([...values.values()]).toEqual([original]);
    expect(await broken.status()).toEqual({migrationRequired:true});
  });
  it('serializes writes, fails closed after disposal, and detects stale edits', async () => {
    const { vault } = fixture();
    const contact = { kind:'contact', fullName:'Test User', email:'test@example.com', scope:'all' };
    const [one] = await Promise.all([vault.save(contact, [a]), vault.save(login, [a])]);
    expect(await vault.list()).toHaveLength(2);
    await vault.save({ ...contact, id:one.id, revision:one.revision },[a]);
    await expect(vault.save({ ...contact, id:one.id, revision:one.revision }, [a])).rejects.toThrow('changed');
    vault.dispose();
    await expect(vault.list()).rejects.toThrow('unavailable');
  });
});
describe('Vault item validation', () => {
  const pack = (input: Record<string,unknown>) => prepareItem(input,[a], 'item','r1');
  const card = { kind:'card', scope:'all', number:'4242 4242 4242 4242', expiry:'12/30', securityCode:'123', nameOnCard:'Test User' };
  it('masks card fields and supports replacing or clearing them', () => {
    const saved = pack(card);
    expect(saved.item).toMatchObject({kind:'card',label:'Card',last4:'4242',hasCode:true});
    const result = JSON.stringify(saved.item);
    for (const secret of ['4242424242424242','12/30','123']) expect(result).not.toContain(secret);
    const replaced = prepareItem({kind:'card',label:'Travel',scope:'all',securityCode:''},[a],'item','r2',saved);
    expect(replaced.fields.number).toBe(saved.fields.number);
    expect(replaced.item).toMatchObject({label:'Travel',hasCode:false});
    expect(() => prepareItem(login,[a],'item','r2',saved)).toThrow('type');
  });
  it('preserves literal passwords and validates HTTPS websites and choices', () => {
    expect(pack(login).fields.password).toBe(login.password);
    expect(httpsOrigin('Example.com/path')).toBe('https://example.com');
    for (const site of ['http://example.com','https://user@foo.com','https://localhost','%']) expect(() => httpsOrigin(site)).toThrow('HTTPS');
    for (const bad of [{scope:[]},{scope:['fake']},{sites:[]},{password:''},{hint:'bad\nline'},{kind:'file'}]) expect(() => pack({...login,...bad})).toThrow();
    for (const bad of [{number:'4242424242424241'},{number:'1111111111111111'},{expiry:'13/30'},{securityCode:'abc'}]) expect(() => pack({...card,...bad})).toThrow();
    expect(() => pack({kind:'contact',scope:'all'})).toThrow('Full name');
  });
});
