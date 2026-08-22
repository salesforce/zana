import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DAEMON_LOCK_FILE_NAME = 'daemon.lock';

export class DaemonLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DaemonLockError';
  }
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireDaemonLock(dataDir: string): () => void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const lockPath = join(dataDir, DAEMON_LOCK_FILE_NAME);
  try {
    const existing = readFileSync(lockPath, 'utf8').trim();
    const pid = Number(existing);
    if (Number.isInteger(pid) && pid > 0 && pidIsAlive(pid)) {
      throw new DaemonLockError(`another host-daemon holds ${lockPath} (pid ${pid})`);
    }
    unlinkSync(lockPath);
  } catch (error) {
    if (error instanceof DaemonLockError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  try {
    writeFileSync(lockPath, `${process.pid}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new DaemonLockError(`another host-daemon holds ${lockPath}`);
    }
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      unlinkSync(lockPath);
    } catch {
      /* already gone */
    }
  };
}
