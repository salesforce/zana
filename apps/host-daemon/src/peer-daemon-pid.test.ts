import { describe, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, access, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { retireDuplicateHostServiceLines, safeStopStandaloneDaemonLines } from './peer-daemon.js';
const run = promisify(execFile);
describe('remote repair PID identity', () => {
  it('uses the same identity guard in the standalone installer', async () => {
    const installer = (await readFile(new URL('../../server/src/assets/install-machine.sh', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
    expect(installer).toContain(safeStopStandaloneDaemonLines().join('\n'));
    expect(installer).toContain(retireDuplicateHostServiceLines().join('\n'));
    expect(installer).toContain('Environment=ZCC_HOST_SERVICE_MANAGED=1');
    expect(installer.indexOf('[ -f "$package_dir/join.mjs" ]')).toBeLessThan(installer.indexOf('[ -f "$package_dir/join.cjs" ]'));
  });
  it('does not signal an unrelated live process from a stale PID file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-pid-'));
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    await new Promise<void>(resolve => child.once('spawn', resolve));
    try {
      await writeFile(join(dir, 'host-daemon.pid'), String(child.pid));
      await run('/bin/sh', ['-c', safeStopStandaloneDaemonLines().join('\n')], { env: { ...process.env, data_dir: dir, package_dir: join(dir, 'runtime'), join_bin: join(dir, 'runtime/join.mjs') } });
      expect(() => process.kill(child.pid!, 0)).not.toThrow();
      await expect(access(join(dir, 'host-daemon.pid'))).rejects.toThrow();
    } finally { child.kill(); await new Promise(resolve => child.once('exit', resolve)); await rm(dir, { recursive: true, force: true }); }
  });
  it.each(['-1', '0', '1', '42;touch bad'])('rejects unsafe PID %s', async pid => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-pid-'));
    try {
      await writeFile(join(dir, 'host-daemon.pid'), pid);
      const script = 'kill() { echo unsafe-signal; };\n' + safeStopStandaloneDaemonLines().join('\n');
      const result = await run('/bin/sh', ['-c', script], { env: { ...process.env, data_dir: dir, package_dir: join(dir, 'runtime'), join_bin: join(dir, 'runtime/join.mjs') } });
      expect(result.stdout).toBe('');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  describe('old daemons', () => {
    const HOST = 'dd727df2-6d9a-43be-9af3-342abe864245';
    const fakeDaemon = async (dataDir: string, hostId: string) => {
      await mkdir(join(dataDir, 'runtime'), { recursive: true });
      const entry = join(dataDir, 'runtime/join.mjs');
      await writeFile(entry, 'setInterval(() => {}, 1000);');
      const child = spawn(process.execPath, [entry, 'join', '--host-id', hostId, '--auto-update'], { stdio: 'ignore' });
      await new Promise<void>(resolve => child.once('spawn', resolve));
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
      return { child, exited, alive: () => child.exitCode === null && child.signalCode === null };
    };
    const stop = (dataDir: string, hostId: string) => run('/bin/sh', ['-c', safeStopStandaloneDaemonLines().join('\n')], {
      env: { ...process.env, data_dir: dataDir, package_dir: join(dataDir, 'runtime'), join_bin: join(dataDir, 'runtime/join.mjs'), host_id: hostId }
    });

    it('stops this runtime without a PID file, whichever Node started it', async () => {
      const root = await mkdtemp(join(tmpdir(), 'zcc-old-'));
      const daemon = await fakeDaemon(join(root, 'ssh-host'), HOST);
      try {
        await stop(join(root, 'ssh-host'), 'another-host-id');
        await daemon.exited;
        expect(daemon.alive()).toBe(false);
      } finally { daemon.child.kill('SIGKILL'); await rm(root, { recursive: true, force: true }); }
    });

    it('stops the same host id installed for another server address and spares other machines', async () => {
      const root = await mkdtemp(join(tmpdir(), 'zcc-old-'));
      const duplicate = await fakeDaemon(join(root, 'relay.example.com'), HOST);
      const other = await fakeDaemon(join(root, 'ssh-other'), '028c8627-a6d8-4c62-964e-8f6b35cb2335');
      try {
        await stop(join(root, 'ssh-host'), HOST);
        await duplicate.exited;
        expect(duplicate.alive()).toBe(false);
        expect(other.alive()).toBe(true);
      } finally {
        duplicate.child.kill('SIGKILL'); other.child.kill('SIGKILL');
        await other.exited;
        await rm(root, { recursive: true, force: true });
      }
    });

    it.each([['Linux', '.config/systemd/user', 'zcc-host-daemon-', '.service'], ['Darwin', 'Library/LaunchAgents', 'ai.zana.zcc-host-daemon.', '.plist']])(
      'retires a %s service that runs this host id for another server address', async (os, unitPath, prefix, suffix) => {
        const home = await mkdtemp(join(tmpdir(), 'zcc-units-'));
        const units = join(home, unitPath);
        await mkdir(units, { recursive: true });
        const ours = join(home, '.zcc-machines/ssh-host/runtime');
        const unit = (dir: string, hostId: string) => os === 'Linux'
          ? `ExecStart=/usr/bin/node ${dir}/join.mjs join --host-id ${hostId} --server-url x --auto-update\n`
          : `<string>${dir}/join.mjs</string>\n<string>--host-id</string><string>${hostId}</string>\n`;
        await writeFile(join(units, `${prefix}relay.example.com${suffix}`), unit(join(home, '.zcc-machines/relay.example.com/runtime'), HOST));
        await writeFile(join(units, `${prefix}ssh-host${suffix}`), unit(ours, HOST));
        await writeFile(join(units, `${prefix}ssh-other${suffix}`), unit(join(home, '.zcc-machines/ssh-other/runtime'), 'other-host'));
        try {
          const stubs = `uname() { echo ${os}; }\nsystemctl() { echo "systemctl $*"; }\nlaunchctl() { echo "launchctl $*"; }\n`;
          const result = await run('/bin/sh', ['-c', stubs + retireDuplicateHostServiceLines().join('\n')], {
            env: { ...process.env, HOME: home, host_id: HOST, package_dir: ours }
          });
          expect((await readdir(units)).sort()).toEqual([
            `${prefix}relay.example.com${suffix}.retired`, `${prefix}ssh-host${suffix}`, `${prefix}ssh-other${suffix}`
          ].sort());
          expect(result.stdout).toContain(os === 'Linux'
            ? `systemctl --user disable --now ${prefix}relay.example.com${suffix}`
            : `launchctl bootout gui/${process.getuid?.()}/${prefix}relay.example.com`);
          expect(result.stdout).toContain('it ran this machine for another server address');
          expect(result.stdout).not.toContain('ssh-other');
        } finally { await rm(home, { recursive: true, force: true }); }
      });

    it('retires nothing without a host id or matching services', async () => {
      const home = await mkdtemp(join(tmpdir(), 'zcc-units-'));
      try {
        for (const os of ['Linux', 'Darwin']) {
          const result = await run('/bin/sh', ['-c', `uname() { echo ${os}; }\nsystemctl() { echo called; }\nlaunchctl() { echo called; }\n` + retireDuplicateHostServiceLines().join('\n')], {
            env: { ...process.env, HOME: home, host_id: '', package_dir: join(home, 'runtime') }
          });
          expect(result.stdout).toBe('');
        }
      } finally { await rm(home, { recursive: true, force: true }); }
    });
  });
});
