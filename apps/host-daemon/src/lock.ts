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

function readLockPid(lockPath: string): number | null {
  try {
    const pid = Number(readFileSync(lockPath, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function waitUntilDead(pid: number, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidIsAlive(pid)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return !pidIsAlive(pid);
}

function lockHeldMessage(lockPath: string, pid?: number): string {
  const pidBit = pid != null ? ` (pid ${pid})` : '';
  return (
    `another host-daemon holds ${lockPath}${pidBit}. ` +
    'Quit that app, or run `pnpm dev` without overriding ZCC_DATA_DIR (defaults to ~/.zcc-dev).'
  );
}

function unlinkIfOwner(lockPath: string, pid: number): void {
  try {
    if (readLockPid(lockPath) === pid) unlinkSync(lockPath);
  } catch {
    /* already gone or stolen */
  }
}

/**
 * Exclusive lock for one enrolled host-daemon per data dir. A stale lock
 * (dead pid) is replaced. `steal: true` is for the desktop co-started daemon:
 * it must take over ~/.zcc even if a leftover `enroll-entry` from `pnpm start`
 * still holds the file, otherwise this machine stays Offline in the app that
 * the user is actually looking at.
 */
export function acquireDaemonLock(dataDir: string, options?: { steal?: boolean }): () => void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const lockPath = join(dataDir, DAEMON_LOCK_FILE_NAME);
  const existingPid = readLockPid(lockPath);
  if (existingPid !== null && pidIsAlive(existingPid)) {
    if (existingPid === process.pid || !options?.steal) {
      throw new DaemonLockError(lockHeldMessage(lockPath, existingPid));
    }
    signalPid(existingPid, 'SIGTERM');
    if (!waitUntilDead(existingPid, 1_500)) signalPid(existingPid, 'SIGKILL');
    waitUntilDead(existingPid, 300);
  }
  unlinkIfOwner(lockPath, existingPid ?? -1);
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  try {
    writeFileSync(lockPath, `${process.pid}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new DaemonLockError(lockHeldMessage(lockPath));
    }
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    unlinkIfOwner(lockPath, process.pid);
  };
}
