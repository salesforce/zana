// Every test uses a private temp directory as HOME-equivalent. The real ~/.ssh is never read or written.
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizedKeyInput } from './peer-ssh-contract.js';

const fsState = vi.hoisted(() => ({ failRename: false, freshLockOnBreak: false }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(async (...args: Parameters<typeof actual.rename>) => {
    if (fsState.failRename) throw Object.assign(new Error('boom'), { code: 'EIO' });
    if (fsState.freshLockOnBreak && String(args[0]).endsWith('.zana-ak.lock')) {
      // Another process replaces the stale lock with its own live one between the verdict and the break.
      fsState.freshLockOnBreak = false;
      await actual.writeFile(`${String(args[0])}.next`, `${process.ppid}:fresh`);
      await actual.rename(`${String(args[0])}.next`, args[0]);
    }
    return actual.rename(...args);
  }) };
});

const { AuthorizedKeysRefusedError, SshAuthorizedKeys, formatExpiryTime } = await import('./ssh-authorized-keys.js');

const key = (c: string) => `ssh-ed25519 ${c.repeat(68)}`;
const base = (over: Partial<AuthorizedKeyInput> = {}): AuthorizedKeyInput => ({
  linkId: 'link-1', kind: 'link', pub: key('A'), listenPort: 40001, targetPort: 40002, ...over });

