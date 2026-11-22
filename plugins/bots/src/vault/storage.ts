import { createHmac, randomBytes, randomUUID, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { isShared, prepareItem, type BotIdentity, type SavedItem, type VaultItem } from './items.js';

import { open, seal, type Envelope } from './encryption.js';

const derive = promisify(scrypt);
const STORE_KEY = 'vault.encrypted.v1';
const AAD = Buffer.from('zana-bot-vault/v1');
const SESSION_MS = 30 * 60_000;
interface Kv { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> }
interface Session { key: Buffer; salt: string; token: string; expires: number }

export class BotVault {
  private chain: Promise<unknown> = Promise.resolve();
  private session?: Session;
  private expiry?: ReturnType<typeof setTimeout>;
  private unlocking = false;
  private unlockAfter = 0;
  private disposed = false;
  constructor(private kv: Kv, private now = Date.now, private changed = () => {},
    private connections?: { resume(key: Buffer): void; pause(): void }) {}
  private serial<T>(fn: () => Promise<T>) {
    const p = this.chain.then(fn);
    this.chain = p.catch(() => {});
    return p;
  }
  requireOwner(token: unknown) { this.active(token, true); }
  async status() { return { configured: Boolean(await this.kv.get(STORE_KEY)) }; }
  private active(token?: unknown, owner = false): Session {
    if (this.session && this.now() >= this.session.expires) this.close();
    if (!this.session || (owner && token !== this.session.token)) throw new Error('Unlock the Vault to continue.');
    return this.session;
  }
  dispose() { this.disposed = true; this.close(); this.connections?.pause(); }
  private close() {
    clearTimeout(this.expiry);
    this.session?.key.fill(0);
    this.session = undefined;
  }
  lock(token: unknown) { return this.serial(async () => { this.active(token, true); this.close(); this.connections?.pause(); this.changed(); }); }
  async unlock(passphrase: unknown, create: boolean) {
    if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 512) throw new Error('Use a passphrase of 12 to 512 characters.');
    if (this.unlocking || this.now() < this.unlockAfter) throw new Error('Wait a moment before trying again.');
    this.unlocking = true;
    try {
      return await this.serial(async () => {
        if (this.disposed) throw new Error('Vault is unavailable.');
        const envelope = await this.kv.get<Envelope>(STORE_KEY);
        if (Boolean(envelope) === create) throw new Error(create ? 'A Vault already exists.' : 'Create a Vault first.');
        const salt = envelope?.salt ?? randomBytes(16).toString('base64');
        const key = (await derive(passphrase, Buffer.from(salt, 'base64'), 32)) as Buffer;
        try {
          if (this.disposed) throw new Error('Vault is unavailable.');
          if (envelope) open(envelope, key, AAD);
          else await this.kv.set(STORE_KEY, seal([], key, salt, AAD));
        } catch (error) { key.fill(0); this.unlockAfter = this.now() + 1_000; throw error; }
        if (this.disposed) { key.fill(0); throw new Error('Vault is unavailable.'); }
        this.close();
        const token = randomBytes(32).toString('hex');
        this.connections?.resume(createHmac('sha256', key).update('zana-bot-connections/v1').digest());
        this.session = { key, salt, token, expires: this.now() + SESSION_MS };
        this.expiry = setTimeout(() => {
          void this.serial(async () => {
            if (this.session?.token === token) { this.close(); this.changed(); }
          });
        }, SESSION_MS);
        this.expiry.unref?.();
        return { token };
      });
    } finally { this.unlocking = false; }
  }
  private async read(session: Session) {
    const envelope = await this.kv.get<Envelope>(STORE_KEY);
    if (!envelope) throw new Error('Vault storage is unavailable.');
    return open<SavedItem>(envelope, session.key, AAD);
  }
  list(token: unknown): Promise<VaultItem[]> {
    return this.serial(async () => (await this.read(this.active(token, true))).map(row => row.item));
  }
  shared(bot: BotIdentity): Promise<VaultItem[]> {
    return this.serial(async () => {
      const shared = (await this.read(this.active())).map(row => row.item).filter(item => isShared(item, bot));
      const ids = new Set(shared.map(item => item.id));
      for (const item of shared) {
        if (item.billingContactId && !ids.has(item.billingContactId)) delete item.billingContactId;
      }
      return shared;
    });
  }
  save(token: unknown, raw: Record<string, unknown>, bots: BotIdentity[]) {
    return this.serial(async () => {
      const session = this.active(token, true);
      const rows = await this.read(session);
      this.active(token, true);
      const prior = raw.id === undefined ? undefined : rows.find(row => row.item.id === raw.id);
      if (raw.id !== undefined && (!prior || prior.item.revision !== raw.revision)) throw new Error('This item changed. Reopen it to edit.');
      if (!prior && rows.length >= 200) throw new Error('The Vault holds up to 200 items.');
      const entry = prepareItem(raw, bots, prior?.item.id ?? randomUUID(), randomUUID(), prior);
      if (entry.item.billingContactId && !rows.some(row => row.item.id === entry.item.billingContactId && row.item.kind === 'contact')) {
        throw new Error('Choose a saved billing contact.');
      }
      await this.kv.set(STORE_KEY, seal([entry, ...rows.filter(row => row !== prior)], session.key, session.salt, AAD));
      this.changed();
      return entry.item;
    });
  }
  remove(token: unknown, id: unknown, revision: unknown) {
    return this.serial(async () => {
      const session = this.active(token, true);
      const rows = await this.read(session);
      this.active(token, true);
      const prior = rows.find(row => row.item.id === id);
      if (!prior || prior.item.revision !== revision) throw new Error('This item changed. Reopen it to delete.');
      const remaining = rows.filter(row => row !== prior);
      for (const row of remaining) {
        if (row.item.billingContactId === id) {
          delete row.item.billingContactId;
          row.item.revision = randomUUID();
        }
      }
      await this.kv.set(STORE_KEY, seal(remaining, session.key, session.salt, AAD));
      this.changed();
    });
  }
}
