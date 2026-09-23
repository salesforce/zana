/**
 * Runs OpenCode's own CLI ON A REMOTE HOST over ssh, so the transcript
 * adapter can discover a session id and read {@link SessionStats} for a
 * `scope: 'remote'` worker — whose `opencode.db` lives on the remote box, NOT
 * the owner's local filesystem. Without this hop the local reader silently
 * reads the wrong machine and every remote worker reports zero tokens / a
 * `gap: 'missing'` usage sample.
 *
 * WHY ssh + `opencode export` (not a reverse sqlite read): the remote db is
 * only reachable through the same ssh path the interactive spawn already uses
 * (see `PtyManager.createRemote`), and `opencode export <id>` returns ONE
 * session's bounded JSON — far cheaper than streaming the whole WAL-mode db
 * back. We run it under a LOGIN shell (`bash -lc`) so the remote user's PATH
 * resolves `opencode`, mirroring the interactive `ssh -t` login the spawn uses.
 *
 * Every call is bounded (timeout + maxBuffer, Rule 5), non-interactive
 * (`BatchMode=yes`, no tty, never prompts), and NEVER throws — a remote failure
 * degrades to `null`, exactly like the local readers' contract.
 */

import { execFile } from 'node:child_process';
import type { SessionStats } from '@zana-ai/zcc-domain/product';
import type { RemoteTranscriptTarget } from '../session-adapter.js';
import { buildSessionStatsOpenCodeExport } from './transcript-reader.js';

const REMOTE_TIMEOUT_MS = 12_000;
const REMOTE_MAX_BUFFER = 16 * 1024 * 1024;

/** OpenCode mints `ses_<hex>`; refuse anything else before it reaches an argv. */
const OPENCODE_SESSION_ID_RE = /^ses_[A-Za-z0-9]+$/;

interface RemoteSessionListRow {
  id: string;
  created: number;
  directory: string;
}

/** POSIX single-quote a value so it survives ONE remote-shell parse unharmed. */
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the ssh argv for a login-shell `opencode <args>` run against `target`,
 * optionally `cd`-ing into `cwd` first. Returns null when the target is unsafe
 * (missing host, or a flag-shaped host/user/proxyJump that ssh would read as an
 * option — the same guard `createRemote` enforces at spawn).
 */
export function buildRemoteOpencodeSshArgs(
  target: RemoteTranscriptTarget,
  opencodeArgs: string[],
  opts: { binary?: string; cwd?: string } = {}
): string[] | null {
  if (!target.host || target.host.startsWith('-')) return null;
  if (target.user && target.user.startsWith('-')) return null;
  if (target.proxyJump && target.proxyJump.startsWith('-')) return null;
  const sshTarget = target.user ? `${target.user}@${target.host}` : target.host;
  const jumpOpts = target.proxyJump ? ['-J', target.proxyJump] : [];
  const binary = opts.binary || 'opencode';
  const remoteParts = [binary, ...opencodeArgs].map(shSingleQuote);
  const remoteCmd = opts.cwd
    ? `cd ${shSingleQuote(opts.cwd)} && ${remoteParts.join(' ')}`
    : remoteParts.join(' ');
  return [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    ...jumpOpts,
    sshTarget,
    'bash', '-lc', remoteCmd
  ];
}

/** Run an ssh argv, resolving stdout on success or null on any failure. */
function runSsh(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'ssh',
      args,
      { timeout: REMOTE_TIMEOUT_MS, maxBuffer: REMOTE_MAX_BUFFER },
      (error, stdout) => resolve(error ? null : stdout)
    );
  });
}

/**
 * `opencode session list --format json -n <limit>` over ssh, scoped to `cwd`
 * on the remote host. Returns parsed rows, or null on any failure.
 */
export async function listRemoteOpenCodeSessions(
  target: RemoteTranscriptTarget,
  cwd: string,
  limit: number,
  opts: { binary?: string } = {}
): Promise<RemoteSessionListRow[] | null> {
  const args = buildRemoteOpencodeSshArgs(
    target,
    ['session', 'list', '--format', 'json', '-n', String(limit)],
    { binary: opts.binary, cwd }
  );
  if (!args) return null;
  const stdout = await runSsh(args);
  if (stdout === null) return null;
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? (parsed as RemoteSessionListRow[]) : null;
  } catch {
    return null;
  }
}

/**
 * `opencode export <sessionId>` over ssh, parsed into {@link SessionStats} with
 * the SAME pure builder the local export path uses. Returns null on any
 * failure or a malformed / out-of-shape session id.
 */
export async function readSessionStatsOpenCodeRemote(
  target: RemoteTranscriptTarget,
  sessionId: string,
  opts: { binary?: string; cwd?: string } = {}
): Promise<SessionStats | null> {
  if (!OPENCODE_SESSION_ID_RE.test(sessionId)) return null;
  const args = buildRemoteOpencodeSshArgs(target, ['export', sessionId], { binary: opts.binary });
  if (!args) return null;
  const stdout = await runSsh(args);
  if (stdout === null) return null;
  try {
    return buildSessionStatsOpenCodeExport(JSON.parse(stdout), opts.cwd);
  } catch {
    return null;
  }
}
