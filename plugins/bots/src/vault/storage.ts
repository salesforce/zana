import { createHmac, randomBytes, randomUUID, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { isShared, prepareItem, type BotIdentity, type SavedItem, type VaultItem } from './items.js';

import { open, seal, type Envelope } from './encryption.js';

const derive = promisify(scrypt);
const STORE_KEY = 'vault.encrypted.v1';
const AAD = Buffer.from('zana-bot-vault/v1');
const WRAP_AAD = Buffer.from('zana-bot-vault/device-key/v1');
interface Kv { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> }
interface DeviceEnvelope extends Envelope { wrappedKey: Envelope }
interface Session { key: Buffer; wrappedKey: Envelope }

export class BotVault {
  private chain: Promise<unknown> = Promise.resolve();
  private session?: Session;
  private retryAfter = 0;
  private disposed = false;
  constructor(private kv: Kv, private deviceKey: () => Promise<Uint8Array>, private changed = () => {},
    private connections?: { resume(key: Buffer): void; pause(): void }) {}
  private serial<T>(fn: () => Promise<T>) {
    const p = this.chain.then(fn);
    this.chain = p.catch(() => {});
    return p;
  }
  private assertLive() {
    if (this.disposed) throw new Error('Vault is unavailable.');
  }
  dispose() {
    this.disposed = true;
    this.session?.key.fill(0);
    this.session = undefined;
    this.connections?.pause();
  }
  // Rewrap the original data key so saved items and independently encrypted OAuth grants move together.
  private async prepare(legacyPassphrase?: unknown): Promise<Session | null> {
    this.assertLive();
    if (this.session) return this.session;
    const envelope = await this.kv.get<Envelope | DeviceEnvelope>(STORE_KEY);
    const legacy = envelope && !('wrappedKey' in envelope);
    if (legacy && legacyPassphrase === undefined) return null;
    if (legacy && (typeof legacyPassphrase !== 'string' || legacyPassphrase.length < 12 || legacyPassphrase.length > 512))
      throw new Error('Enter the previous Vault passphrase.');
    if (legacy && Date.now() < this.retryAfter) throw new Error('Wait a moment before trying again.');
    const device = await this.deviceKey();
    const wrappingKey = Buffer.from(device);
    device.fill(0);
    let key: Buffer | undefined;
    try {
      this.assertLive();
      let wrappedKey: Envelope;
      if (envelope && 'wrappedKey' in envelope) {
        wrappedKey = envelope.wrappedKey;
        const [encoded] = open<string>(wrappedKey, wrappingKey, WRAP_AAD);
        key = Buffer.from(encoded, 'base64');
        open(envelope, key, AAD);
      } else {
        if (envelope) {
          key = await derive(legacyPassphrase as string, Buffer.from(envelope.salt, 'base64'), 32) as Buffer;
          try { open(envelope, key, AAD); }
          catch { this.retryAfter = Date.now() + 1000; throw new Error('Check the previous Vault passphrase and try again.'); }
        } else key = randomBytes(32);
        wrappedKey = seal([key.toString('base64')], wrappingKey, '', WRAP_AAD);
        this.assertLive();
        await this.kv.set(STORE_KEY, { ...(envelope ?? seal([], key, '', AAD)), salt: '', wrappedKey });
      }
      this.assertLive();
      this.connections?.resume(createHmac('sha256', key).update('zana-bot-connections/v1').digest());
      this.session = { key, wrappedKey };
      key = undefined;
      return this.session;
    } finally { key?.fill(0); wrappingKey.fill(0); }
  }
  status() { return this.serial(async () => ({ migrationRequired: !(await this.prepare()) })); }
  migrate(passphrase: unknown) {
    return this.serial(async () => {
      if (!await this.prepare(passphrase)) throw new Error('Enter the previous Vault passphrase.');
      this.changed();
    });
  }
  private async ready() {
    const session = await this.prepare();
    if (!session) throw new Error('Open the Vault in Zana to migrate existing items.');
    return session;
  }
  ensureReady() { return this.serial(async () => { await this.ready(); }); }
  private async read(session: Session) {
    const envelope = await this.kv.get<DeviceEnvelope>(STORE_KEY);
    this.assertLive();
    if (!envelope) throw new Error('Vault storage is unavailable.');
    return open<SavedItem>(envelope, session.key, AAD);
  }
  private write(rows: SavedItem[], session: Session) {
    this.assertLive();
    return this.kv.set(STORE_KEY, { ...seal(rows, session.key, '', AAD), wrappedKey: session.wrappedKey });
  }
  list(): Promise<VaultItem[]> {
    return this.serial(async () => (await this.read(await this.ready())).map(row => row.item));
  }
  shared(bot: BotIdentity): Promise<VaultItem[]> {
    return this.serial(async () => {
      const shared = (await this.read(await this.ready())).map(row => row.item).filter(item => isShared(item, bot));
      const ids = new Set(shared.map(item => item.id));
      for (const item of shared) {
        if (item.billingContactId && !ids.has(item.billingContactId)) delete item.billingContactId;
      }
      return shared;
    });
  }
  save(raw: Record<string, unknown>, bots: BotIdentity[]) {
    return this.serial(async () => {
      const session = await this.ready();
      const rows = await this.read(session);
      const prior = raw.id === undefined ? undefined : rows.find(row => row.item.id === raw.id);
      if (raw.id !== undefined && (!prior || prior.item.revision !== raw.revision)) throw new Error('This item changed. Reopen it to edit.');
      if (!prior && rows.length >= 200) throw new Error('The Vault holds up to 200 items.');
      const entry = prepareItem(raw, bots, prior?.item.id ?? randomUUID(), randomUUID(), prior);
      if (entry.item.billingContactId && !rows.some(row => row.item.id === entry.item.billingContactId && row.item.kind === 'contact')) {
        throw new Error('Choose a saved billing contact.');
      }
      await this.write([entry, ...rows.filter(row => row !== prior)], session);
      this.changed();
      return entry.item;
    });
  }
  remove(id: unknown, revision: unknown) {
    return this.serial(async () => {
      const session = await this.ready();
      const rows = await this.read(session);
      const prior = rows.find(row => row.item.id === id);
      if (!prior || prior.item.revision !== revision) throw new Error('This item changed. Reopen it to delete.');
      const remaining = rows.filter(row => row !== prior);
      for (const row of remaining) {
        if (row.item.billingContactId === id) {
          delete row.item.billingContactId;
          row.item.revision = randomUUID();
        }
      }
      await this.write(remaining, session);
      this.changed();
    });
  }
}
