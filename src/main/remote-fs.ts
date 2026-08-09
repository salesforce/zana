import { execFile, spawn } from 'node:child_process';
import { posix } from 'node:path';
import type {
  FsEntry,
  FsMutateResult,
  FsReadResult,
  FsWriteResult,
  ProjectRemote,
  RemoteExecResult,
  RemoteRootResult
} from '../shared/types.js';

/**
 * File browsing + editing over SSH for remote-backed Projects.
 *
 * This is the Explorer's remote twin of `fs.ts`. Where `fs.ts` calls Node's
 * `fs` against local paths, every function here shells out to `ssh` (the same
 * transport `pty.ts` uses for remote terminals) and runs a small, fixed remote
 * command, parsing its stdout. We deliberately do NOT pull in an `ssh2`/sftp
 * dependency: the existing app already relies on the system `ssh` + the user's
 * `~/.ssh/config` (that's how `createRemote` works), so reusing it keeps auth,
 * host-key, and ProxyCommand behaviour identical and adds no native module.
 *
 * Trust model (CLAUDE.md #1/#2): callers in `index.ts` resolve the `remote`
 * config from the STORE by projectId and pass it here — the renderer never
 * supplies host/user. Every path argument is confined under the resolved
 * remote root (`confineRemote`) before it reaches the remote command, so a
 * buggy/compromised renderer can't touch anything outside the project subtree.
 *
 * Portability: the remote commands stick to POSIX sh + coreutils that are
 * present on both Linux and BSD/macOS remotes. In
 * particular the directory listing uses a `for`-loop + `test` rather than GNU
 * `find -printf`, which doesn't exist on BSD `find`.
 */

// Bounds on the ssh round-trip. `SSH_CONNECT_TIMEOUT_S` caps ssh's TCP connect
// AND banner exchange; `SSH_TIMEOUT_MS` is the `execFile`/spawn ceiling on the
// whole round-trip (connect + remote command + stdout). A proxied, cold remote
// host can take longer than a direct server just to return its SSH banner, while
// the interactive terminal path (pty.ts) sets no ConnectTimeout. Give the
// connect generous tolerance and keep the round-trip ceiling strictly above it
// so `execFile` never SIGKILLs a connect that ssh would otherwise resolve.
const SSH_CONNECT_TIMEOUT_S = 25;
const SSH_TIMEOUT_MS = (SSH_CONNECT_TIMEOUT_S + 5) * 1000;
const MAX_ENTRIES = 2000;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // mirror fs.ts's cap
// Bound the listing/read stdout so a pathological remote dir or device file
// can't balloon main's memory. Generous vs. the file cap to leave room for the
// listing's per-line overhead.
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;

const DENY = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.DS_Store']);

/**
 * Build the base `ssh` argv shared by every remote op. We multiplex over a
 * per-host control socket (`ControlMaster=auto` + `ControlPersist`) so the
 * first call pays the handshake and subsequent tree-expansion calls reuse the
 * live connection — expanding a deep tree otherwise means one full SSH
 * handshake per folder. `BatchMode=yes` makes a missing key / expired auth fail
 * fast and headless instead of blocking on a password prompt (the
 * GUI-has-no-tty hazard documented in ssh-config.ts).
 */
export function sshBaseArgs(remote: ProjectRemote): string[] {
  // Defense in depth: the store already rejects leading-dash host/user, but
  // re-check so a hand-edited projects.json can't smuggle `-oProxyCommand=` into
  // ssh's argv as a flag.
  if (remote.host.startsWith('-')) throw new Error(`refusing ssh host starting with '-': ${remote.host}`);
  if (remote.user && remote.user.startsWith('-')) throw new Error(`refusing ssh user starting with '-': ${remote.user}`);
  if (remote.proxyJump && remote.proxyJump.startsWith('-')) {
    throw new Error(`refusing ssh proxyJump starting with '-': ${remote.proxyJump}`);
  }
  const target = remote.user ? `${remote.user}@${remote.host}` : remote.host;
  // Bastion / jump host: `-J <spec>` so every remote-fs op traverses the same
  // hop as the interactive spawn (createRemote). Spliced before the target,
  // guarded above against a flag-shaped value.
  const jumpOpts = remote.proxyJump ? ['-J', remote.proxyJump] : [];
  return [
    '-o', 'BatchMode=yes',
    '-o', 'ControlMaster=auto',
    '-o', `ControlPath=~/.ssh/zcc-cm-%C`,
    '-o', 'ControlPersist=60',
    '-o', `ConnectTimeout=${SSH_CONNECT_TIMEOUT_S}`,
    ...jumpOpts,
    target
  ];
}

