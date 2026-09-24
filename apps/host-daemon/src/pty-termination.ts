export interface KillablePtyHandle {
  readonly pid?: number;
  kill(signal?: string): unknown;
}

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
 */
export function terminatePtyProcessTree(
  handle: KillablePtyHandle,
  options: {
    signal?: NodeJS.Signals;
    hardKillAfterMs?: number;
  } = {}
): void {
  const signal = options.signal ?? 'SIGTERM';
  const hardKillAfterMs = options.hardKillAfterMs ?? DEFAULT_HARD_KILL_AFTER_MS;
  const pid = handle.pid;
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
