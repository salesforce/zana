import { mkdtempSync, writeFileSync } from 'node:fs';
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
});