/**
 * Run a single command on the remote, returning its stdout. The command is one
 * already-quoted shell string (built by the caller from quoted components); we
 * hand it to ssh as a single argv element so the remote sshd runs it via the
 * login shell. Never rejects for a non-zero remote exit — resolves
 * `{ ok: false, message }` so callers can surface a clean error.
 */
function runRemote(
  remote: ProjectRemote,
  remoteCmd: string
): Promise<{ ok: true; stdout: Buffer } | { ok: false; message: string }> {
  const args = [...sshBaseArgs(remote), remoteCmd];
  return new Promise((resolve) => {
    execFile(
      'ssh',
      args,
      { timeout: SSH_TIMEOUT_MS, maxBuffer: MAX_STDOUT_BYTES, encoding: 'buffer' },
      (err, stdout) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean };
          const message = e.killed
            ? 'Remote host timed out'
            : e.message || 'ssh command failed';
          resolve({ ok: false, message });
          return;
        }
        resolve({ ok: true, stdout: stdout as unknown as Buffer });
      }
    );
  });
}

/**
 * Run a remote command that needs data piped to its stdin (file writes). Unlike
 * `runRemote` (execFile, no stdin), this spawns ssh so we can stream the file
 * body to the remote `cat`. Resolves `{ ok: true, stdout, stderr, code }` even
 * on a non-zero remote exit — our write/mutate commands carry explicit sentinel
 * strings in stdout, so callers classify on those rather than the exit code.
 * Only a spawn failure or timeout yields `{ ok: false }`.
 */
function runRemoteInput(
  remote: ProjectRemote,
  remoteCmd: string,
  input?: Buffer,
  timeoutMs: number = SSH_TIMEOUT_MS
): Promise<{ ok: true; stdout: string; stderr: string; code: number | null } | { ok: false; message: string }> {
  const args = [...sshBaseArgs(remote), remoteCmd];
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: { ok: true; stdout: string; stderr: string; code: number | null } | { ok: false; message: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const proc = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const errOut: Buffer[] = [];
    let outLen = 0;
    let errLen = 0;
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      done({ ok: false, message: 'Remote host timed out' });
    }, timeoutMs);
    proc.stdout.on('data', (d: Buffer) => {
      outLen += d.length;
      if (outLen <= MAX_STDOUT_BYTES) out.push(d);
    });
    // Bound stderr the same way as stdout — a command (via `execRemote`) can spew
    // an unbounded error stream, and an uncapped accumulator would balloon main's
    // memory (CLAUDE.md #5). Excess bytes are still drained (the handler keeps
    // firing), just not retained.
    proc.stderr.on('data', (d: Buffer) => {
      errLen += d.length;
      if (errLen <= MAX_STDOUT_BYTES) errOut.push(d);
    });
    proc.on('error', (err) => done({ ok: false, message: err.message }));
    proc.on('close', (code) =>
      done({
        ok: true,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(errOut).toString('utf8'),
        code
      })
    );
    // Writing to a killed/closed stdin throws EPIPE; swallow it — the close
    // handler (or timeout) already drives the result.
    proc.stdin.on('error', () => {});
    proc.stdin.end(input ?? Buffer.alloc(0));
  });
}