let home: string, ssh: string, file: string;
const mk = (instanceId = 'inst-1', path = file) => new SshAuthorizedKeys({ instanceId, authorizedKeysPath: path });
const modeOf = async (p: string) => (await stat(p)).mode & 0o777;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'zcc-ak-'));
  ssh = join(home, '.ssh');
  file = join(ssh, 'authorized_keys');
  fsState.failRename = false;
});
afterEach(async () => { await rm(home, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('SshAuthorizedKeys', () => {
  it('creates ~/.ssh 0700 and authorized_keys 0600 with the restricted line', async () => {
    await mk().upsert(base());
    expect(await modeOf(ssh)).toBe(0o700);
    expect(await modeOf(file)).toBe(0o600);
    expect(await readFile(file, 'utf8')).toBe(
      `restrict,port-forwarding,permitlisten="127.0.0.1:40001",permitopen="127.0.0.1:40002",command="/usr/bin/false" ${key('A')} zana-peer-v1:inst-1:link-1:link\n`);
  });

  it('adds only the TCP-required port-forwarding token, never a stream-local policy override', async () => {
    await mk().upsert(base());
    const options = (await readFile(file, 'utf8')).split(' ')[0]!.split(',');
    // port-forwarding cannot override sshd's AllowStreamLocalForwarding no; peer-ssh-local proves that policy.
    expect(options).toEqual(['restrict', 'port-forwarding', 'permitlisten="127.0.0.1:40001"',
      'permitopen="127.0.0.1:40002"', 'command="/usr/bin/false"']);
    expect(options.filter(option => option === 'port-forwarding')).toHaveLength(1);
  });

  it('never matches or deletes a foreign line that merely ends with a zana comment', async () => {
    await mkdir(ssh, { mode: 0o700 });
    const foreign = [
      `ssh-ed25519 ${'B'.repeat(68)} zana-peer-v1:inst-1:link-1:link`,
      `command="/bin/sh" ${key('C')} zana-peer-v1:inst-1:link-1:link`,
      `restrict,port-forwarding,permitlisten="127.0.0.1:40001",permitopen="127.0.0.1:40002" ${key('D')} zana-peer-v1:inst-1:link-1:link`,
      `from="10.0.0.1",restrict,port-forwarding,permitlisten="127.0.0.1:40001",permitopen="127.0.0.1:40002",command="/usr/bin/false" ${key('E')} zana-peer-v1:inst-1:link-1:link`
    ].join('\n') + '\n';
    await writeFile(file, foreign);
    const ak = mk();
    expect(await ak.list()).toEqual([]);
    await ak.remove('link-1');
    await ak.reconcile(new Set());
    expect(await readFile(file, 'utf8')).toBe(foreign);
    await ak.upsert(base());
    expect(await ak.list()).toEqual([{ linkId: 'link-1', kind: 'link' }]);
    await ak.remove('link-1');
    expect(await readFile(file, 'utf8')).toBe(foreign);
  });

  it('defaults to $HOME/.ssh/authorized_keys', async () => {
    vi.stubEnv('HOME', home);
    await new SshAuthorizedKeys({ instanceId: 'inst-1' }).upsert(base());
    expect((await readFile(file, 'utf8'))).toContain('zana-peer-v1:inst-1:link-1:link');
  });

  it('never chmods an existing directory or leaves tmp/lock files behind', async () => {
    await mkdir(ssh, { mode: 0o755 });
    await mk().upsert(base());
    expect(await modeOf(ssh)).toBe(0o755);
    expect(await readdir(ssh)).toEqual(['authorized_keys']);
  });

  it('keeps foreign lines byte-for-byte: CRLF, odd bytes, no final newline', async () => {
    await mkdir(ssh, { mode: 0o700 });
    const foreign = '# comment\r\nssh-rsa AAAA user@host\r\n\r\nrestrict \xff\xfe weird\r\nssh-ed25519 BBBB last-no-newline';
    await writeFile(file, Buffer.from(foreign, 'latin1'));
    const ak = mk();
    await ak.upsert(base());
    const after = (await readFile(file)).toString('latin1');
    expect(after.startsWith(foreign + '\r\n')).toBe(true);
    expect(after.endsWith('zana-peer-v1:inst-1:link-1:link\r\n')).toBe(true);
    await ak.remove('link-1');
    expect((await readFile(file)).toString('latin1')).toBe(foreign + '\r\n');
  });

  it('removing the only appended line from a no-final-newline file restores nothing but the added terminator', async () => {
    await mkdir(ssh, { mode: 0o700 });
    await writeFile(file, 'ssh-rsa AAAA a');
    const ak = mk();
    await ak.upsert(base());
    await ak.remove('link-1');
    expect(await readFile(file, 'utf8')).toBe('ssh-rsa AAAA a\n');
  });

  it('is idempotent: identical upsert does not rewrite the file', async () => {
    const ak = mk();
    await ak.upsert(base());
    const before = await stat(file);
    await new Promise(r => setTimeout(r, 15));
    await ak.upsert(base());
    const after = await stat(file);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('remove/reconcile on a missing file or directory are no-ops and create nothing', async () => {
    const ak = mk();
    await ak.remove('x');
    await ak.reconcile(new Set());
    expect(await ak.list()).toEqual([]);
    await expect(stat(ssh)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('swaps bootstrap for link: upsert both, remove bootstrap only', async () => {
    const ak = mk();
    const expiresAt = Date.UTC(2030, 0, 2, 3, 4, 5);
    await ak.upsert(base({ kind: 'bootstrap', pub: key('B'), expiresAt }));
    await ak.upsert(base({ kind: 'link', pub: key('C') }));
    expect(await ak.list()).toEqual([{ linkId: 'link-1', kind: 'bootstrap' }, { linkId: 'link-1', kind: 'link' }]);
    await ak.remove('link-1', 'bootstrap');
    expect(await ak.list()).toEqual([{ linkId: 'link-1', kind: 'link' }]);
    expect(await readFile(file, 'utf8')).not.toContain(key('B'));
  });

  it('replaces a changed line in place and collapses duplicates', async () => {
    const ak = mk();
    await ak.upsert(base({ linkId: 'a' }));
    await ak.upsert(base({ linkId: 'b', pub: key('B') }));
    const dup = (await readFile(file, 'utf8')).split('\n')[0]!;
    await writeFile(file, `${dup}\n${await readFile(file, 'utf8')}`);
    await ak.upsert(base({ linkId: 'a', pub: key('D') }));
    const lines = (await readFile(file, 'utf8')).trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(key('D'));
    expect(lines[1]).toContain(key('B'));
  });

  it('formats expiry-time as UTC YYYYMMDDHHMMZ, rounded up to the minute', async () => {
    expect(formatExpiryTime(Date.UTC(2030, 0, 2, 3, 4, 0))).toBe('203001020304Z');
    expect(formatExpiryTime(Date.UTC(2030, 0, 2, 3, 4, 1))).toBe('203001020305Z');
    expect(formatExpiryTime(Date.UTC(2030, 11, 31, 23, 59, 30))).toBe('203101010000Z');
    await mk().upsert(base({ kind: 'bootstrap', expiresAt: Date.UTC(2030, 0, 2, 3, 4, 0) }));
    expect(await readFile(file, 'utf8')).toContain('command="/usr/bin/false",expiry-time="203001020304Z" ssh-ed25519');
  });

  it('only touches lines for its own instance id', async () => {
    const mine = mk('inst-1'), other = mk('inst-2');
    await mine.upsert(base({ linkId: 'one' }));
    await other.upsert(base({ linkId: 'one', pub: key('B') }));
    await mine.reconcile(new Set());
    expect(await mine.list()).toEqual([]);
    expect(await other.list()).toEqual([{ linkId: 'one', kind: 'link' }]);
    await mine.remove('one');
    expect(await other.list()).toHaveLength(1);
  });

  it('ignores comment lines and malformed lines that merely mention the marker', async () => {
    await mkdir(ssh, { mode: 0o700 });
    const text = `# restrict ${key('A')} zana-peer-v1:inst-1:x:link\nssh-ed25519 short zana-peer-v1:inst-1:y:other\n`;
    await writeFile(file, text);
    const ak = mk();
    expect(await ak.list()).toEqual([]);
    await ak.reconcile(new Set());
    expect(await readFile(file, 'utf8')).toBe(text);
  });

  it('reconcile keeps live links and drops the rest', async () => {
    const ak = mk();
    for (const id of ['a', 'b', 'c']) await ak.upsert(base({ linkId: id, pub: key(id.toUpperCase()) }));
    await ak.reconcile(new Set(['b']));
    expect(await ak.list()).toEqual([{ linkId: 'b', kind: 'link' }]);
  });

  it('survives 20 concurrent upserts, from two instances sharing the file', async () => {
    const a = mk(), b = mk('inst-1');
    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      (i % 2 ? a : b).upsert(base({ linkId: `link-${i}`, pub: key(String.fromCharCode(65 + i)) }))));
    const listed = await a.list();
    expect(listed.map(l => l.linkId).sort()).toEqual(Array.from({ length: 20 }, (_, i) => `link-${i}`).sort());
    expect(await readdir(ssh)).toEqual(['authorized_keys']);
  });

  it('retries when the file is edited externally between read and commit, and keeps the external edit', async () => {
    const ak = mk();
    await ak.upsert(base({ linkId: 'seed' }));
    const real = (ak as unknown as { commit: (...a: unknown[]) => Promise<boolean> }).commit.bind(ak);
    let first = true;
    vi.spyOn(ak as unknown as { commit: (...a: unknown[]) => Promise<boolean> }, 'commit').mockImplementation(async (...args) => {
      if (first) { first = false; await writeFile(file, `${await readFile(file, 'utf8')}ssh-rsa EXTERNAL x\n`); }
      return real(...args);
    });
    await ak.upsert(base({ linkId: 'racing', pub: key('R') }));
    const text = await readFile(file, 'utf8');
    expect(text).toContain('ssh-rsa EXTERNAL x');
    expect(text).toContain('zana-peer-v1:inst-1:racing:link');
    expect(text).toContain('zana-peer-v1:inst-1:seed:link');
  });

  it('gives up with ssh_auth_refused after 3 concurrent-change retries and leaves the file intact', async () => {
    const ak = mk();
    await ak.upsert(base({ linkId: 'seed' }));
    const original = await readFile(file, 'utf8');
    const real = (ak as unknown as { commit: (...a: unknown[]) => Promise<boolean> }).commit.bind(ak);
    let n = 0;
    vi.spyOn(ak as unknown as { commit: (...a: unknown[]) => Promise<boolean> }, 'commit').mockImplementation(async (...args) => {
      n++; await writeFile(file, `${original}# churn ${n}\n`); return real(...args);
    });
    await expect(ak.upsert(base({ linkId: 'new', pub: key('N') }))).rejects.toMatchObject({ message: 'ssh_auth_refused' });
    expect(n).toBe(3);
    expect(await readFile(file, 'utf8')).toBe(`${original}# churn 3\n`);
    expect((await readdir(ssh)).sort()).toEqual(['authorized_keys']);
  });

  it('refuses a symlinked authorized_keys and leaves the target untouched', async () => {
    await mkdir(ssh, { mode: 0o700 });
    const target = join(home, 'elsewhere');
    await writeFile(target, 'ssh-rsa AAAA t\n');
    await symlink(target, file);
    const ak = mk();
    await expect(ak.upsert(base())).rejects.toBeInstanceOf(AuthorizedKeysRefusedError);
    await expect(ak.list()).rejects.toMatchObject({ message: 'ssh_auth_refused' });
    expect(await readFile(target, 'utf8')).toBe('ssh-rsa AAAA t\n');
    expect((await readdir(ssh)).sort()).toEqual(['authorized_keys']);
  });

  it('refuses a symlinked ~/.ssh directory', async () => {
    const real = join(home, 'real-ssh');
    await mkdir(real, { mode: 0o700 });
    await symlink(real, ssh);
    await expect(mk().upsert(base())).rejects.toMatchObject({ message: 'ssh_auth_refused' });
    expect(await readdir(real)).toEqual([]);
  });

  it('refuses when ~/.ssh is not a directory, or authorized_keys is not a regular file', async () => {
    await writeFile(ssh, 'x');
    await expect(mk().upsert(base())).rejects.toMatchObject({ message: 'ssh_auth_refused' });
    await rm(ssh);
    await mkdir(file, { recursive: true });
    await expect(mk().upsert(base())).rejects.toMatchObject({ message: 'ssh_auth_refused' });
  });

  it('refuses files not owned by the current user', async () => {
    await mk().upsert(base());
    const uid = process.getuid!();
    vi.spyOn(process, 'getuid').mockReturnValue(uid + 1);
    await expect(mk().remove('link-1')).rejects.toMatchObject({ message: 'ssh_auth_refused' });
    await expect(mk().list()).rejects.toMatchObject({ message: 'ssh_auth_refused' });
  });

  it('refuses a file over 1 MiB without modifying it', async () => {
    await mkdir(ssh, { mode: 0o700 });
    const big = '#'.repeat(1024 * 1024 + 1);
    await writeFile(file, big);
    await expect(mk().upsert(base())).rejects.toMatchObject({ message: 'ssh_auth_refused' });
    expect((await stat(file)).size).toBe(big.length);
  });

  it('cleans the tmp file and keeps the original when rename fails', async () => {
    const ak = mk();
    await ak.upsert(base({ linkId: 'seed' }));
    const original = await readFile(file, 'utf8');
    fsState.failRename = true;
    await expect(ak.upsert(base({ linkId: 'x', pub: key('X') }))).rejects.toThrow('boom');
    fsState.failRename = false;
    expect(await readFile(file, 'utf8')).toBe(original);
    expect(await readdir(ssh)).toEqual(['authorized_keys']);
    await ak.upsert(base({ linkId: 'x', pub: key('X') }));
    expect(await ak.list()).toHaveLength(2);
  });

  it('breaks a stale lockfile (old mtime or dead pid) and releases its own lock', async () => {
    await mkdir(ssh, { mode: 0o700 });
    const lock = join(ssh, '.zana-ak.lock');
    await writeFile(lock, '1:old');
    const old = new Date(Date.now() - 120_000);
    await utimes(lock, old, old);
    const ak = mk();
    await ak.upsert(base());
    await writeFile(lock, '2147483646:dead');
    await ak.upsert(base({ linkId: 'two', pub: key('B') }));
    expect((await readdir(ssh)).sort()).toEqual(['authorized_keys']);
  });

  it('does not delete a live lock that replaced the one judged stale', async () => {
    await mkdir(ssh, { mode: 0o700 });
    const lock = join(ssh, '.zana-ak.lock');
    await writeFile(lock, '1:old');
    const old = new Date(Date.now() - 120_000);
    await utimes(lock, old, old);
    fsState.freshLockOnBreak = true;
    const pending = mk().upsert(base());
    await new Promise(r => setTimeout(r, 150));
    expect(await readFile(lock, 'utf8')).toBe(`${process.ppid}:fresh`);
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(lock);
    await pending;
    expect(await mk().list()).toHaveLength(1);
    expect((await readdir(ssh)).sort()).toEqual(['authorized_keys']);
  });

  it('waits for a live lock holder and proceeds once released', async () => {
    await mkdir(ssh, { mode: 0o700 });
    const lock = join(ssh, '.zana-ak.lock');
    await writeFile(lock, `${process.ppid}:held`);
    const pending = mk().upsert(base());
    await new Promise(r => setTimeout(r, 120));
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(lock);
    await pending;
    expect(await mk().list()).toHaveLength(1);
  });

  it('validates every input before touching disk', async () => {
    const ak = mk();
    const bad: Array<Partial<AuthorizedKeyInput>> = [
      { linkId: '' }, { linkId: 'a:b' }, { linkId: 'a b' }, { linkId: 'a\nb' }, { linkId: '-x' },
      { kind: 'other' as never },
      { pub: 'ssh-rsa AAAA' }, { pub: key('A') + '\n' }, { pub: `${key('A')} comment` }, { pub: `ssh-ed25519 ${'A'.repeat(67)}` },
      { listenPort: 1023 }, { listenPort: 65536 }, { targetPort: 80.5 }, { targetPort: NaN }, { listenPort: '4000' as never },
      { expiresAt: -1 }, { expiresAt: NaN }, { expiresAt: 1.5 }
    ];
    for (const over of bad) await expect(ak.upsert(base(over))).rejects.toThrow(/invalid authorized key/);
    await expect(ak.remove('a:b')).rejects.toThrow(/invalid/);
    await expect(ak.remove('ok', 'nope' as never)).rejects.toThrow(/invalid/);
    await expect(stat(ssh)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(() => new SshAuthorizedKeys({ instanceId: 'a:b' })).toThrow('invalid instance id');
  });
});
