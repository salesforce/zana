import { execFile as execFileCb } from 'node:child_process';
import type { ExecResult, PrMonitorContext } from './context.js';

const MAX_BUFFER = 8_000_000;
const DEFAULT_TIMEOUT_MS = 30_000;

function execCode(error: Error | null): number {
  if (!error) return 0;
  const raw = (error as NodeJS.ErrnoException).code;
  if (raw === 'ENOENT') return 127;
  if (typeof raw === 'number') return raw;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') return status;
  return 1;
}

/** In-process `gh` runner. Plugins are full-trust; tests inject a fake instead. */
export function createGhExec(): PrMonitorContext['exec'] {
  return ({ bin, args, timeoutMs }) =>
    new Promise((resolve, reject) => {
      if (bin !== 'gh') {
        reject(new Error('pr-monitor only executes gh'));
        return;
      }
      execFileCb(
        'gh',
        args,
        {
          timeout: timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER,
          windowsHide: true
        },
        (error, stdout, stderr) => {
          resolve({
            code: execCode(error),
            stdout: stdout ?? '',
            stderr: stderr ?? ''
          });
        }
      );
    });
}

export function isGhBin(bin: string): boolean {
  return bin === 'gh';
}
