import { stopWindowsProcessTree } from '@zana-ai/zcc-agent-process-utils';

export interface KillablePtyHandle {
  readonly pid?: number;
  kill(signal?: string): unknown;
}

/** Ends a Windows process and its descendants by parentage; injectable for tests. */
export type WindowsTreeStop = (pid: number) => void;

const DEFAULT_HARD_KILL_AFTER_MS = 2_000;

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
 * processes) outlive it. The signal-less `kill()` still runs first: it closes
 * the pseudoconsole, without which its conhost.exe stays behind. Then taskkill
 * /T /F ends the pty's own tree by parentage, from the PID read before the
 * kill (absolute System32 path, no shell). Exit 128 there means `kill()` had
 * already ended the root.
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
    try {
      handle.kill();
    } catch {
      /* process can win the exit race */
    }
    // node-pty reports 0 until the pseudoconsole has connected.
    if (pid !== undefined && pid > 0) {
      (options.stopWindowsTree ?? ((root) => stopWindowsProcessTree(root)))(pid);
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
