/**
 * Windows launch helpers for PTY spawns.
 *
 * A `.cmd`/`.bat` harness command runs through `cmd.exe`, which caps a command
 * line at 8191 characters and re-parses every argument (`%`, `^`, `&`, …). A
 * CLI Agent's argv (inbox guidance in `--append-system-prompt`, hook
 * `--settings` JSON) is well over that cap, so a PATH that puts a one-line
 * `claude.cmd` forwarder ahead of `claude.exe` made every CLI Agent exit with
 * "The command line is too long." `CreateProcess` on an `.exe` allows 32767
 * characters and passes arguments without a shell.
 *
 * - {@link windowsDirectLaunch} replaces a trivial forwarding shim with the
 *   executable it forwards to, keeping the shim's literal leading arguments.
 * - {@link assertWindowsCommandLineFits} fails before spawning, with a message
 *   naming the limit, when the command line still can't fit.
 *
 * Both are identity off win32, so macOS/Linux launches are unchanged.
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';

/** cmd.exe's maximum command-line length. */
export const CMD_COMMAND_LINE_LIMIT = 8191;
/** CreateProcess's maximum command-line length in characters, excluding the terminating NUL. */
export const CREATE_PROCESS_COMMAND_LINE_LIMIT = 32766;
/** Forwarding shims are a few hundred bytes; anything larger isn't one. */
export const SHIM_READ_CAP = 4096;
const SHIM_CACHE_MAX = 64;

const BATCH_RE = /\.(cmd|bat)$/i;

export interface WindowsLaunch {
  command: string;
  args: string[];
}

export interface ShimTarget {
  command: string;
  leadingArgs: string[];
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  target: ShimTarget | null;
}

const shimCache = new Map<string, CacheEntry>();

/** Test-only: forget memoised shim parses. */
export function resetWindowsShimCacheForTests(): void {
  shimCache.clear();
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readHead(path: string, size: number): string {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(size);
    const read = readSync(fd, buf, 0, size, 0);
    return buf.subarray(0, read).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** Lines a trivial shim may carry besides its one forwarding line. */
function isInertLine(line: string): boolean {
  return line === ''
    || /^@?echo\s+off$/i.test(line)
    || /^@?rem(\s.*)?$/i.test(line)
    || line.startsWith('::');
}

const TOKEN_RE = /^"([^"]*)"(?=\s|$)|^([^\s"]+)(?=\s|$)/;

/**
 * Split the forwarding line into tokens: each either `"quoted"` or a bare run
 * without spaces or quotes. Returns null on anything else (unbalanced quotes).
 */
function tokenize(line: string): string[] | null {
  const tokens: string[] = [];
  let rest = line;
  while (rest.length) {
    const m = rest.match(TOKEN_RE);
    if (!m) return null;
    tokens.push(m[1] ?? m[2]!);
    rest = rest.slice(m[0].length).trimStart();
  }
  return tokens;
}

/** Characters cmd.exe would expand or treat as syntax. */
const UNSAFE_TOKEN_RE = /[%!^&|<>()]/;
const DP0 = '%~dp0';

/**
 * Resolve `%~dp0` (the shim's own folder, with a trailing separator) at the
 * start of a token. Any other `%` or cmd syntax makes the shim non-trivial.
 */
function expandToken(token: string, shimDir: string): string | null {
  const local = token.slice(0, DP0.length).toLowerCase() === DP0;
  const rest = local ? token.slice(DP0.length) : token;
  if (!rest || UNSAFE_TOKEN_RE.test(rest)) return null;
  return local ? normalize(join(shimDir, rest)) : rest;
}

/**
 * Parse a trivial forwarding shim: inert lines (`@echo off`, `rem`, `::`,
 * blank) plus exactly one line `@?<exe> [<literal arg>…] %*`. The target must
 * be an absolute (or `%~dp0`-relative) existing `.exe`; literal args may not
 * contain `%`, `!` or cmd syntax. Anything else returns null, and the shim
 * runs as before.
 */
