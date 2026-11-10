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
 *   executable it forwards to, keeping the shim's literal leading arguments,
 *   and a package-manager shim (npm, pnpm, yarn: `codex.cmd`) with the
 *   `node.exe <script>` it runs (see `windows-npm-shim.ts`).
 * - {@link assertWindowsCommandLineFits} fails before spawning, with a message
 *   naming the limit, when the command line still can't fit.
 *
 * Both are identity off win32, so macOS/Linux launches are unchanged.
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { isFile, packageManagerShimLaunch, parsePackageManagerShim, type PackageManagerShim } from './windows-npm-shim.js';

/** cmd.exe's maximum command-line length. */
export const CMD_COMMAND_LINE_LIMIT = 8191;
/** CreateProcess's maximum command-line length in characters, excluding the terminating NUL. */
export const CREATE_PROCESS_COMMAND_LINE_LIMIT = 32766;
/**
 * Shims are a few hundred bytes; a pnpm shim repeats its `NODE_PATH` (three
 * store paths) twice, about 1 KB on a typical checkout. Anything larger isn't a
 * shim this module unwraps.
 */
export const SHIM_READ_CAP = 16_384;
const SHIM_CACHE_MAX = 64;

const BATCH_RE = /\.(cmd|bat)$/i;

export interface WindowsLaunch {
  command: string;
  args: string[];
  /** Environment changes the unwrapped shim would have made (pnpm's `NODE_PATH`). */
  env?: Record<string, string>;
}

export interface ShimTarget {
  command: string;
  leadingArgs: string[];
}

/** What a shim's text parsed as: a one-line forwarder or a package-manager template. */
type ParsedShim =
  | { kind: 'forward'; target: ShimTarget }
  | { kind: 'package-manager'; shim: PackageManagerShim };

interface CacheEntry {
  mtimeMs: number;
  size: number;
  parsed: ParsedShim | null;
}

const shimCache = new Map<string, CacheEntry>();

