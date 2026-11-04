import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { posixPermissions } from '@zana-ai/zcc-host-daemon/posix-permissions';

export const PEER_PROTOCOL_VERSION = 2;
export const MAX_PEER_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_PEER_STORE_BYTES = 4 * 1024 * 1024;
export const PEER_TOKEN = /^[a-z][a-z0-9-]{0,63}$/;
export const PEER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const PEER_NONCE = /^[A-Za-z0-9_-]{16,128}$/;
export const PEER_DIGEST = /^[A-Za-z0-9_-]{43}$/;

/** Host supplies an OS-protected key. No key generation or plaintext fallback here. */
export interface PeerKeyProvider {
  getKey(): Promise<Uint8Array | null>;
}

/** Key backend may become available later; authenticated storage failures are not availability. */
export class PeerKeyUnavailableError extends Error {}
/** Machine-readable cause suffix (a code from protected-key, never a secret) so plugins can show a truthful message. */
export const peerKeyReasonSuffix = (error: unknown): string => {
  const reason = (error as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' && /^[a-z-]{1,40}$/.test(reason) ? ` [reason=${reason}]` : '';
};

export interface PeerRequestFields {
  protocolVersion: 2;
  pairId: string;
  senderId: string;
  recipientId: string;
  pluginId: string;
  scope: string;
  route: string;
  httpMethod: 'POST';
  payloadHash: string;
  nonce: string;
  issuedAt: number;
  epoch: number;
}

export interface PeerRequestEnvelope extends PeerRequestFields {
  signature: string;
}

export function validScope(scope: unknown): scope is string {
  return typeof scope === 'string' && scope.length > 0 && Buffer.byteLength(scope) <= 1024 &&
    !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(scope);
}

export function peerRoute(pluginId: string, method: string): string {
  if (typeof pluginId !== 'string' || typeof method !== 'string' || !PEER_TOKEN.test(pluginId) || !PEER_TOKEN.test(method)) throw new Error('invalid peer route token');
  return `/api/v1/peer/${pluginId}/${method}`;
}

export function peerBodyHash(body: Uint8Array): string {
  if (!(body instanceof Uint8Array) || body.byteLength > MAX_PEER_BODY_BYTES) throw new Error('invalid peer body');
  return createHash('sha256').update(body).digest('hex');
}

export function validatePeerFields(value: PeerRequestFields): void {
  if (!value || [value.pairId, value.senderId, value.recipientId, value.pluginId, value.route, value.payloadHash, value.nonce]
    .some((item) => typeof item !== 'string') || value.protocolVersion !== PEER_PROTOCOL_VERSION || !PEER_ID.test(value.pairId) ||
    !PEER_ID.test(value.senderId) || !PEER_ID.test(value.recipientId) || value.senderId === value.recipientId ||
    !PEER_TOKEN.test(value.pluginId) || !validScope(value.scope) || value.httpMethod !== 'POST' ||
    !/^[a-f0-9]{64}$/.test(value.payloadHash) || !PEER_NONCE.test(value.nonce) ||
    !Number.isSafeInteger(value.issuedAt) || value.issuedAt < 0 ||
    !Number.isSafeInteger(value.epoch) || value.epoch < 1) throw new Error('invalid peer auth fields');
  const method = value.route?.split('/')[5];
  if (!method || value.route !== peerRoute(value.pluginId, method)) throw new Error('invalid canonical peer route');
}

/** Fixed order; every UTF-8 field has a four-byte unsigned big-endian byte length. */
export function canonicalPeerMac(fields: PeerRequestFields): Buffer {
  validatePeerFields(fields);
  const values = ['zcc-peer-auth', String(fields.protocolVersion), fields.pairId, fields.senderId,
    fields.recipientId, fields.pluginId, fields.scope, fields.route, fields.httpMethod, fields.payloadHash,
    fields.nonce, String(fields.issuedAt), String(fields.epoch)];
  return Buffer.concat(values.flatMap((value) => {
    const bytes = Buffer.from(value, 'utf8'), length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return [length, bytes];
  }));
}

export function parsePeerMac(payload: Uint8Array): PeerRequestFields {
  if (payload.byteLength > 4096) throw new Error('invalid canonical peer MAC');
  const bytes = Buffer.from(payload), values: string[] = [];
  let offset = 0;
  while (offset < bytes.length && values.length < 13) {
    if (offset + 4 > bytes.length) throw new Error('invalid canonical peer MAC');
    const length = bytes.readUInt32BE(offset);
    offset += 4;
    if (offset + length > bytes.length) throw new Error('invalid canonical peer MAC');
    values.push(bytes.subarray(offset, offset + length).toString('utf8'));
    offset += length;
  }
  if (values.length !== 13 || offset !== bytes.length || values[0] !== 'zcc-peer-auth') throw new Error('invalid canonical peer MAC');
  const fields = {
    protocolVersion: Number(values[1]), pairId: values[2], senderId: values[3], recipientId: values[4],
    pluginId: values[5], scope: values[6], route: values[7], httpMethod: values[8], payloadHash: values[9],
    nonce: values[10], issuedAt: Number(values[11]), epoch: Number(values[12])
  } as PeerRequestFields;
  if (!canonicalPeerMac(fields).equals(bytes)) throw new Error('noncanonical peer MAC');
  return fields;
}

export function sealPeerBytes(plaintext: Uint8Array, key: Uint8Array, aad: string): Buffer {
  if (key.byteLength !== 32) throw new Error('peer encryption key unavailable');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from('ZCP2'), iv, cipher.getAuthTag(), ciphertext]);
}

