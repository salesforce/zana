/**
 * node-pty stand-in for the remote join artifact. Linux boxes (and the
 * install tarball) cannot load this laptop's native pty.node, so enrolled
 * terminals on a remote use pipes. AgentRuntime does not go through this
 * module.
 */
import { spawn as spawnChild, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface IPtyForkOptions {
  cwd?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  name?: string;
}

export interface IPty {
  pid: number;
  cols: number;
  rows: number;
  process: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
}

export function spawn(file: string, args: string[], options: IPtyForkOptions): IPty {
  const env = { ...process.env, ...(options.env ?? {}) } as NodeJS.ProcessEnv;
  if (options.name) env.TERM = options.name;
  const child: ChildProcessWithoutNullStreams = spawnChild(file, args, {
    cwd: options.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let cols = options.cols ?? 80;
  let rows = options.rows ?? 24;
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();
  const emitData = (chunk: Buffer | string) => {
    const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const listener of dataListeners) listener(data);
  };
  child.stdout.on('data', emitData);
  child.stderr.on('data', emitData);
  child.on('exit', (code) => {
    const event = { exitCode: code ?? 1 };
    for (const listener of exitListeners) listener(event);
  });
  return {
    pid: child.pid ?? 0,
    get cols() {
      return cols;
    },
    get rows() {
      return rows;
    },
    process: file,
    write(data: string) {
      child.stdin.write(data);
    },
    resize(nextCols: number, nextRows: number) {
      cols = nextCols;
      rows = nextRows;
    },
    kill(signal?: string) {
      child.kill((signal as NodeJS.Signals | undefined) ?? 'SIGTERM');
    },
    onData(listener) {
      dataListeners.add(listener);
      return { dispose() { dataListeners.delete(listener); } };
    },
    onExit(listener) {
      exitListeners.add(listener);
      return { dispose() { exitListeners.delete(listener); } };
    }
  };
}
