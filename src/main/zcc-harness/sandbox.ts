/**
 * OS-level shell containment for local command execution — the "best of
 * both worlds" layer that adopts Grok's kernel-sandbox moat on top of the
 * existing confirm gate (Warp's model) and app-level path confinement.
 *
 * WHY THIS EXISTS
 * ---------------
 * `Bash` is the one capable tool whose blast radius app-level `confineToProject`
 * cannot bound: an arbitrary shell string can name any path, spawn children, and
 * reach the network. The confirm gate makes a human approve the exact command,
 * but approval is a judgement call — a subtly-malicious or mistaken command that
 * a human waves through would previously run with the FULL privileges of the
 * Electron main process (write anywhere, exfiltrate anywhere).
 *
 * This module closes that gap on macOS by running the approved command under
 * Apple's Seatbelt (`sandbox-exec`), kernel-enforced and irreversible for the
 * child, exactly as Grok uses Seatbelt/Landlock:
 *   · file WRITES are confined to the canonical workspace root (+ the standard
 *     temp/devices dirs a build legitimately needs) — a write outside root is an
 *     `EPERM` at the syscall, not a policy check we can be tricked past;
 *   · file READS of the sensitive-root blocklist (~/.ssh, ~/.aws, provider auth
 *     + transcript caches) are DENIED — so an approved command can't `cat`
 *     credentials into the transcript;
 *   · outbound NETWORK is denied by default — the highest-leverage exfil/RCE
 *     channel is simply closed (local unix sockets stay open so tooling that
 *     talks to a local daemon keeps working).
 *
 * HONEST DEGRADATION
 * ------------------
 * Seatbelt is macOS-only. On Linux/Windows, or if `sandbox-exec` is unavailable,
 * {@link wrapCommandForSandbox} returns the command UNCHANGED and reports
 * `sandboxed: false`. The caller surfaces that so the posture is never silently
 * assumed — the confirm gate + app-level confinement remain the barriers there.
 * (A Linux Landlock/bwrap backend is a clean follow-up behind the same seam.)
 *
 * PURE + electron-free: string/path assembly only. The one runtime probe
 * (`sandbox-exec` on PATH) is injectable for tests.
 */

import { existsSync } from 'node:fs';
import { platform } from 'node:process';

/** The outcome of wrapping a user command for OS-level containment. */
export interface SandboxWrap {
  /** The command to actually hand to the shell (wrapped on macOS, verbatim elsewhere). */
  command: string;
  /** True iff kernel-level containment is in force for this command. */
  sandboxed: boolean;
  /** Why containment is off, when `sandboxed` is false (for an honest status line). */
  reason?: string;
}

/** Options controlling the generated Seatbelt policy. */
export interface SandboxOptions {
  /** The canonical (realpath'd) workspace root writes are confined to. */
  root: string;
  /** Sensitive roots to hard-deny reads of (defaults to the broker's list at the call site). */
  denyReadRoots?: readonly string[];
  /** Allow outbound network from the command (default: false — egress denied). */
  allowNetwork?: boolean;
  /** Test seam: does `sandbox-exec` exist / is this macOS? Defaults to a real probe. */
  isAvailable?: () => boolean;
}

/**
 * Absolute temp/device subpaths a legitimate build/test legitimately writes to,
 * beyond the workspace root. Kept deliberately tight — these are ephemeral,
 * world-shared scratch locations, NOT the user's HOME or config.
 */
const DEFAULT_WRITABLE_EXTRAS: readonly string[] = [
  '/private/tmp',
  '/private/var/folders', // macOS per-user TMPDIR canonicalizes here
  '/tmp',
  '/dev'
];

/** POSIX single-quote a string for safe embedding in a `sh -c` argument. */
function singleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Escape a path for a Seatbelt string literal (double-quoted TinyScheme). */
function sbString(path: string): string {
  // Seatbelt string literals are double-quoted; backslash + double-quote escape.
  return `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** True iff kernel containment is available in this environment (macOS + sandbox-exec). */
export function sandboxAvailable(): boolean {
  return platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');
}

/**
 * Build the Seatbelt profile text: allow-by-default, then subtract the dangerous
 * capabilities. `allow default` keeps ordinary tooling (compilers, git, reads)
 * working; the subsequent `deny` rules are the security envelope. Seatbelt
 * matches CANONICAL paths, so `root` MUST already be realpath'd
 * guarantees this) or in-root writes would be wrongly denied.
 */
export function buildSeatbeltProfile(opts: SandboxOptions): string {
  const writable = [opts.root, ...DEFAULT_WRITABLE_EXTRAS];
  const lines: string[] = [
    '(version 1)',
    '(allow default)',
    // --- filesystem writes: deny all, then re-allow the workspace + scratch ---
    '(deny file-write*)',
    ...writable.map((p) => `(allow file-write* (subpath ${sbString(p)}))`)
  ];
  // --- reads: deny the sensitive-root blocklist (credentials + transcripts) ---
  const denyReads = opts.denyReadRoots ?? [];
  if (denyReads.length) {
    lines.push(...denyReads.map((p) => `(deny file-read* (subpath ${sbString(p)}))`));
  }
  // --- network egress: closed by default; local unix sockets stay usable ---
  if (!opts.allowNetwork) {
    lines.push('(deny network*)', '(allow network* (remote unix-socket))', '(allow network-bind (local unix-socket))');
  }
  return lines.join('\n');
}

/**
 * Wrap a user shell command so it runs under kernel containment when possible.
 * On macOS with `sandbox-exec` present, returns
 * `sandbox-exec -p <profile> /bin/sh -c <command>` (safely quoted so pi's
 * `env.exec` — itself a `sh -c` — nests correctly). Everywhere else, returns the
 * command unchanged with `sandboxed:false` + a reason, so the caller can be
 * honest about the posture.
 */
export function wrapCommandForSandbox(command: string, opts: SandboxOptions): SandboxWrap {
  const available = (opts.isAvailable ?? sandboxAvailable)();
  if (!available) {
    return {
      command,
      sandboxed: false,
      reason:
        platform === 'darwin'
          ? 'sandbox-exec not found — running without kernel containment'
          : `OS sandbox unsupported on ${platform} — running without kernel containment`
    };
  }
  const profile = buildSeatbeltProfile(opts);
  const wrapped = `sandbox-exec -p ${singleQuote(profile)} /bin/sh -c ${singleQuote(command)}`;
  return { command: wrapped, sandboxed: true };
}
