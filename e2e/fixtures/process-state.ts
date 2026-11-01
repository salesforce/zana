import { readFileSync } from 'node:fs';

export interface FixtureProcessState {
  pid: number;
  running: boolean;
  state: string;
  parentPid?: number;
  command?: string;
}

/** An unreaped Linux zombie has a PID, but cannot execute or receive signals. */
export function fixtureProcessState(pid: number, deps: {
  platform?: NodeJS.Platform;
  signal?: (pid: number) => void;
  readStat?: (path: string) => string;
} = {}): FixtureProcessState {
  try {
    (deps.signal ?? (value => process.kill(value, 0)))(pid);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return { pid, running: false, state: 'missing' };
    // A permission error (or any other signal failure) cannot prove termination.
    return { pid, running: true, state: 'unknown' };
  }
  if ((deps.platform ?? process.platform) === 'linux') {
    try {
      const stat = (deps.readStat ?? (path => readFileSync(path, 'utf8')))(`/proc/${pid}/stat`);
      const prefix = `${pid} (`;
      const end = stat.lastIndexOf(')');
      const [state, parent] = stat.slice(end + 1).trim().split(/\s+/);
      if (!stat.startsWith(prefix) || end < prefix.length || state?.length !== 1
        || !/^\d+$/.test(parent ?? '') || !Number.isSafeInteger(Number(parent))) throw new Error('Invalid process stat');
      return { pid, running: state !== 'Z' && state !== 'X', state, parentPid: Number(parent), command: stat.slice(prefix.length, end) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { pid, running: false, state: 'missing' };
    }
  }
  return { pid, running: true, state: 'unknown' };
}
