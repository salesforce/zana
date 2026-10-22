import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeerSshd, type PeerSshdOptions, type PeerSshdProcess } from './peer-sshd.js';

const dirs: string[] = [];
const daemons: PeerSshd[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const d of daemons.splice(0)) d.dispose();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fresh(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-peer-sshd-'));
  dirs.push(dir);
  return join(dir, 'peer-sshd');
}

interface FakeProc extends PeerSshdProcess { exit(code: number | null, log?: string): void; killed: boolean }
function fakeProc(): FakeProc {
  let resolve!: (value: { code: number | null; log: string }) => void;
  const exited = new Promise<{ code: number | null; log: string }>(r => { resolve = r; });
  const proc: FakeProc = { pid: 4242, exited, killed: false, kill: () => { proc.killed = true; resolve({ code: null, log: '' }); }, exit: (code, log = '') => resolve({ code, log }) };
  return proc;
}

function make(directory: string, extra: Partial<PeerSshdOptions> = {}) {
  const procs: FakeProc[] = [];
  const spawnSshd = vi.fn((_args: string[]) => { const p = fakeProc(); procs.push(p); return p; });
  const sshd = new PeerSshd({
    directory, user: 'alice', spawnSshd, checkConfig: async () => null, probeBanner: async () => 'ok',
    freePort: async () => 47123, commandOf: async () => undefined, warn: () => undefined, startTimeoutMs: 300, ...extra
  });
  daemons.push(sshd);
  return { sshd, spawnSshd, procs };
}

