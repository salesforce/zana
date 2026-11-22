import { describe, expect, it } from 'vitest';
import { botScopeKey, httpsOrigin, prepareItem } from './items.js';
import { BotVault } from './storage.js';

const a = { id: 'scout', name: 'Scout', createdAt: 1 };
const b = { id: 'coach', name: 'Coach', createdAt: 1 };
const pass = 'an isolated test passphrase';
const login = { kind: 'login', sites: ['https://accounts.example.com/login'], username: 'dev', password: ' fixture secret! ', scope: [botScopeKey(a)] };
function fixture() {
  let now = 1000;
  const values = new Map<string, unknown>();
  const kv = { get: async <T,>(key: string) => structuredClone(values.get(key)) as T | undefined, set: async (key: string, data: unknown) => { values.set(key, structuredClone(data)); } };
  const vault = new BotVault(kv, () => now);
  return { vault, values, kv, tick: (ms: number) => { now += ms; } };
}

describe('encrypted bot Vault', () => {
  it('persists authenticated ciphertext, exposes only shared metadata, and preserves write-only fields across edits and restart', async () => {
    const { vault, kv, values } = fixture();
    expect(await vault.status()).toEqual({ configured: false });
    const { token } = await vault.unlock(pass, true);
    const entry = await vault.save(token, login, [a,b]);
    expect(entry.sites).toEqual(['https://accounts.example.com']);
    expect(await vault.shared(a)).toEqual([entry]);
    expect(await vault.shared(b)).toEqual([]);
    expect(await vault.shared({ ...a, createdAt: 5 })).toEqual([]);
    expect(JSON.stringify(await vault.list(token))).not.toContain(login.password);
    const persisted = JSON.stringify([...values.values()]);
    for (const text of [pass, token, login.password, entry.sites[0]]) expect(persisted).not.toContain(text);
    await vault.lock(token);
    await expect(vault.shared(a)).rejects.toThrow('Unlock');
    const reopened = new BotVault(kv);
    await expect(reopened.unlock(pass, true)).rejects.toThrow('already exists');
    const next = await reopened.unlock(pass, false);
    await expect(reopened.list(token)).rejects.toThrow('Unlock');
    const edited = await reopened.save(next.token, { ...entry, username:'new', scope:'all' }, [a,b]);
    expect((await reopened.shared(b))[0]).toEqual(edited);
    await expect(reopened.remove(next.token, entry.id, entry.revision)).rejects.toThrow('changed');
    await reopened.remove(next.token, edited.id, edited.revision);
    expect(await reopened.list(next.token)).toEqual([]);
    reopened.dispose();
  });
  it('hides unshared billing contact references and clears links on contact deletion', async () => {
    const { vault } = fixture();
    const { token } = await vault.unlock(pass, true);
    const contact = await vault.save(token,{ kind:'contact', fullName:'Billing', scope:[botScopeKey(a)] },[a]);
    const card = { kind:'card', label:'Work card', scope:'all', number:'4242424242424242', expiry:'12/30' };
    await expect(vault.save(token,{...card,billingContactId:'missing'},[a])).rejects.toThrow('billing contact');
    const saved = await vault.save(token,{...card,billingContactId:contact.id},[a]);
    expect((await vault.shared(a)).find(row => row.id === saved.id)?.billingContactId).toBe(contact.id);
    expect((await vault.shared(b))[0]).not.toHaveProperty('billingContactId');
    await vault.remove(token,contact.id,contact.revision);
    expect((await vault.list(token))[0]).not.toHaveProperty('billingContactId');
    vault.dispose();
  });
  it('locks on expiry, bounds attempts, and rejects tampering without replacing data', async () => {
    const { vault, values, tick } = fixture();
    await expect(vault.unlock('short', true)).rejects.toThrow('12 to 512');
    await expect(vault.unlock(pass, false)).rejects.toThrow('Create');
    const first = vault.unlock(pass, true);
    await expect(vault.unlock(pass, true)).rejects.toThrow('Wait');
    const { token } = await first;
    tick(30*60_000);
    await expect(vault.list(token)).rejects.toThrow('Unlock');
    await expect(vault.unlock(pass + 'wrong', false)).rejects.toThrow('Could not unlock');
    await expect(vault.unlock(pass, false)).rejects.toThrow('Wait');
    tick(1500);
    const e = [...values.values()][0] as { tag: string };
    e.tag = Buffer.alloc(16, 9).toString('base64');
    await expect(vault.unlock(pass, false)).rejects.toThrow('Could not unlock');
    expect([...values.values()][0]).toBe(e);
  });
  it('serializes writes, fails closed after disposal, and detects stale edits', async () => {
    const { vault } = fixture(); const { token } = await vault.unlock(pass,true);
    const contact = { kind:'contact', fullName:'Test User', email:'test@example.com', scope:'all' };
    await expect(vault.save(null, contact, [a])).rejects.toThrow('Unlock');
    const [one] = await Promise.all([vault.save(token, contact, [a]), vault.save(token, login, [a])]);
    expect(await vault.list(token)).toHaveLength(2);
    await vault.save(token, { ...contact, id:one.id, revision:one.revision },[a]);
    await expect(vault.save(token, { ...contact, id:one.id, revision:one.revision }, [a])).rejects.toThrow('changed');
    vault.dispose();
    await expect(vault.unlock(pass,false)).rejects.toThrow('unavailable');
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
