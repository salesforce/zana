import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { isAbsolute } from 'node:path';

/** Live children one plugin may hold at a time. */
export const PLUGIN_PROCESS_LIMIT = 8;
/** Live children across all plugins. */
export const PLUGIN_PROCESS_GLOBAL_LIMIT = 64;
/** Wait between SIGTERM and the SIGKILL sweep of a recorded group. */
export const PLUGIN_PROCESS_TERM_GRACE_MS = 1_500;
const MAX_ARGS = 256;
const MAX_ARG_BYTES = 128 * 1024;
const MAX_ENV_ENTRIES = 256;

export interface PluginProcessSpawnOptions { cwd?: string; env?: Record<string, string> }
export interface PluginProcessHandle { pid: number; exited: Promise<number | null> }

export interface PluginProcessTracker {
  spawn(command: string, args: string[], options?: PluginProcessSpawnOptions): Promise<PluginProcessHandle>;
  /** SIGTERM, bounded wait, SIGKILL every recorded live group. Later spawns are refused. Idempotent. */
  reapAll(): Promise<void>;
  readonly size: number;
}

interface Live { child: ChildProcess; pid: number; exited: Promise<number | null>; done: boolean }

const trackers = new Set<{ live: Set<Live> }>();
let exitHookInstalled = false;
let globalLive = 0;

/** Synchronous last resort when the server process itself goes away: only recorded groups, never by name. */
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const tracker of trackers) for (const record of tracker.live) if (!record.done) signalGroup(record.pid, 'SIGKILL', record.child);
  });
}

function signalGroup(pid: number, signal: NodeJS.Signals, child: ChildProcess): void {
  try {
    if (process.platform !== 'win32') process.kill(-pid, signal);
    else child.kill(signal);
  } catch { /* group already gone */ }
}

function validate(command: unknown, args: unknown, options: PluginProcessSpawnOptions | undefined): void {
  if (typeof command !== 'string' || !command || command.includes('\0')) throw new Error('process.spawn requires a command');
  if (!Array.isArray(args) || args.length > MAX_ARGS || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new Error('process.spawn args must be an array of at most 256 strings');
  }
  if (args.reduce((sum, arg) => sum + Buffer.byteLength(arg), 0) > MAX_ARG_BYTES) throw new Error('process.spawn args exceed the size limit');
  if (options?.cwd !== undefined && (typeof options.cwd !== 'string' || !isAbsolute(options.cwd) || options.cwd.includes('\0'))) {
    throw new Error('process.spawn cwd must be an absolute path');
  }
  if (options?.env !== undefined) {
    const entries = options.env && typeof options.env === 'object' ? Object.entries(options.env) : null;
    if (!entries || entries.length > MAX_ENV_ENTRIES
      || entries.some(([key, value]) => !key || key.includes('=') || key.includes('\0') || typeof value !== 'string' || value.includes('\0'))) {
      throw new Error('process.spawn env must be a record of strings');
    }
  }
}

export function createPluginProcessTracker(options: {
  pluginId: string;
  log?: (level: 'warn' | 'error', message: string) => void;
  maxProcesses?: number;
  graceMs?: number;
  spawnFn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
}): PluginProcessTracker {
  const max = options.maxProcesses ?? PLUGIN_PROCESS_LIMIT;
  const graceMs = options.graceMs ?? PLUGIN_PROCESS_TERM_GRACE_MS;
  const spawnFn = options.spawnFn ?? nodeSpawn;
  const live = new Set<Live>();
  const registration = { live };
  let closed = false;
  let reaping: Promise<void> | undefined;
  installExitHook();
  trackers.add(registration);

  const release = (record: Live) => {
    if (record.done) return;
    record.done = true;
    if (live.delete(record)) globalLive--;
  };

  return {
    get size() { return live.size; },
    async spawn(command, args, spawnOptions) {
      if (closed) throw new Error(`plugin context is stale: ${options.pluginId}`);
      validate(command, args, spawnOptions);
      if (live.size >= max) throw new Error(`plugin process limit reached (${max})`);
      if (globalLive >= PLUGIN_PROCESS_GLOBAL_LIMIT) throw new Error('host plugin process limit reached');
      // Output is discarded, not piped: Electron main can truncate piped child stdout, and a plugin that needs
      // output captures it itself (for example by redirecting to its own 0600 file).
      const child = spawnFn(command, args, {
        cwd: spawnOptions?.cwd,
        env: { ...process.env, ...spawnOptions?.env },
        shell: false,
        // A new process group lets reaping reach grandchildren; Windows has no groups, so only the child is killed there.
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: 'ignore'
      });
      const record: Live = { child, pid: 0, done: false, exited: undefined as unknown as Promise<number | null> };
      record.exited = new Promise<number | null>(resolve => {
        child.once('close', code => { release(record); resolve(code); });
        child.once('error', () => { release(record); resolve(null); });
      });
      void record.exited.catch(() => {});
      return await new Promise<PluginProcessHandle>((resolve, reject) => {
        child.once('error', error => reject(error));
        child.once('spawn', () => {
          if (typeof child.pid !== 'number') return reject(new Error('process.spawn did not yield a pid'));
          record.pid = child.pid;
          live.add(record); globalLive++;
          // The reap may have started while the spawn event was pending.
          if (closed) { signalGroup(record.pid, 'SIGKILL', child); }
          child.unref();
          resolve({ pid: child.pid, exited: record.exited });
        });
      });
    },
    reapAll() {
      closed = true;
      reaping ??= (async () => {
        const records = [...live];
        for (const record of records) signalGroup(record.pid, 'SIGTERM', record.child);
        if (records.length) {
          let timer: NodeJS.Timeout | undefined;
          await Promise.race([
            Promise.all(records.map(record => record.exited)),
            new Promise<void>(resolve => { timer = setTimeout(resolve, graceMs); timer.unref?.(); })
          ]);
          if (timer) clearTimeout(timer);
          // Sweep the whole group even if its leader exited, so a grandchild that ignored SIGTERM does not survive.
          for (const record of records) {
            if (!record.done) options.log?.('warn', `process ${record.pid} ignored SIGTERM; killing`);
            signalGroup(record.pid, 'SIGKILL', record.child);
            release(record);
          }
        }
        trackers.delete(registration);
      })();
      return reaping;
    }
  };
}
