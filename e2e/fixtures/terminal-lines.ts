/**
 * Helpers for terminal specs that drive bash and read the PTY backlog.
 */
import { existsSync } from 'node:fs';

/**
 * The specs drive bash. On Windows they use Git Bash: `ZCC_E2E_BASH`, else
 * the default Git for Windows install path.
 */
export const WINDOWS_BASH = process.env.ZCC_E2E_BASH ?? 'C:/Program Files/Git/bin/bash.exe';
export const windowsBash = process.platform === 'win32' && existsSync(WINDOWS_BASH);
/** Initial config that points new terminals at Git Bash on Windows (empty elsewhere). */
export const windowsBashConfig: Record<string, string> = windowsBash ? { shell: WINDOWS_BASH } : {};
export const windowsBashSkipReason = `the spec drives bash; set ZCC_E2E_BASH to Git Bash (not found at ${WINDOWS_BASH})`;

/**
 * The backlog as plain lines: ANSI/OSC sequences and carriage returns removed.
 * Windows ConPTY repaints lines with cursor and erase codes and pads them with
 * spaces, so matching a raw `MARKER\r\n` is not reliable there.
 */
export function plainLines(raw: string): string[] {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd());
}

/** True once a whole output line equals `marker`. */
export const hasLine = (raw: string, marker: string) => plainLines(raw).includes(marker);
