import { stopWindowsProcessTree } from '@zana-ai/zcc-agent-process-utils';

export interface KillablePtyHandle {
  readonly pid?: number;
  kill(signal?: string): unknown;
}

/** Ends a Windows process and its descendants by parentage; injectable for tests. */
export type WindowsTreeStop = (pid: number) => void;

const DEFAULT_HARD_KILL_AFTER_MS = 2_000;

/**
 * Windows ptys whose native kill has already run. node-pty 1.2.0-beta.15 closes
 * the pseudoconsole on every `kill()` while the pty's native record still
 * exists, and does not mark it closed (microsoft/node-pty#983). A second kill
 * frees the same pseudoconsole again and corrupts the heap (exit code
 * 0xC0000374). The record outlives the first kill until its exit watcher runs,
 * so every repeat caller (close then exit finalization, host shutdown after a
 * stop) must find the pty already released.
 *
 * Defence in depth: node-pty 1.2.0-beta.17 nulls the handle after the first
 * close, so a repeat is harmless there. Remove this set (and the matching
 * guard in `PtyManager.finalizeExit`) once beta.17 or later is the minimum
 * node-pty and the upstream fix (microsoft/node-pty#989) is in a stable release.
 */
const killedWindowsPtys = new WeakSet<object>();

/** True once {@link terminatePtyProcessTree} released this Windows pty. */
export function windowsPtyAlreadyKilled(handle: object): boolean {
  return process.platform === 'win32' && killedWindowsPtys.has(handle);
}

function processGroupAlive(pid: number): boolean {
  if (process.platform === 'win32') return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  if (process.platform === 'win32') return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Terminate a node-pty-owned process tree. node-pty makes the spawned command a
 * process-group leader on POSIX; signalling the negative pid reaches the shell,
 * the agent CLI, and TERM-resistant descendants. The handle kill is still called
 * as a fallback for platforms or PTY implementations without process groups.
 *
 * Windows has no process groups. node-pty's `kill(signal)` throws there for
 * any signal, and its signal-less `kill()` ends only what is attached to the
 * pseudoconsole, so children an agent starts detached (codex's app-server
 * processes) outlive it. taskkill /T /F (absolute System32 path, no shell)
 * ends the pty's own tree by parentage and is started first, so the root is
 * normally still alive when taskkill resolves it. taskkill runs asynchronously,
 * so this narrows the PID-reuse and already-exited window rather than closing
 * it; waiting for taskkill before releasing the pseudoconsole is not done
 * because that would hold the conhost open on a hung taskkill. The signal-less `kill()`
 * follows at once: it closes the pseudoconsole, without which its conhost.exe
 * stays behind. Exit 128 from taskkill means the root had already exited.
 */
export function terminatePtyProcessTree(
  handle: KillablePtyHandle,
  options: {
    signal?: NodeJS.Signals;
    hardKillAfterMs?: number;
    stopWindowsTree?: WindowsTreeStop;
  } = {}
): void {
  const signal = options.signal ?? 'SIGTERM';
  const hardKillAfterMs = options.hardKillAfterMs ?? DEFAULT_HARD_KILL_AFTER_MS;
  const pid = handle.pid;
  if (process.platform === 'win32') {
    // The native kill runs once per pty: a repeat would close the pseudoconsole
    // a second time (see killedWindowsPtys). taskkill is not repeated-unsafe, so
    // a repeat call still runs it and can reach descendants a first taskkill
    // missed or raced.
    const firstKill = !killedWindowsPtys.has(handle);
    killedWindowsPtys.add(handle);
    // node-pty reports 0 until the pseudoconsole has connected. taskkill walks
    // descendants by parentage, so it is started before the plain kill to
    // narrow (not remove) the window in which the root has exited and its PID
    // could be reused. The plain kill follows at once and closes the pseudoconsole.
    try {
      if (pid !== undefined && pid > 0) {
        (options.stopWindowsTree ?? ((root) => stopWindowsProcessTree(root)))(pid);
      }
    } finally {
      if (firstKill) {
        try {
          handle.kill();
        } catch {
          /* process can win the exit race */
        }
      }
    }
    return;
  }
  const signalledGroup = pid !== undefined && signalProcessGroup(pid, signal);
  try {
    handle.kill(signal);
  } catch {
    /* process can win the exit race */
  }
  if (!signalledGroup || pid === undefined || hardKillAfterMs <= 0) return;
  const timer = setTimeout(() => {
    if (processGroupAlive(pid)) signalProcessGroup(pid, 'SIGKILL');
  }, hardKillAfterMs);
  timer.unref?.();
}