/** Test-only: forget memoised shim parses. */
export function resetWindowsShimCacheForTests(): void {
  shimCache.clear();
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

interface Token {
  value: string;
  quoted: boolean;
}

/**
 * Split the forwarding line into tokens: each either `"quoted"` or a bare run
 * without spaces or quotes. Returns null on anything else (unbalanced quotes).
 */
function tokenize(line: string): Token[] | null {
  const tokens: Token[] = [];
  let rest = line;
  while (rest.length) {
    const m = rest.match(TOKEN_RE);
    if (!m) return null;
    tokens.push(m[1] !== undefined ? { value: m[1], quoted: true } : { value: m[2]!, quoted: false });
    rest = rest.slice(m[0].length).trimStart();
  }
  return tokens;
}

/** Characters cmd.exe expands or treats as syntax outside double quotes. */
const UNSAFE_BARE_RE = /[%!^&|<>()]/;
/**
 * Inside double quotes cmd.exe takes `^&|<>()` literally (so
 * `"C:\Program Files (x86)\…"` is fine) but still expands `%` and `!`.
 */
const UNSAFE_QUOTED_RE = /[%!]/;
const DP0 = '%~dp0';

/**
 * Resolve `%~dp0` (the shim's own folder, with a trailing separator) at the
 * start of a token. Any other expansion, or cmd syntax outside quotes, makes
 * the shim non-trivial.
 */
function expandToken({ value, quoted }: Token, shimDir: string): string | null {
  const local = value.slice(0, DP0.length).toLowerCase() === DP0;
  const rest = local ? value.slice(DP0.length) : value;
  if (!rest || (quoted ? UNSAFE_QUOTED_RE : UNSAFE_BARE_RE).test(rest)) return null;
  return local ? normalize(join(shimDir, rest)) : rest;
}

/**
 * The shim's text-only parse: its target and literal args, without checking
 * that the target exists. Cached by {@link forwardingShimTarget}, which
 * re-checks the target on every lookup.
 */
function parseShimText(text: string, shimPath: string): ShimTarget | null {
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
  if (!/\.exe$/i.test(command!) || !isAbsolute(command!)) return null;
  return { command: command!, leadingArgs };
}

/**
 * Parse a trivial forwarding shim: inert lines (`@echo off`, `rem`, `::`,
 * blank) plus exactly one line `@?<exe> [<literal arg>…] %*`. The target must
 * be an absolute (or `%~dp0`-relative) existing `.exe`. Quoted tokens may not
 * contain `%` or `!`; bare tokens may not contain those or cmd syntax.
 * Anything else returns null, and the shim runs as before.
 */
export function parseForwardingShim(text: string, shimPath: string): ShimTarget | null {
  const target = parseShimText(text, shimPath);
  return target && isFile(target.command) ? target : null;
}

/**
 * Parse `shimPath`, memoised by path + mtime + size (bounded), so repeated
 * launches cost one `stat`. Shims over {@link SHIM_READ_CAP} bytes aren't
 * read. Only the text parse is cached; callers check the files it names.
 */
function parsedShim(shimPath: string): ParsedShim | null {
  let stat;
  try {
    stat = statSync(shimPath);
  } catch {
    return null;
  }
  const cached = shimCache.get(shimPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.parsed;
  let parsed: ParsedShim | null = null;
  if (stat.isFile() && stat.size <= SHIM_READ_CAP) {
    try {
      const text = readHead(shimPath, stat.size);
      const target = parseShimText(text, shimPath);
      const shim = target ? null : parsePackageManagerShim(text, dirname(shimPath));
      parsed = target ? { kind: 'forward', target } : shim ? { kind: 'package-manager', shim } : null;
    } catch {
      parsed = null;
    }
  }
  if (!cached && shimCache.size >= SHIM_CACHE_MAX) shimCache.delete(shimCache.keys().next().value!);
  shimCache.set(shimPath, { mtimeMs: stat.mtimeMs, size: stat.size, parsed });
  return parsed;
}

/**
 * The exe a trivial forwarding shim runs, memoised (see {@link parsedShim}).
 * The target's existence is checked on every call, not cached, so an exe
 * installed or removed after the first launch is seen.
 */
export function forwardingShimTarget(shimPath: string): ShimTarget | null {
  const parsed = parsedShim(shimPath);
  return parsed?.kind === 'forward' && isFile(parsed.target.command) ? parsed.target : null;
}

/**
 * On win32, swap a `.cmd`/`.bat` shim for the program it runs, so the spawn
 * skips cmd.exe (its 8191-character cap and argument re-parsing):
 * - a trivial forwarder becomes the `.exe` it forwards to;
 * - a package-manager shim becomes `node.exe <script>`, with node resolved as
 *   the shim does (its own folder's `node.exe`, else the first `node` on
 *   `env.PATH`), plus any `NODE_PATH` it sets, in `env` of the result.
 * Any other command, any shim whose files are missing, and every command off
 * win32, is returned unchanged. `env` is the launch environment.
 */
export function windowsDirectLaunch(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env
): WindowsLaunch {
  if (platform !== 'win32' || !BATCH_RE.test(command)) return { command, args };
  const parsed = parsedShim(command);
  if (parsed?.kind === 'forward') {
    const { target } = parsed;
    return isFile(target.command) ? { command: target.command, args: [...target.leadingArgs, ...args] } : { command, args };
  }
  if (parsed?.kind !== 'package-manager') return { command, args };
  return packageManagerShimLaunch(parsed.shim, args, env) ?? { command, args };
}

/**
 * Length of the command line node-pty builds for `file` + `args` on Windows
 * (its `argsToCommandLine`: MSVC argv quoting, copied from winpty), in UTF-16
 * code units, the unit of both the CreateProcess and cmd.exe limits. Indexing
 * by code unit, as node-pty does, counts a surrogate pair (an emoji) as 2.
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
    for (let j = 0; j < arg.length; j++) {
      const ch = arg[j];
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
