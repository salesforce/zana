import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Callback = (error: Error | null, stdout: string, stderr: string) => void;
const cp = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  children: [] as Array<EventEmitter & { pid?: number; kill: ReturnType<typeof vi.fn>; stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> } }>
}));
vi.mock('node:child_process', () => ({ spawn: cp.spawn, execFile: cp.execFile }));

import { PeerSshd } from './peer-sshd.js';

const dirs: string[] = [];
const daemons: PeerSshd[] = [];
let ps: (args: string[]) => { error: Error | null; stdout: string };
let check: { error: Error | null; stderr: string };

function child(pid: number | undefined) {
  const c = Object.assign(new EventEmitter(), { pid, kill: vi.fn(), stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }) });
  cp.children.push(c);
  return c;
}

beforeEach(() => {
  cp.children.length = 0;
  ps = () => ({ error: null, stdout: '' });
  check = { error: null, stderr: '' };
  cp.spawn.mockReset().mockImplementation(() => child(9999));
  cp.execFile.mockReset().mockImplementation((bin: string, args: string[], _opts: unknown, cb: Callback) => {
    if (bin === '/bin/ps') { const r = ps(args); cb(r.error, r.stdout, ''); }
    else cb(check.error, '', check.stderr);
  });
});
afterEach(async () => {
  for (const d of daemons.splice(0)) d.dispose();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fresh(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-peer-sshd-defaults-'));
  dirs.push(dir);
  return join(dir, 'peer-sshd');
}

function make(directory: string, probeBanner: () => Promise<'ok' | 'refused'> = async () => 'ok', warn = vi.fn()) {
  const sshd = new PeerSshd({ directory, user: 'alice', probeBanner, warn, startTimeoutMs: 300 });
  daemons.push(sshd);
  return { sshd, warn };
}

describe('PeerSshd default process helpers', () => {
  it('checks the config with sshd -t, spawns sshd detached on a free port, and kills its process group', async () => {
    const { sshd } = make(await fresh());
    const endpoint = await sshd.ensure();
    expect(endpoint.port).toBeGreaterThan(0);
    expect(cp.execFile).toHaveBeenCalledWith('/usr/sbin/sshd', ['-t', '-f', expect.stringContaining('sshd_config')], expect.anything(), expect.any(Function));
    expect(cp.spawn).toHaveBeenCalledWith('/usr/sbin/sshd', ['-D', '-e', '-f', expect.stringContaining('sshd_config')], expect.objectContaining({ shell: false, detached: true }));
    const killGroup = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      sshd.dispose();
      expect(killGroup).toHaveBeenCalledWith(-9999, 'SIGKILL');
      expect(cp.children[0]!.kill).not.toHaveBeenCalled();
    } finally { killGroup.mockRestore(); }
  });

  it('falls back to killing the child when its group is gone or it has no pid', async () => {
    const { sshd } = make(await fresh());
    await sshd.ensure();
    const killGroup = vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH'); });
    try { sshd.dispose(); } finally { killGroup.mockRestore(); }
    expect(cp.children[0]!.kill).toHaveBeenCalledWith('SIGKILL');
    cp.spawn.mockImplementation(() => child(undefined));
    const other = make(await fresh());
    await other.sshd.ensure();
    other.sshd.dispose();
    expect(cp.children[1]!.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('reports a rejected config with sshd stderr, or the error when stderr is empty', async () => {
    check = { error: new Error('exit 255'), stderr: 'Bad configuration option' };
    const first = make(await fresh());
    await expect(first.sshd.ensure()).rejects.toThrow('ssh_remote_login_off');
    expect(first.warn).toHaveBeenCalledWith('peer sshd: config rejected: Bad configuration option');
    check = { error: new Error('spawn ENOENT'), stderr: '' };
    const second = make(await fresh());
    await expect(second.sshd.ensure()).rejects.toThrow('ssh_remote_login_off');
    expect(second.warn).toHaveBeenCalledWith('peer sshd: config rejected: spawn ENOENT');
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('keeps a capped stderr log and surfaces a spawn error when sshd never listens', async () => {
    cp.spawn.mockImplementation(() => {
      const c = child(9999);
      queueMicrotask(() => { c.stderr.emit('data', 'sshd: fatal'); c.emit('error', new Error('EACCES')); });
      return c;
    });
    const { sshd, warn } = make(await fresh(), async () => 'refused');
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    try { await expect(sshd.ensure()).rejects.toThrow('ssh_remote_login_off'); }
    finally { vi.mocked(process.kill).mockRestore(); }
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('sshd: fatal'));
  });

  it('a close with stderr becomes the exit log', async () => {
    cp.spawn.mockImplementation(() => {
      const c = child(9999);
      queueMicrotask(() => { c.stderr.emit('data', 'Cannot bind any address.'); c.emit('close', 255); });
      return c;
    });
    const { sshd } = make(await fresh(), async () => 'refused');
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    try { await expect(sshd.ensure()).rejects.toThrow('ssh_remote_login_off'); }
    finally { vi.mocked(process.kill).mockRestore(); }
    // Port in use: one retry on a fresh port, then give up.
    expect(cp.spawn).toHaveBeenCalledTimes(2);
  });

  it('reads a stale pid argv with ps and leaves a process it cannot identify', async () => {
    const dir = await fresh();
    await make(dir).sshd.ensure();
    daemons.splice(0).forEach((d) => d.dispose());
    await writeFile(join(dir, 'sshd.pid'), '4321\n');
    ps = () => ({ error: null, stdout: '  \n' });
    await make(dir).sshd.ensure();
    expect(cp.execFile).toHaveBeenCalledWith('/bin/ps', ['-p', '4321', '-o', 'command='], expect.anything(), expect.any(Function));
    daemons.splice(0).forEach((d) => d.dispose());
    await writeFile(join(dir, 'sshd.pid'), '4322\n');
    ps = () => ({ error: new Error('no such process'), stdout: '' });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      await make(dir).sshd.ensure();
      expect(kill).not.toHaveBeenCalledWith(4322, 'SIGTERM');
    } finally { kill.mockRestore(); }
  });
});