export function unsealPeerBytes(bytes: Buffer, key: Uint8Array, aad: string): Buffer {
  if (key.byteLength !== 32 || bytes.length < 32 || bytes.subarray(0, 4).toString() !== 'ZCP2') throw new Error('invalid encrypted peer storage');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(4, 16), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(bytes.subarray(16, 32));
  return Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()]);
}

const queues = new Map<string, { tail: Promise<unknown>; pending: number }>();

/** One host process owns storage. Shared mutex also fences separate instances in that process. */
export async function serializePeerStorage<T>(directory: string, run: () => Promise<T>): Promise<T> {
  const id = resolve(directory);
  let queue = queues.get(id);
  if (!queue) { queue = { tail: Promise.resolve(), pending: 0 }; queues.set(id, queue); }
  if (queue.pending >= 128) throw new Error('peer storage mutation queue full');
  queue.pending++;
  const result = queue.tail.then(run, run);
  queue.tail = result.catch(() => undefined);
  try { return await result; }
  finally { if (--queue.pending === 0) queues.delete(id); }
}

const retiredLogged = new Set<string>();

/** Bounded, private, authenticated snapshot. Corruption never becomes an empty store. */
export class PrivatePeerStorage<T> {
  readonly directory: string;
  private readonly file: string;
  private readonly marker: string;
  private disposed = false;
  constructor(directory: string, private readonly name: string, private readonly provider: PeerKeyProvider | undefined,
    private readonly identity: string, private readonly initial: () => T, private readonly validate: (value: unknown) => T) {
    if (!isAbsolute(directory)) throw new Error('peer storage requires absolute host-owned path');
    this.directory = resolve(directory);
    this.file = join(this.directory, `${name}.bin`);
    this.marker = join(this.directory, `${name}.initialized`);
  }

  async transaction<R>(run: (state: T, save: () => Promise<void>) => Promise<R>): Promise<R> {
    if (this.disposed) throw new Error('peer storage disposed');
    return serializePeerStorage(this.directory, async () => {
      if (this.disposed) throw new Error('peer storage disposed');
      let supplied;
      try { supplied = await this.provider?.getKey(); } catch (error) { throw new PeerKeyUnavailableError(`peer encryption key unavailable${peerKeyReasonSuffix(error)}`); }
      if (!supplied || supplied.byteLength !== 32) throw new PeerKeyUnavailableError('peer encryption key or local identity unavailable');
      if (!PEER_ID.test(this.identity)) throw new Error('peer local identity unavailable');
      const key = Buffer.from(supplied);
      try {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        await this.checkDirectory();
        const initialized = await this.readPrivate(this.marker);
        if (initialized && initialized.toString('utf8') !== 'v2') throw new Error('peer storage initialization marker corrupt');
        await this.recoverTemps();
        const bytes = await this.readPrivate(this.file);
        let state: T;
        if (bytes) {
          let plain: Buffer | undefined;
          try {
            plain = unsealPeerBytes(bytes, key, `${this.name}:${this.identity}`);
            state = this.validate(JSON.parse(plain.toString('utf8')));
          } catch { throw new Error('peer storage corrupt or key mismatch'); }
          finally { plain?.fill(0); }
        } else {
          if (initialized) throw new Error('peer storage missing after initialization');
          state = this.initial();
        }
        return await run(state, async () => {
          this.validate(state);
          const plain = Buffer.from(JSON.stringify(state));
          try {
            if (plain.length > MAX_PEER_STORE_BYTES - 32) throw new Error('peer storage capacity exceeded');
            await this.writePrivate(sealPeerBytes(plain, key, `${this.name}:${this.identity}`));
          }
          finally { plain.fill(0); }
        });
      } finally { key.fill(0); }
    });
  }

