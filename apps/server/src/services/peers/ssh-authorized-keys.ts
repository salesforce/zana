import { randomBytes } from 'node:crypto';
import { constants as fsc } from 'node:fs';
import { mkdir, lstat, link, open, readFile, rename, stat, unlink, type FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { AuthorizedKeyInput, AuthorizedKeyKind, AuthorizedKeys } from './peer-ssh-contract.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PUB = /^ssh-ed25519 [A-Za-z0-9+/]{68}$/;
// Exact shape of `render()`: option prefix, key, then the comment. A foreign line that merely ends with our comment never matches.
const OWNED = /^restrict,port-forwarding,permitlisten="127\.0\.0\.1:\d{4,5}",permitopen="127\.0\.0\.1:\d{4,5}",command="\/usr\/bin\/false"(?:,expiry-time="\d{12}Z")? ssh-ed25519 [A-Za-z0-9+/]{68} zana-peer-v1:([A-Za-z0-9._-]+):([A-Za-z0-9._-]+):(bootstrap|link)$/;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ATTEMPTS = 3;
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 15_000;
const LOCK_POLL_MS = 20;
const LOCK_NAME = '.zana-ak.lock';

/**
 * Thrown when the user's ~/.ssh cannot be edited safely (symlink, wrong owner, oversized, concurrent churn).
 * The message is the stable transport reason; `detail` is for logs only and never carries file contents.
 */
export class AuthorizedKeysRefusedError extends Error {
  constructor(readonly detail: string) { super('ssh_auth_refused'); this.name = 'AuthorizedKeysRefusedError'; }
}

interface Signature { ino: number; size: number; mtimeMs: number; ctimeMs: number }
interface Snapshot { text: string; sig: Signature | undefined }
interface OwnedLine { index: number; linkId: string; kind: AuthorizedKeyKind }

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const isCode = (error: unknown, ...codes: string[]) => codes.includes((error as NodeJS.ErrnoException)?.code ?? '');
const sameSig = (a: Signature | undefined, b: Signature | undefined) =>
  a === b || (!!a && !!b && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs);
const signatureOf = (s: Signature): Signature => ({ ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs });

/** sshd `expiry-time` is minute-granular UTC; round up so a line never expires before `expiresAt`. */
export function formatExpiryTime(expiresAt: number): string {
  const d = new Date(Math.ceil(expiresAt / 60_000) * 60_000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z`;
}

function validate(input: AuthorizedKeyInput): void {
  const port = (n: unknown) => Number.isInteger(n) && (n as number) >= 1024 && (n as number) <= 65535;
  if (!ID.test(input.linkId)) throw new Error('invalid authorized key link id');
  if (input.kind !== 'bootstrap' && input.kind !== 'link') throw new Error('invalid authorized key kind');
  if (typeof input.pub !== 'string' || !PUB.test(input.pub)) throw new Error('invalid authorized key');
  if (!port(input.listenPort) || !port(input.targetPort)) throw new Error('invalid authorized key port');
  if (input.expiresAt !== undefined && !(Number.isSafeInteger(input.expiresAt) && input.expiresAt > 0)) throw new Error('invalid authorized key expiry');
}

/**
 * Manages Zana-owned lines in the user's real authorized_keys. Only lines with our exact rendered option prefix and a trailing
 * comment `zana-peer-v1:<instanceId>:<linkId>:<kind>` for THIS instance are ever changed; every other byte is preserved
 * (decoded as latin1 so arbitrary foreign content, CRLF, and a missing final newline round-trip exactly).
 * Writes are tmp + fsync + rename, serialized in-process by a promise chain and across processes by an O_EXCL lockfile.
 */
export class SshAuthorizedKeys implements AuthorizedKeys {
  private readonly path: string;
  private readonly instanceId: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: { instanceId: string; authorizedKeysPath?: string }) {
    if (!ID.test(options.instanceId)) throw new Error('invalid instance id');
    this.instanceId = options.instanceId;
    this.path = options.authorizedKeysPath ?? join(homedir(), '.ssh', 'authorized_keys');
  }

  async upsert(input: AuthorizedKeyInput): Promise<void> {
    validate(input);
    const line = this.render(input);
    await this.mutate(true, lines => {
      const owned = this.owned(lines).filter(o => o.linkId === input.linkId && o.kind === input.kind);
      if (owned.length === 1 && stripEol(lines[owned[0]!.index]!) === line) return lines;
      if (owned.length === 0) return [...terminated(lines, eolOf(lines)), line + eolOf(lines)];
      const next = lines.slice();
      const first = owned[0]!.index;
      next[first] = line + eolPart(lines[first]!);
      for (const extra of owned.slice(1).reverse()) next.splice(extra.index, 1);
      return next;
    });
  }

  async remove(linkId: string, kind?: AuthorizedKeyKind): Promise<void> {
    if (!ID.test(linkId)) throw new Error('invalid authorized key link id');
    if (kind !== undefined && kind !== 'bootstrap' && kind !== 'link') throw new Error('invalid authorized key kind');
    await this.mutate(false, lines => this.drop(lines, o => o.linkId === linkId && (kind === undefined || o.kind === kind)));
  }

  async reconcile(liveLinkIds: ReadonlySet<string>): Promise<void> {
    await this.mutate(false, lines => this.drop(lines, o => !liveLinkIds.has(o.linkId)));
  }

  async list(): Promise<Array<{ linkId: string; kind: AuthorizedKeyKind }>> {
    const { text } = await this.read(true);
    return this.owned(splitLines(text)).map(({ linkId, kind }) => ({ linkId, kind }));
  }

  private render(input: AuthorizedKeyInput): string {
    // OpenSSH's `restrict` disables TCP and stream-local forwarding; `port-forwarding` re-enables both under sshd policy.
    // It is required for TCP: no per-key TCP-only switch exists, and permitopen/permitlisten constrain only host:port.
    // This line cannot block Unix-socket forwarding: PeerSshd's sshd refuses it, and peer-ssh-local's self-test proves that.
    const options = ['restrict', 'port-forwarding', `permitlisten="127.0.0.1:${input.listenPort}"`,
      `permitopen="127.0.0.1:${input.targetPort}"`, 'command="/usr/bin/false"'];
    if (input.expiresAt !== undefined) options.push(`expiry-time="${formatExpiryTime(input.expiresAt)}"`);
    return `${options.join(',')} ${input.pub} zana-peer-v1:${this.instanceId}:${input.linkId}:${input.kind}`;
  }

  private owned(lines: string[]): OwnedLine[] {
    const out: OwnedLine[] = [];
    lines.forEach((raw, index) => {
      const text = stripEol(raw);
      if (text.trimStart().startsWith('#')) return;
      const match = OWNED.exec(text);
      if (match && match[1] === this.instanceId) out.push({ index, linkId: match[2]!, kind: match[3] as AuthorizedKeyKind });
    });
    return out;
  }

  private drop(lines: string[], pick: (o: OwnedLine) => boolean): string[] {
    const doomed = new Set(this.owned(lines).filter(pick).map(o => o.index));
    return doomed.size === 0 ? lines : lines.filter((_, i) => !doomed.has(i));
  }

  /** Serialize in-process, then take the cross-process lock and run a verified read-modify-write. */
  private mutate(create: boolean, edit: (lines: string[]) => string[]): Promise<void> {
    const run = this.chain.then(() => this.locked(create, edit));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async locked(create: boolean, edit: (lines: string[]) => string[]): Promise<void> {
    const dir = dirname(this.path);
    if (create) await this.ensureDir(dir);
    else if (!(await this.dirExists(dir))) return;
    const release = await this.acquireLock(dir);
    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const before = await this.read(false);
        const lines = splitLines(before.text);
        const next = edit(lines);
        if (next === lines) return;
        const text = next.join('');
        if (text === before.text) return;
        if (await this.commit(dir, text, before.sig)) return;
      }
      throw new AuthorizedKeysRefusedError('authorized_keys changed concurrently');
    } finally { await release(); }
  }

  private async ensureDir(dir: string): Promise<void> {
    let info = await lstat(dir).catch(error => { if (isCode(error, 'ENOENT')) return undefined; throw error; });
    if (!info) {
      await mkdir(dir, { mode: 0o700 }).catch(error => { if (!isCode(error, 'EEXIST')) throw error; });
      info = await lstat(dir);
    }
    this.checkDir(info);
  }

  private async dirExists(dir: string): Promise<boolean> {
    const info = await lstat(dir).catch(error => { if (isCode(error, 'ENOENT', 'ENOTDIR')) return undefined; throw error; });
    if (!info) return false;
    this.checkDir(info);
    return true;
  }

  private checkDir(info: { isSymbolicLink(): boolean; isDirectory(): boolean; uid: number }): void {
    if (info.isSymbolicLink()) throw new AuthorizedKeysRefusedError('ssh directory is a symlink');
    if (!info.isDirectory()) throw new AuthorizedKeysRefusedError('ssh path is not a directory');
    if (!ownedByUs(info.uid)) throw new AuthorizedKeysRefusedError('ssh directory not owned by current user');
  }

  /** Read via an O_NOFOLLOW fd so the checks and the bytes come from the same inode. Missing file reads as empty. */
  private async read(checkDirToo: boolean): Promise<Snapshot> {
    if (checkDirToo && !(await this.dirExists(dirname(this.path)))) return { text: '', sig: undefined };
    let handle: FileHandle;
    try { handle = await open(this.path, fsc.O_RDONLY | fsc.O_NOFOLLOW); }
    catch (error) {
      if (isCode(error, 'ENOENT')) return { text: '', sig: undefined };
      if (isCode(error, 'ELOOP')) throw new AuthorizedKeysRefusedError('authorized_keys is a symlink');
      throw error;
    }
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new AuthorizedKeysRefusedError('authorized_keys is not a regular file');
      if (!ownedByUs(info.uid)) throw new AuthorizedKeysRefusedError('authorized_keys not owned by current user');
      if (info.size > MAX_FILE_BYTES) throw new AuthorizedKeysRefusedError('authorized_keys too large');
      const bytes = await handle.readFile();
      if (bytes.length > MAX_FILE_BYTES) throw new AuthorizedKeysRefusedError('authorized_keys too large');
      return { text: bytes.toString('latin1'), sig: signatureOf(info) };
    } finally { await handle.close(); }
  }

  /** Write tmp, fsync, re-stat the target, then rename. False means the target changed since it was read. */
  private async commit(dir: string, text: string, expected: Signature | undefined): Promise<boolean> {
    const tmp = join(dir, `${basename(this.path)}.zana-${process.pid}-${randomBytes(6).toString('hex')}`);
    let renamed = false;
    try {
      const handle = await open(tmp, 'wx', 0o600);
      try { await handle.writeFile(Buffer.from(text, 'latin1')); await handle.sync(); } finally { await handle.close(); }
      const now = await lstat(this.path).then(signatureOf, error => { if (isCode(error, 'ENOENT')) return undefined; throw error; });
      if (!sameSig(expected, now)) return false;
      await rename(tmp, this.path);
      renamed = true;
      await syncDir(dir);
      return true;
    } finally { if (!renamed) await unlink(tmp).catch(() => undefined); }
  }

  private async acquireLock(dir: string): Promise<() => Promise<void>> {
    const lock = join(dir, LOCK_NAME);
    const token = `${process.pid}:${randomBytes(8).toString('hex')}`;
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        const handle = await open(lock, fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL, 0o600);
        try { await handle.writeFile(token); } finally { await handle.close(); }
        return async () => {
          const held = await readFile(lock, 'utf8').catch(() => undefined);
          if (held === token) await unlink(lock).catch(() => undefined);
        };
      } catch (error) {
        if (!isCode(error, 'EEXIST')) throw error;
      }
      const staleIno = await this.lockIsStale(lock);
      if (staleIno !== undefined) { await this.breakStaleLock(lock, staleIno); continue; }
      if (Date.now() >= deadline) throw new AuthorizedKeysRefusedError('authorized_keys lock timeout');
      await sleep(LOCK_POLL_MS + Math.floor(Math.random() * LOCK_POLL_MS));
    }
  }

  /** The inode of a lock judged stale, else undefined. */
  private async lockIsStale(lock: string): Promise<number | undefined> {
    const info = await stat(lock).catch(() => undefined);
    if (!info) return undefined;
    if (Date.now() - info.mtimeMs > LOCK_STALE_MS) return info.ino;
    const pid = Number((await readFile(lock, 'utf8').catch(() => '')).split(':')[0]);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return undefined;
    try { process.kill(pid, 0); return undefined; } catch (error) { return isCode(error, 'ESRCH') ? info.ino : undefined; }
  }

  /**
   * Check-then-unlink would delete a fresh lock another process created after the stale verdict. Move the lock aside
   * atomically, then confirm it is the inode judged stale; if a live lock was taken instead, put it back.
   */
  private async breakStaleLock(lock: string, staleIno: number): Promise<void> {
    const aside = `${lock}.stale-${process.pid}-${randomBytes(6).toString('hex')}`;
    try { await rename(lock, aside); } catch { return; }
    try {
      const moved = await stat(aside).catch(() => undefined);
      if (moved && moved.ino !== staleIno) await link(aside, lock).catch(() => undefined);
    } finally { await unlink(aside).catch(() => undefined); }
  }
}

function ownedByUs(uid: number): boolean {
  const me = typeof process.getuid === 'function' ? process.getuid() : undefined;
  return me === undefined || uid === me;
}

async function syncDir(dir: string): Promise<void> {
  try { const handle = await open(dir, fsc.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } } catch { /* best effort */ }
}

/** Split keeping each line's terminator so untouched lines re-join byte-for-byte. */
function splitLines(text: string): string[] { return text === '' ? [] : text.split(/(?<=\n)/); }
function stripEol(line: string): string { return line.replace(/\r?\n$/, ''); }
function eolPart(line: string): string { return line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : ''; }
function eolOf(lines: string[]): string { return lines.map(eolPart).find(eol => eol) ?? '\n'; }
/** Ensure the last line has a terminator before appending after it. */
function terminated(lines: string[], eol: string): string[] {
  const last = lines[lines.length - 1];
  return last !== undefined && eolPart(last) === '' ? [...lines.slice(0, -1), last + eol] : lines;
}
