import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Subset of Electron's `app` that the breadcrumbs listen to; injectable for tests. */
export interface BreadcrumbApp {
  on(event: string, listener: (...args: any[]) => void): unknown;
}

export interface BreadcrumbOptions {
  app: BreadcrumbApp;
  /** Directory that receives `crash-breadcrumbs.log` (the runtime logs directory). */
  logsDir: string;
  /** Electron's `process.getSystemMemoryInfo()` (KB), or undefined off Electron. */
  systemMemory?: () => { total: number; free: number; swapTotal?: number; swapFree?: number } | undefined;
  now?: () => number;
  processRef?: Pick<NodeJS.Process, 'on' | 'pid' | 'memoryUsage'>;
  sampleEveryMs?: number;
  /** A sample is written when this fraction of RAM or less is free, or once a minute. */
  lowFreeFraction?: number;
  setInterval?: (fn: () => void, ms: number) => { unref?: () => void };
}

const MAX_BYTES = 1024 * 1024;

/**
 * Last-gasp trail for a silent exit. Every line is appended synchronously
 * because the process may be gone a millisecond later; the runtime log is
 * async and loses exactly the lines that matter. Never throws.
 */
export function installCrashBreadcrumbs(options: BreadcrumbOptions): { file: string; write: (line: string) => void } {
  const file = join(options.logsDir, 'crash-breadcrumbs.log');
  const now = options.now ?? Date.now;
  const proc = options.processRef ?? process;
  const write = (line: string): void => {
    try {
      mkdirSync(options.logsDir, { recursive: true });
      try {
        if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
      } catch { /* No file yet. */ }
      appendFileSync(file, `${new Date(now()).toISOString()} ${proc.pid} ${line}\n`);
    } catch { /* A breadcrumb must never take the app down. */ }
  };

  write('breadcrumbs installed');
  proc.on('exit', (code: number) => write(`process exit code=${code}`));
  for (const event of ['before-quit', 'will-quit', 'window-all-closed']) {
    options.app.on(event, () => write(`app ${event}`));
  }
  options.app.on('quit', (_event: unknown, exitCode: number) => write(`app quit exitCode=${exitCode}`));
  options.app.on('render-process-gone', (_event: unknown, _contents: unknown, details: { reason?: string; exitCode?: number }) =>
    write(`render-process-gone reason=${details?.reason} exitCode=${details?.exitCode}`));
  options.app.on('child-process-gone', (_event: unknown, details: { type?: string; reason?: string; exitCode?: number; name?: string; serviceName?: string }) =>
    write(`child-process-gone type=${details?.type} reason=${details?.reason} exitCode=${details?.exitCode} name=${details?.name ?? details?.serviceName ?? '-'}`));

  const every = options.sampleEveryMs ?? 10_000;
  const low = options.lowFreeFraction ?? 0.15;
  let lastWritten = Number.NEGATIVE_INFINITY;
  const sample = (): void => {
    const info = options.systemMemory?.();
    if (!info || info.total <= 0) return;
    const freeFraction = info.free / info.total;
    const t = now();
    if (freeFraction > low && t - lastWritten < 60_000) return;
    lastWritten = t;
    const swap = info.swapTotal !== undefined && info.swapFree !== undefined
      ? ` swapFreeMB=${Math.round(info.swapFree / 1024)} swapTotalMB=${Math.round(info.swapTotal / 1024)}`
      : '';
    write(`memory freeMB=${Math.round(info.free / 1024)} totalMB=${Math.round(info.total / 1024)} rssMB=${Math.round(proc.memoryUsage().rss / 1048576)}${swap}`);
  };
  const timer = (options.setInterval ?? setInterval)(sample, every) as { unref?: () => void };
  timer.unref?.();
  sample();
  return { file, write };
}