  dispose(): void { this.disposed = true; }

  /** Stop producers before draining; already admitted writes retain atomic cleanup. */
  async whenIdle(): Promise<void> {
    while (queues.has(this.directory)) await queues.get(this.directory)!.tail;
  }

  private async checkDirectory(): Promise<void> {
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink() || posixPermissions() && ((info.mode & 0o7777) !== 0o700 || info.uid !== process.getuid!()) ||
      await realpath(this.directory) !== this.directory) {
      throw new Error('unsafe peer storage directory');
    }
  }

  /**
   * A store renamed to a newer `<base>-v<N>` leaves the older version's files beside it. They hold the previous
   * format and are never read again, so they are ignored (left untouched, logged once) instead of blocking the new store.
   */
  private isRetiredVersionFile(entry: string): boolean {
    const base = this.name.replace(/-v\d+$/, '');
    if (base === this.name) return false;
    const match = new RegExp(`^${base.replace(/[^\w-]/g, '\\$&')}-v(\\d+)\\.(?:bin|initialized|bin\\.[0-9a-f]+\\.tmp)$`).exec(entry);
    if (!match || `${base}-v${match[1]}` === this.name) return false;
    const key = join(this.directory, entry);
    if (!retiredLogged.has(key)) {
      retiredLogged.add(key);
      console.warn(`[peers] ignoring retired storage file ${entry} in ${this.directory}`);
    }
    return true;
  }

  private async recoverTemps(): Promise<void> {
    // Single host owner; interrupted writes cannot accumulate unbounded secret ciphertext files.
    const entries = await opendir(this.directory), stale: string[] = [];
    let count = 0;
    for await (const entry of entries) {
      if (++count > 32) throw new Error('peer storage directory capacity exceeded');
      if (entry.name === `${this.name}.bin` || entry.name === `${this.name}.initialized`) continue;
      if (entry.isFile() && this.isRetiredVersionFile(entry.name)) continue;
      if (!entry.isFile() || !entry.name.startsWith(`${this.name}.bin.`) || !entry.name.endsWith('.tmp')) {
        throw new Error('peer storage requires explicit host migration');
      }
      stale.push(join(this.directory, entry.name));
    }
    for (const path of stale) await rm(path);
  }

  private async readPrivate(path: string): Promise<Buffer | null> {
    let handle;
    try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('unsafe peer storage file'); }
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > MAX_PEER_STORE_BYTES || posixPermissions() && ((info.mode & 0o7777) !== 0o600 || info.uid !== process.getuid!())) {
        throw new Error('unsafe peer storage file');
      }
      const bytes = Buffer.alloc(info.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, null);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      if (length !== info.size) throw new Error('peer storage changed during read');
      return bytes.subarray(0, length);
    } finally { await handle.close(); }
  }

  private async writePrivate(bytes: Buffer): Promise<void> {
    const temp = `${this.file}.${randomBytes(12).toString('hex')}.tmp`;
    try {
      const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await this.checkDirectory();
      await rename(temp, this.file);
      // Missing committed snapshots must not reset epochs/replay state on restart.
      const existing = await this.readPrivate(this.marker);
      if (!existing) {
        const marker = await open(this.marker, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await marker.writeFile('v2'); await marker.sync(); } finally { await marker.close(); }
      }
      // Directories cannot be fsynced on Windows (EPERM); the snapshot and marker files were already synced.
      if (process.platform !== 'win32') {
        const directory = await open(this.directory, constants.O_RDONLY);
        try { await directory.sync(); } finally { await directory.close(); }
      }
    } finally { await rm(temp, { force: true }); }
  }
}