/** POSIX single-quote a string for safe interpolation into a remote command. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}


/**
 * Confine `target` under the already-resolved remote `root`, returning a
 * normalized absolute remote path. Unlike the local `confine()` we can't
 * realpath the remote cheaply per call, so this is a *lexical* guard: normalize
 * with posix semantics (collapsing `..`) and require the result to stay at or
 * under `root`. The remote commands never follow `..`, and writes go through a
 * confined, normalized path, so a path escape can neither read nor mutate
 * outside the project subtree. Returns null when the path escapes.
 */
export function confineRemote(root: string, target: string): string | null {
  const normRoot = posix.normalize(root).replace(/\/+$/, '') || '/';
  // Resolve target against root when relative; normalize either way.
  const abs = posix.normalize(target.startsWith('/') ? target : posix.join(normRoot, target));
  const stripped = abs.replace(/\/+$/, '') || '/';
  if (stripped !== normRoot && !stripped.startsWith(normRoot + '/')) return null;
  return stripped;
}

/**
 * Resolve the remote browse root: the realpath of the project's start path.
 * Precedence: per-project `remote.remotePath` → the global `defaultPath`
 * fallback (from `AppConfig.remoteDefaultPath`) → the remote `$HOME`.
 * Realpath'ing once here gives the Explorer a stable absolute anchor and
 * defeats a symlinked start path. Keeping this in lockstep with the terminal's
 * `cd` prefix in `buildRemoteCmd` means Explorer and terminal open the same dir.
 */
export async function remoteRoot(
  remote: ProjectRemote,
  defaultPath?: string
): Promise<RemoteRootResult> {
  // `${start:-$HOME}` lets the remote shell pick $HOME when no override is set.
  // We pass the override (if any) as a quoted positional so it can't be
  // re-parsed as part of the command.
  const startPath = remote.remotePath || defaultPath;
  const startExpr = startPath ? shellQuote(startPath) : '"$HOME"';
  // `cd` first so a relative override resolves against $HOME, then print the
  // physical (symlink-resolved) working dir.
  const cmd = `cd ${startExpr} 2>/dev/null && pwd -P`;
  const res = await runRemote(remote, cmd);
  if (!res.ok) return { ok: false, message: res.message };
  const root = res.stdout.toString('utf8').trim();
  if (!root || !root.startsWith('/')) {
    return { ok: false, message: 'Remote start path not found' };
  }
  return { ok: true, root };
}

/**
 * List one remote directory. `root` is the resolved remote root (trust anchor);
 * `absPath` is the directory to list, confined under it.
 *
 * Portable listing: we `cd` into the dir and iterate its entries with a POSIX
 * `for` loop, emitting `<type>\t<name>\0` per entry (type FIRST so a name
 * containing a tab can't confuse parsing; NUL-delimited so names with newlines
 * are safe). `test -d` / `-f` follow symlinks, so a link is classified by its
 * target — a broken link satisfies neither and is silently skipped, matching
 * the local `listDir` (which `continue`s on stat failure). This avoids GNU
 * `find -printf`, absent on BSD/macOS. Returns [] on any error.
 */
