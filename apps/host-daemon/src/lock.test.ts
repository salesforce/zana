import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireDaemonLock, DaemonLockError } from './lock.js';

describe('daemon.lock', () => {
  it('prevents a second process from locking the same data dir', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-daemon-lock-'));
    const release = acquireDaemonLock(dataDir);
    expect(() => acquireDaemonLock(dataDir)).toThrow(DaemonLockError);
    release();
    const second = acquireDaemonLock(dataDir);
    second();
  });

  it('replaces a stale lock from a dead pid', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-daemon-stale-'));
    writeFileSync(join(dataDir, 'daemon.lock'), '999999999\n', { mode: 0o600 });
    const release = acquireDaemonLock(dataDir);
    release();
  });

  it('steals a live lock so the desktop daemon can own this machine', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-daemon-steal-'));
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore'
    });
    if (!child.pid) throw new Error('holder pid missing');
    writeFileSync(join(dataDir, 'daemon.lock'), `${child.pid}\n`, { mode: 0o600 });
    expect(() => acquireDaemonLock(dataDir)).toThrow(DaemonLockError);
    const release = acquireDaemonLock(dataDir, { steal: true });
    expect(() => acquireDaemonLock(dataDir)).toThrow(DaemonLockError);
    child.kill('SIGKILL');
    release();
  });

  it('desktop enroll steals the lock; join/enroll-entry do not', () => {
    const utility = readFileSync(new URL('./utility-entry.ts', import.meta.url), 'utf8');
    const enrollEntry = readFileSync(new URL('./enroll-entry.ts', import.meta.url), 'utf8');
    const joinCli = readFileSync(new URL('./join-cli.ts', import.meta.url), 'utf8');
    expect(utility).toContain('stealLock: true');
    expect(utility).toContain("type === 'relaunch'");
    expect(enrollEntry).not.toContain('stealLock');
    expect(joinCli).not.toContain('stealLock');
  });
});