describe('PeerSshd', () => {
  it('mints a host key, saves the port, writes a locked-down config and starts once', async () => {
    const dir = await fresh();
    const { sshd, spawnSshd } = make(dir);
    const first = await sshd.ensure();
    expect(first.port).toBe(47123);
    expect(first.hostKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/]{68}$/);
    expect(await sshd.ensure()).toEqual(first);
    expect(spawnSshd).toHaveBeenCalledTimes(1);
    expect(spawnSshd.mock.calls[0]![0]).toEqual(['-D', '-e', '-f', join(dir, 'sshd_config')]);
    const config = await readFile(join(dir, 'sshd_config'), 'utf8');
    for (const line of ['Port 47123', 'AllowStreamLocalForwarding no', 'AllowUsers alice', 'UsePAM no', 'PasswordAuthentication no',
      'PermitListen 127.0.0.1:*', 'PermitOpen 127.0.0.1:*', 'ForceCommand /usr/bin/false', `AuthorizedKeysFile ${sshd.authorizedKeysPath}`]) {
      expect(config.split('\n')).toContain(line);
    }
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, 'host_key'))).mode & 0o777).toBe(0o600);
    expect((await stat(sshd.authorizedKeysPath)).mode & 0o777).toBe(0o600);
    expect((await readFile(join(dir, 'port'), 'utf8')).trim()).toBe('47123');
  });

  it('keeps the host key and port across restarts so paired computers stay pinned', async () => {
    const dir = await fresh();
    const a = make(dir);
    const first = await a.sshd.ensure();
    a.sshd.dispose();
    const b = make(dir, { freePort: async () => 50000 });
    expect(await b.sshd.ensure()).toEqual(first);
  });

  it('replaces a remembered port another program took', async () => {
    const dir = await fresh();
    await make(dir).sshd.ensure();
    let calls = 0;
    const { sshd, procs } = make(dir, {
      freePort: async () => 50001,
      probeBanner: async () => (calls++ === 0 ? 'refused' : 'ok')
    });
    const pending = sshd.ensure();
    await vi.waitFor(() => expect(procs.length).toBe(1));
    procs[0]!.exit(255, 'Bind to port 47123 on 0.0.0.0 failed: Address already in use.\nCannot bind any address.');
    expect((await pending).port).toBe(50001);
    expect((await readFile(join(dir, 'port'), 'utf8')).trim()).toBe('50001');
  });

  it('fails as ssh_remote_login_off when sshd rejects the config or never listens', async () => {
    const warn = vi.fn();
    const rejected = make(await fresh(), { checkConfig: async () => 'bad option', warn });
    await expect(rejected.sshd.ensure()).rejects.toThrow('ssh_remote_login_off');
    expect(rejected.spawnSshd).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('bad option'));
    const silent = make(await fresh(), { probeBanner: async () => 'no-banner' });
    await expect(silent.sshd.ensure()).rejects.toThrow('ssh_remote_login_off');
    expect(silent.procs[0]!.killed).toBe(true);
  });

  it('refuses a symlinked directory', async () => {
    const dir = await fresh();
    const target = `${dir}-real`;
    dirs.push(target);
    await (await import('node:fs/promises')).mkdir(target, { mode: 0o700 });
    await symlink(target, dir);
    await expect(make(dir).sshd.ensure()).rejects.toThrow('ssh_remote_login_off');
  });

  it('kills a stale sshd only when its argv names this config', async () => {
    const dir = await fresh();
    await make(dir).sshd.ensure();
    await writeFile(join(dir, 'sshd.pid'), '777\n');
    const kill = vi.fn();
    const foreign = make(dir, { commandOf: async () => '/usr/sbin/sshd -D -f /etc/ssh/sshd_config', kill });
    await foreign.sshd.ensure();
    expect(kill).not.toHaveBeenCalled();
    foreign.sshd.dispose();
    await writeFile(join(dir, 'sshd.pid'), '778\n');
    const ours = make(dir, { commandOf: async () => `/usr/sbin/sshd -D -e -f ${join(dir, 'sshd_config')}`, kill });
    await ours.sshd.ensure();
    expect(kill).toHaveBeenCalledWith(778);
  });

  it('restarts after an unexpected exit and stops for good on dispose', async () => {
    const dir = await fresh();
    const { sshd, procs, spawnSshd } = make(dir);
    await sshd.ensure();
    vi.useFakeTimers();
    procs[0]!.exit(1, 'crash');
    await vi.advanceTimersByTimeAsync(1100);
    vi.useRealTimers();
    await vi.waitFor(() => expect(spawnSshd).toHaveBeenCalledTimes(2));
    sshd.dispose();
    expect(procs[1]!.killed).toBe(true);
    await expect(sshd.ensure()).rejects.toThrow('ssh_remote_login_off');
  });

  it('tightens a loose directory, re-mints a corrupt host key, and tolerates a stale sshd that already exited', async () => {
    const dir = await fresh();
    const first = await make(dir).sshd.ensure();
    daemons.splice(0).forEach((d) => d.dispose());
    const { chmod } = await import('node:fs/promises');
    await chmod(dir, 0o755);
    await writeFile(join(dir, 'host_key.pub'), 'not a key\n');
    await writeFile(join(dir, 'sshd.pid'), '779\n');
    const kill = vi.fn(() => { throw new Error('ESRCH'); });
    const again = make(dir, { commandOf: async () => `/usr/sbin/sshd -D -e -f ${join(dir, 'sshd_config')}`, kill });
    const second = await again.sshd.ensure();
    expect(kill).toHaveBeenCalledWith(779);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect(second.hostKey).not.toBe(first.hostKey);
    expect(second.port).toBe(first.port);
  });

  it('cleans up its temp file and fails when a write cannot be published', async () => {
    const dir = await fresh();
    const { mkdir, readdir } = await import('node:fs/promises');
    await mkdir(join(dir, 'port'), { recursive: true });
    await writeFile(join(dir, 'port', 'keep'), '');
    await expect(make(dir).sshd.ensure()).rejects.toThrow();
    expect((await readdir(dir)).filter((name) => name.includes('.zana-'))).toEqual([]);
  });

  it('stops probing once aborted', async () => {
    const abort = new AbortController();
    const probeBanner = vi.fn(async () => { abort.abort(); return 'refused' as const; });
    const { sshd, procs } = make(await fresh(), { probeBanner });
    await expect(sshd.ensure(abort.signal)).rejects.toThrow('ssh_remote_login_off');
    expect(probeBanner).toHaveBeenCalledTimes(1);
    expect(procs[0]!.killed).toBe(true);
  });

  it('a disposed daemon does not restart after its sshd exits', async () => {
    const { sshd, procs, spawnSshd } = make(await fresh());
    await sshd.ensure();
    const proc = procs[0]!;
    sshd.dispose();
    proc.exit(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(spawnSshd).toHaveBeenCalledTimes(1);
  });

  it('rejects an unsafe user name', () => {
    expect(() => new PeerSshd({ directory: '/tmp/x', user: 'bad user' })).toThrow('invalid sshd user');
  });
});