export async function listDirRemote(remote: ProjectRemote, root: string, absPath: string): Promise<FsEntry[]> {
  const dir = confineRemote(root, absPath);
  if (!dir) return [];
  // `for e in * .*` covers visible + hidden entries. Unmatched globs stay
  // literal in POSIX sh (no nullglob), so the `[ -e ] || [ -L ]` guard drops a
  // literal `*`/`.*` when the dir has no matching entries. `.`/`..` are skipped.
  const cmd =
    `cd ${shellQuote(dir)} 2>/dev/null || exit 0; ` +
    `for e in * .*; do ` +
    `[ "$e" = . ] && continue; [ "$e" = .. ] && continue; ` +
    `{ [ -e "$e" ] || [ -L "$e" ]; } || continue; ` +
    `if [ -d "$e" ]; then printf 'd\\t%s\\0' "$e"; ` +
    `elif [ -f "$e" ]; then printf 'f\\t%s\\0' "$e"; fi; ` +
    `done`;
  const res = await runRemote(remote, cmd);
  if (!res.ok) return [];
  const raw = res.stdout.toString('utf8');
  const out: FsEntry[] = [];
  for (const record of raw.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const type = record.slice(0, tab);
    const name = record.slice(tab + 1);
    if (!name || name === '.' || name === '..') continue;
    if (DENY.has(name)) continue;
    let kind: 'file' | 'dir';
    if (type === 'd') kind = 'dir';
    else if (type === 'f') kind = 'file';
    else continue;
    out.push({ name, kind, path: posix.join(dir, name) });
    if (out.length >= MAX_ENTRIES) break;
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

/**
 * Read a remote file's contents (capped at 2 MB, like local `readFile`). We
 * stat the size with `wc -c` and stream the capped prefix with `head -c` in one
 * round-trip via a compound command, then apply the same NUL-byte binary
 * heuristic locally. The byte count comes first on its own line so we can split
 * it off the content.
 */
export async function readFileRemote(remote: ProjectRemote, root: string, absPath: string): Promise<FsReadResult> {
  const file = confineRemote(root, absPath);
  if (!file) return { ok: false, message: 'Path is outside the project' };
  const q = shellQuote(file);
  // Refuse non-regular files up front; then print "<size>\n" followed by the
  // capped bytes. `cat` of a missing/dir path exits non-zero → handled below.
  const cmd =
    `test -f ${q} || { echo "__ZCC_NOTFILE__"; exit 0; }; ` +
    `wc -c < ${q}; head -c ${MAX_FILE_BYTES} ${q}`;
  const res = await runRemote(remote, cmd);
  if (!res.ok) return { ok: false, message: res.message };

  const buf = res.stdout;
  // Detect the not-a-file sentinel (it's the entire stdout when triggered).
  if (buf.toString('utf8', 0, Math.min(buf.length, 32)).startsWith('__ZCC_NOTFILE__')) {
    return { ok: false, message: 'Not a file' };
  }
  // Split off the first line (the byte count) from the content payload.
  const nl = buf.indexOf(0x0a);
  if (nl < 0) return { ok: false, message: 'Unexpected remote response' };
  const fullBytes = parseInt(buf.toString('utf8', 0, nl).trim(), 10);
  const content = buf.subarray(nl + 1);

  // NUL byte in first 8 KB ⇒ binary (same heuristic as fs.ts).
  const probe = content.subarray(0, Math.min(8192, content.length));
  if (probe.includes(0)) {
    return { ok: true, binary: true, bytes: Number.isFinite(fullBytes) ? fullBytes : content.length };
  }
  const bytes = Number.isFinite(fullBytes) ? fullBytes : content.length;
  return {
    ok: true,
    content: content.toString('utf8'),
    bytes,
    truncated: bytes > MAX_FILE_BYTES,
    binary: false
  };
}

// --- Mutations (Phase 2) ----------------------------------------------------
//
// Each command prints a single sentinel token on stdout so we can classify the
// outcome without depending on the remote utility's exit-code conventions:
//   OK       success
//   EXISTS   refused: target already exists (create / rename)
//   NOSRC    refused: rename source no longer exists
//   NOTFILE  refused: write target isn't a regular file
//   ERR      the operation ran but failed (perms, disk, …) — stderr carried back
// Anything else (e.g. empty stdout from an ssh auth failure) is treated as a
// generic failure with stderr as the message.

/** Map a non-OK sentinel / failed run to a clean FsMutateResult message. */
function mutateError(stdout: string, stderr: string): FsMutateResult {
  const tok = stdout.trim();
  if (tok === 'EXISTS') return { ok: false, message: 'A file or folder with that name already exists' };
  if (tok === 'NOSRC') return { ok: false, message: 'Source no longer exists' };
  if (tok === 'NOTFILE') return { ok: false, message: 'Not a regular file' };
  const detail = stderr.trim();
  return { ok: false, message: detail || 'Remote operation failed' };
}

/**
 * Write content to an existing remote regular file. Mirrors local `writeFile`:
 * refuses anything that isn't already a regular file (the editor only saves
 * files it read first) and caps at 2 MB. The body is streamed to the remote via
 * stdin and written to a sibling temp file, then atomically `mv`'d over the
 * target — so a dropped connection mid-write truncates the temp, never the real
 * file (a real hazard over a network link).
 */
export async function writeFileRemote(
  remote: ProjectRemote,
  root: string,
  absPath: string,
  content: string
): Promise<FsWriteResult> {
  const file = confineRemote(root, absPath);
  if (!file) return { ok: false, message: 'Path is outside the project' };
  const buf = Buffer.from(content, 'utf8');
  if (buf.byteLength > MAX_FILE_BYTES) {
    return { ok: false, message: `File too large (${buf.byteLength} > ${MAX_FILE_BYTES})` };
  }
  const q = shellQuote(file);
  // f=<path>; require regular file; cat stdin → "$f.zcc-tmp.$$" → mv over $f.
  const cmd =
    `f=${q}; test -f "$f" || { printf NOTFILE; exit 0; }; ` +
    `t="$f.zcc-tmp.$$"; ` +
    `cat > "$t" && mv "$t" "$f" && printf OK || { rm -f "$t"; printf ERR; }`;
  const res = await runRemoteInput(remote, cmd, buf);
  if (!res.ok) return { ok: false, message: res.message };
  if (res.stdout.trim() === 'OK') return { ok: true, bytes: buf.byteLength };
  const e = mutateError(res.stdout, res.stderr);
  return { ok: false, message: e.message };
}

/** Create an empty remote file. Refuses to overwrite an existing path; creates missing parents. */
export async function createFileRemote(remote: ProjectRemote, root: string, absPath: string): Promise<FsMutateResult> {
  const file = confineRemote(root, absPath);
  if (!file) return { ok: false, message: 'Path is outside the project' };
  const q = shellQuote(file);
  const cmd =
    `f=${q}; [ -e "$f" ] && { printf EXISTS; exit 0; }; ` +
    `mkdir -p "$(dirname "$f")" && : > "$f" && printf OK || printf ERR`;
  const res = await runRemoteInput(remote, cmd);
  if (!res.ok) return { ok: false, message: res.message };
  if (res.stdout.trim() === 'OK') return { ok: true, path: file };
  return mutateError(res.stdout, res.stderr);
}

/** Create a remote directory (and any missing parents). Refuses if the path already exists. */
export async function createDirRemote(remote: ProjectRemote, root: string, absPath: string): Promise<FsMutateResult> {
  const dir = confineRemote(root, absPath);
  if (!dir) return { ok: false, message: 'Path is outside the project' };
  const q = shellQuote(dir);
  const cmd =
    `d=${q}; [ -e "$d" ] && { printf EXISTS; exit 0; }; ` +
    `mkdir -p "$d" && printf OK || printf ERR`;
  const res = await runRemoteInput(remote, cmd);
  if (!res.ok) return { ok: false, message: res.message };
  if (res.stdout.trim() === 'OK') return { ok: true, path: dir };
  return mutateError(res.stdout, res.stderr);
}

/** Rename / move a remote path. Both ends are confined; refuses to clobber an existing target. */
export async function renameRemote(
  remote: ProjectRemote,
  root: string,
  fromPath: string,
  toPath: string
): Promise<FsMutateResult> {
  const from = confineRemote(root, fromPath);
  if (!from) return { ok: false, message: 'Source path is outside the project' };
  const to = confineRemote(root, toPath);
  if (!to) return { ok: false, message: 'Destination path is outside the project' };
  const qf = shellQuote(from);
  const qt = shellQuote(to);
  const cmd =
    `s=${qf}; t=${qt}; ` +
    `{ [ -e "$s" ] || [ -L "$s" ]; } || { printf NOSRC; exit 0; }; ` +
    `[ -e "$t" ] && { printf EXISTS; exit 0; }; ` +
    `mkdir -p "$(dirname "$t")" && mv "$s" "$t" && printf OK || printf ERR`;
  const res = await runRemoteInput(remote, cmd);
  if (!res.ok) return { ok: false, message: res.message };
  if (res.stdout.trim() === 'OK') return { ok: true, path: to };
  return mutateError(res.stdout, res.stderr);
}

/** Permanently delete a remote file or directory (recursive). Refuses to delete the project root. */
export async function deleteRemote(remote: ProjectRemote, root: string, absPath: string): Promise<FsMutateResult> {
  const target = confineRemote(root, absPath);
  if (!target) return { ok: false, message: 'Path is outside the project' };
  const normRoot = posix.normalize(root).replace(/\/+$/, '') || '/';
  if (target === normRoot) return { ok: false, message: 'Refusing to delete the project root' };
  const q = shellQuote(target);
  const cmd =
    `p=${q}; { [ -e "$p" ] || [ -L "$p" ]; } || { printf NOSRC; exit 0; }; ` +
    `rm -rf "$p" && printf OK || printf ERR`;
  const res = await runRemoteInput(remote, cmd);
  if (!res.ok) return { ok: false, message: res.message };
  const tok = res.stdout.trim();
  if (tok === 'OK') return { ok: true, path: target };
  if (tok === 'NOSRC') return { ok: false, message: 'Path no longer exists' };
  return mutateError(res.stdout, res.stderr);
}

// --- Command execution (remote_exec) ----------------------------------------

/** Default ceiling for a single remote command — generous vs. the fs ops' 12s. */
export const REMOTE_EXEC_DEFAULT_TIMEOUT_MS = 120_000;
/** Hard upper bound the caller can request. Keeps a hung command from pinning a slot forever. */
export const REMOTE_EXEC_MAX_TIMEOUT_MS = 600_000;
/** Each captured stream is clipped to this; `truncated` flags when it hit the cap. */
const REMOTE_EXEC_MAX_STREAM_BYTES = 1024 * 1024; // 1 MB per stream

/**
 * Run an arbitrary one-shot shell command on the remote, inside the project's
 * confined root. This is the command-execution twin of the file ops above —
 * same ssh transport (`sshBaseArgs` + ControlMaster), same "resolve the remote
 * from the store, never the agent" trust model (the caller passes an already
 * store-resolved `remote` + realpath'd `root`; the agent only supplies the
 * command text and an optional cwd subpath).
 *
 * Confinement: the command runs as `cd <cwd, confined under root> && <command>`.
 * `cwd` defaults to the project root. Note this is CWD confinement, not a jail —
 * the command string is handed to the remote login shell verbatim (so pipes,
 * `&&`, redirection all work), and a determined command could still `cd`
 * elsewhere. That's the same "a shell is a shell" posture as launching a remote
 * agent; the value here is that the STARTING point and the resolved host/creds
 * are host-authorized, and the tool is not blanket pre-approved (first use
 * prompts) so a human blesses the capability.
 *
 * Never rejects: a transport failure / timeout resolves `{ ok:false, message }`;
 * a command that ran resolves `{ ok:true, code, stdout, stderr }` regardless of
 * exit status, so the caller can report a non-zero exit as data rather than an
 * error.
 */
export async function execRemote(
  remote: ProjectRemote,
  root: string,
  command: string,
  opts?: { cwd?: string; timeoutMs?: number }
): Promise<RemoteExecResult> {
  const cwdAbs = confineRemote(root, opts?.cwd ?? root);
  if (!cwdAbs) return { ok: false, message: 'cwd is outside the project' };
  const trimmed = command.trim();
  if (!trimmed) return { ok: false, message: 'Empty command' };
  // A NUL byte can't survive as a C-string argv element (ssh would truncate the
  // remote command there), so reject it up front rather than run a silently
  // clipped command. Newlines are fine — the remote login shell handles them.
  if (command.includes('\0')) return { ok: false, message: 'Command contains a NUL byte' };
  const timeoutMs = Math.min(
    Math.max(opts?.timeoutMs ?? REMOTE_EXEC_DEFAULT_TIMEOUT_MS, 1_000),
    REMOTE_EXEC_MAX_TIMEOUT_MS
  );
  // `cd` into the confined start dir, then run the agent's command verbatim.
  // The whole thing is one shell string ssh hands to the remote login shell. The
  // `cd ... || { … exit 127; }` guard turns a vanished/permission-denied start
  // dir into a clean, distinct result instead of running the command in $HOME.
  // The sentinel is a STATIC single-quoted string — never the (agent-influenced)
  // cwd — so nothing can be re-evaluated by the remote shell on the error path.
  const remoteCmd =
    `cd ${shellQuote(cwdAbs)} 2>/dev/null || ` +
    `{ echo 'zcc: working directory not found or inaccessible' >&2; exit 127; }; ` +
    trimmed;
  const res = await runRemoteInput(remote, remoteCmd, undefined, timeoutMs);
  if (!res.ok) return { ok: false, message: res.message };
  const clip = (s: string): { text: string; truncated: boolean } => {
    const buf = Buffer.from(s, 'utf8');
    if (buf.byteLength <= REMOTE_EXEC_MAX_STREAM_BYTES) return { text: s, truncated: false };
    return { text: buf.subarray(0, REMOTE_EXEC_MAX_STREAM_BYTES).toString('utf8'), truncated: true };
  };
  const out = clip(res.stdout);
  const err = clip(res.stderr);
  return {
    ok: true,
    code: res.code,
    stdout: out.text,
    stderr: err.text,
    truncated: out.truncated || err.truncated
  };
}

/**
 * Dependencies for {@link resolveAndExecRemote}. Injected so the resolution +
 * gating chain can be exercised without a real store or ssh (rule 1: the store
 * lookup is the trust boundary, so it's worth testing on its own).
 */
export interface RemoteExecResolveDeps {
  /** Resolve a projectId to its `ProjectRemote`, or null if it isn't a remote project. Store-backed in production. */
  findRemote: (projectId: string) => ProjectRemote | null;
  /** The global fallback remote start path (`AppConfig.remoteDefaultPath`). */
  defaultPath?: string;
  /** Resolve (realpath) the remote root for a `ProjectRemote`. `remoteRoot` in production. */
  resolveRoot: (remote: ProjectRemote, defaultPath?: string) => Promise<RemoteRootResult>;
  /** Run the command on the resolved remote+root. `execRemote` in production. */
  exec: (
    remote: ProjectRemote,
    root: string,
    command: string,
    opts?: { cwd?: string; timeoutMs?: number }
  ) => Promise<RemoteExecResult>;
}

/**
 * The full `remote_exec` resolution chain, factored out of index.ts so it's
 * unit-testable: resolve the projectId to a store-authorized `ProjectRemote`
 * (rule 1 — the agent's id is a *reference*, never host/creds), reject a
 * non-remote / unknown id, resolve the realpath'd remote root (rule 2 — the
 * confinement anchor), then execute. Every failure resolves a clean
 * `{ ok:false, message }`; it never throws.
 */
export async function resolveAndExecRemote(
  deps: RemoteExecResolveDeps,
  projectId: string,
  command: string,
  opts?: { cwd?: string; timeoutMs?: number }
): Promise<RemoteExecResult> {
  const remote = deps.findRemote(projectId);
  if (!remote) return { ok: false, message: 'Not a remote project' };
  const rootRes = await deps.resolveRoot(remote, deps.defaultPath);
  if (!rootRes.ok || !rootRes.root) {
    return { ok: false, message: rootRes.message || 'Remote host unreachable or start path missing' };
  }
  return deps.exec(remote, rootRes.root, command, opts);
}
