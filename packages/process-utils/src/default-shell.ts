import { accessSync, constants, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { posix } from 'node:path';

/** Shells tried, in order, after `SHELL` and the login shell. */
export const DEFAULT_SHELL_FALLBACKS: readonly string[] = ['/bin/bash', '/bin/sh'];

/** Value used when no shell exists at all, so a config still loads. */
export const LAST_RESORT_SHELL = '/bin/sh';

export interface ShellProbe {
  env?: NodeJS.ProcessEnv;
  /** The user's login shell from the passwd database. */
  loginShell?: () => string | null | undefined;
  isExecutable?: (path: string) => boolean;
}

export class NoShellFoundError extends Error {
  constructor(readonly tried: readonly string[]) {
    super(
      `No usable shell found. Tried ${tried.length ? tried.join(', ') : 'nothing'}. ` +
        'Set SHELL to an installed shell, or set the terminal shell in Settings.'
    );
    this.name = 'NoShellFoundError';
  }
}

function passwdShell(): string | null {
  try {
    return userInfo().shell;
  } catch {
    // No passwd entry for this uid (common in containers).
    return null;
  }
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The first POSIX shell that exists: `SHELL` if executable, then the user's
 * login shell (`os.userInfo().shell`), then `/bin/bash`, then `/bin/sh`.
 * Relative candidates are skipped. On macOS this keeps zsh, through `SHELL` or
 * the login shell. Throws {@link NoShellFoundError} when none exists.
 */
export function resolveDefaultShell(probe: ShellProbe = {}): string {
  const env = probe.env ?? process.env;
  const executable = probe.isExecutable ?? isExecutableFile;
  const candidates = [env.SHELL, (probe.loginShell ?? passwdShell)(), ...DEFAULT_SHELL_FALLBACKS];
  const tried: string[] = [];
  for (const raw of candidates) {
    const candidate = raw?.trim();
    if (!candidate || tried.includes(candidate)) continue;
    tried.push(candidate);
    if (posix.isAbsolute(candidate) && executable(candidate)) return candidate;
  }
  throw new NoShellFoundError(tried);
}

export interface DefaultShellSettingOptions extends ShellProbe {
  platform?: NodeJS.Platform;
  /** The value Windows used before this lookup existed; returned unchanged on win32. */
  windows: string;
  /** Receives the not-found message; defaults to `console.error`. */
  warn?: (message: string) => void;
}

/**
 * The `shell` setting to use when none is saved. Windows keeps its previous
 * value. Elsewhere it is {@link resolveDefaultShell}; when no shell exists the
 * error is logged and {@link LAST_RESORT_SHELL} returned, so config loading
 * never throws.
 */
export function defaultShellSetting(options: DefaultShellSettingOptions): string {
  if ((options.platform ?? process.platform) === 'win32') return options.windows;
  try {
    return resolveDefaultShell(options);
  } catch (error) {
    (options.warn ?? console.error)(`[shell] ${(error as Error).message}`);
    return LAST_RESORT_SHELL;
  }
}