export function parseForwardingShim(text: string, shimPath: string): ShimTarget | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => !isInertLine(l));
  if (lines.length !== 1) return null;
  const line = lines[0]!.replace(/^@/, '');
  if (!/\s%\*$/.test(line)) return null;
  const tokens = tokenize(line.slice(0, -2).trimEnd());
  if (!tokens || tokens.length === 0) return null;
  const shimDir = dirname(shimPath);
  const expanded = tokens.map((t) => expandToken(t, shimDir));
  if (expanded.some((t) => t === null)) return null;
  const [command, ...leadingArgs] = expanded as string[];
  if (!/\.exe$/i.test(command!) || !isAbsolute(command!) || !isFile(command!)) return null;
  return { command: command!, leadingArgs };
}

/**
 * Parse `shimPath`, memoised by path + mtime + size (bounded), so repeated
 * launches cost one `stat`. Shims over {@link SHIM_READ_CAP} bytes aren't read.
 */
export function forwardingShimTarget(shimPath: string): ShimTarget | null {
  let stat;
  try {
    stat = statSync(shimPath);
  } catch {
    return null;
  }
  const cached = shimCache.get(shimPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.target;
  let target: ShimTarget | null = null;
  if (stat.isFile() && stat.size <= SHIM_READ_CAP) {
    try {
      target = parseForwardingShim(readHead(shimPath, stat.size), shimPath);
    } catch {
      target = null;
    }
  }
  if (!cached && shimCache.size >= SHIM_CACHE_MAX) shimCache.delete(shimCache.keys().next().value!);
  shimCache.set(shimPath, { mtimeMs: stat.mtimeMs, size: stat.size, target });
  return target;
}

/**
 * On win32, swap a trivial `.cmd`/`.bat` forwarder for the `.exe` it runs, so
 * the spawn skips cmd.exe (its 8191-character cap and argument re-parsing).
 * Any other command, and every command off win32, is returned unchanged.
 */
export function windowsDirectLaunch(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform
): WindowsLaunch {
  if (platform !== 'win32' || !BATCH_RE.test(command)) return { command, args };
  const target = forwardingShimTarget(command);
  if (!target) return { command, args };
  return { command: target.command, args: [...target.leadingArgs, ...args] };
}

/**
 * Length of the command line node-pty builds for `file` + `args` on Windows
 * (its `argsToCommandLine`: MSVC argv quoting, copied from winpty).
 */
export function windowsCommandLineLength(file: string, args: readonly string[]): number {
  let total = 0;
  const argv = [file, ...args];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (i > 0) total += 1;
    const opens = arg[0] === '"';
    const closes = arg[arg.length - 1] === '"';
    const quote = arg === '' || (/[ \t]/.test(arg) && arg.length > 1 && (opens !== closes || (!opens && !closes)));
    let bs = 0;
    for (const ch of arg) {
      if (ch === '\\') bs++;
      else if (ch === '"') { total += bs * 2 + 2; bs = 0; }
      else { total += bs + 1; bs = 0; }
    }
    total += quote ? 2 + bs * 2 : bs;
  }
  return total;
}

/**
 * Throw a clear error, before spawning, when the Windows command line can't
 * fit: 8191 characters for a `.cmd`/`.bat` (cmd.exe), 32766 for anything else
 * (CreateProcess). No-op off win32.
 */
export function assertWindowsCommandLineFits(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== 'win32') return;
  const batch = BATCH_RE.test(command);
  const limit = batch ? CMD_COMMAND_LINE_LIMIT : CREATE_PROCESS_COMMAND_LINE_LIMIT;
  const length = windowsCommandLineLength(command, args);
  if (length <= limit) return;
  const hint = batch
    ? ' It is a batch file, so it runs through cmd.exe. Set the harness binary to the program\'s .exe instead.'
    : '';
  throw new Error(
    `Cannot start ${command}: its command line is ${length} characters, over the Windows limit of ${limit}.${hint}`
  );
}
