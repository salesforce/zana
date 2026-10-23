/**
 * tmux substrate helpers (Phase 2 of the agent-mesh / persistence plan).
 *
 * tmux is used ONLY as a persistence/detach backend behind node-pty (Model 2 in
 * `docs/tmux-agent-mesh-review.md`) — never as a performance play. It is
 * strictly opt-in (`AppConfig.tmuxScope`: 'off' | 'remote' | 'all', default
 * 'all') and must degrade gracefully: tmux is an external binary, absent on
 * Windows and not guaranteed on every mac/Linux host, and is NOT an npm
 * dependency. When it isn't available we fall back to spawning the command
 * directly under node-pty, with no error and no behavior change.
 *
 * This module is intentionally tiny and pure-ish (one cached PATH probe + two
 * pure command builders) so it can be unit-tested without spawning anything.
 */

import { execFile } from 'node:child_process';

/**
 * Prefix every ZCC-managed tmux session name with this, so the boot-time
 * reaper can find and reconcile only OUR sessions (`tmux ls` → match `cc-*`)
 * and never touch a tmux session the user created by hand.
 */
export const TMUX_SESSION_PREFIX = 'cc-';

/** The tmux session name for a given ZCC session id. */
export function tmuxSessionName(sessionId: string): string {
  return `${TMUX_SESSION_PREFIX}${sessionId}`;
}

// Cache the probe: it shells out, and the answer can't change within a run
// (the PATH is fixed at boot). `null` = not yet probed.
let cachedAvailable: boolean | null = null;
let pendingProbe: Promise<TmuxVerifyResult> | undefined;

/**
 * Whether tmux can be used on this host. False on Windows unconditionally
 * (tmux is a POSIX tool; the win32 guard mirrors `env.ts`), and false when
 * `tmux` isn't on PATH. Cached after the first call. Pass `force` in tests to
 * re-probe.
 */
export async function prepareTmuxAvailability(force = false): Promise<boolean> {
  if (!force && cachedAvailable !== null) return cachedAvailable;
  return (await verifyTmux()).installed;
}

/** Synchronous spawn assembly only consumes a warmed cache. A direct legacy
 * caller safely falls back while the nonblocking probe completes. */
export function isTmuxAvailable(): boolean {
  if (cachedAvailable === null) void verifyTmux();
  return cachedAvailable ?? false;
}

export interface TmuxVerifyResult {
  installed: boolean;
  version?: string;
  installHint: string;
}

/** Probe tmux for Settings using main's repaired PATH. Never throws. */
export function verifyTmux(): Promise<TmuxVerifyResult> {
  if (process.platform === 'win32') {
    return Promise.resolve({ installed: false, installHint: 'tmux is unavailable on Windows' });
  }
  if (pendingProbe) return pendingProbe;
  const task = new Promise<TmuxVerifyResult>((resolve) => {
    const done = (error: Error | null, stdout = '') => resolve({
      installed: !error, version: !error ? stdout.trim() || undefined : undefined,
      installHint: 'brew install tmux'
    });
    try { execFile('tmux', ['-V'], { encoding: 'utf8', timeout: 3_000, maxBuffer: 4096 }, done); }
    catch { done(new Error('tmux unavailable')); }
  });
  pendingProbe = task;
  void task.then(result => {
    if (pendingProbe !== task) return;
    cachedAvailable = result.installed;
    pendingProbe = undefined;
  });
  return task;
}

/** Reset the cache (tests only). */
export function resetTmuxAvailabilityCache(): void {
  cachedAvailable = null;
  pendingProbe = undefined;
}

/**
 * Build the argv that wraps a LOCAL command in a tmux session, for
 * `pty.spawn(command, args)`. node-pty attaches to the tmux client; tmux owns
 * the real child process, so it survives an app restart and can be re-attached.
 *
 * `new-session -A -s <name>` attaches if a session with that name already
 * exists (the restore re-attach path) or creates it otherwise. `--` ends tmux's
 * option parsing so the wrapped command's own flags are never mis-read as
 * tmux's. Pure — returns `{ command, args }` for the caller to spawn.
 *
 * ## Agent-status title forwarding (why the `set` clauses)
 *
 * Agent status (working/idle/done) is detected by parsing the OSC title the
 * inner `claude` process emits — a leading braille spinner glyph means
 * "working", `✳` means "idle" (see `agent-status.ts`). But tmux sits between
 * `claude` and the node-pty Zana reads, and by DEFAULT it does NOT forward the
 * inner pane's title to the outer terminal, so the detector only ever sees the
 * idle marker (or nothing) → every agent is stuck "Idle".
 *
 * We fix that at session creation with three options (verified empirically):
 *  - `set-titles on`              — make tmux emit a title to the outer tty.
 *  - `set-titles-string '#T'`     — emit the PANE title (`#T`, what claude set)
 *                                   verbatim, not tmux's `#S:#I:#W` window
 *                                   format (which carries no spinner glyph).
 *  - `terminal-overrides ',*:tsl=\E]2;:fsl=\007'` — force the title to be wrapped
 *                                   as an OSC 2 sequence (`ESC ] 2 ; … BEL`).
 *                                   Required because tmux can't introspect
 *                                   node-pty's TERM as title-capable, so without
 *                                   forcing tsl/fsl it emits nothing.
 *
 * ## Wheel scrolling (why `mouse on`)
 *
 * A tmux pane runs its inner program (a shell / `claude`) on tmux's OWN
 * alternate screen, so from xterm.js's point of view the buffer has NO
 * scrollback (`hasScrollback === false`). With mouse reporting off, xterm's
 * built-in wheel handler then translates every wheel notch into Up/Down
 * ARROW-KEY sequences (`ESC[A`/`ESC[B`) that it sends down the pty; tmux
 * forwards those to the inner program, so scrolling the wheel navigates the
 * shell's history or the agent's message list instead of paging — the
 * "scrolling moves the Messages, I can't scroll the terminal" bug on tmux-backed
 * (remote / persistent) sessions. A non-tmux local session never hits this:
 * `claude` sits on the NORMAL buffer, so xterm scrolls its own 50k scrollback.
 *
 * `set -g mouse on` fixes it end-to-end: tmux enables mouse reporting on its
 * outer tty, so xterm stops synthesizing arrows and instead forwards the wheel
 * as a mouse event (see `terminalWheel.ts`), and tmux itself consumes that wheel
 * event — entering copy-mode to scroll its OWN scrollback. That is the standard,
 * expected tmux wheel behavior. Trade-off: with mouse reporting on, a plain
 * click-drag is captured by tmux; native text selection for copy is done by
 * holding Shift while dragging (xterm.js forces selection on Shift) — the usual
 * tmux convention.
 *
 * Each `set` is a separate tmux command, chained with a literal `;` argument
 * (tmux's in-line command separator) before the `new-session`. `set -g` is
 * server-global and idempotent (re-running on attach is harmless).
 *
 * ## Per-session env (why `sessionEnv` → `-e KEY=VAL`)
 *
 * CRITICAL for multi-session correctness. The FIRST `new-session` on a host
 * also CREATES the tmux server, and the server snapshots that first client's
 * environment as its server-global env. Every LATER `new-session` makes its
 * pane inherit the SERVER's env — NOT the new client's. So our session-scoped
 * vars (`ZCC_FIRSTPROMPT_URL`, `ZCC_SUBAGENT_URL`, `ZCC_NOTIFY_URL`,
 * `ZCC_HOOK_URL`, `ZCC_MCP_URL`, `ZCC_OVERSEER_URL`, `ZCC_NATIVETOOL_URL` —
 * each carries THIS session's id) would leak:
 * the 2nd+ agent's child would inherit the 1st agent's URLs, so its first-prompt
 * hook names the WRONG card and its sub-agent hook flips the WRONG card to
 * "Delegating". `new-session -e KEY=VAL` sets the var for THIS session only,
 * overriding the stale server-global snapshot. Pass every session-scoped
 * `ZCC_*` var here; host/global env (PATH, HOME, …) still inherits normally.
 */
export function buildLocalTmuxCommand(
  sessionId: string,
  command: string,
  args: string[],
  sessionEnv?: Record<string, string | undefined>
): { command: string; args: string[] } {
  // One `-e KEY=VAL` per defined session-scoped var, so each tmux session gets
  // its OWN value instead of inheriting the server-global snapshot.
  const envArgs: string[] = [];
  for (const [key, value] of Object.entries(sessionEnv ?? {})) {
    if (value !== undefined) envArgs.push('-e', `${key}=${value}`);
  }
  return {
    command: 'tmux',
    args: [
      // Force UTF-8. tmux derives UTF-8 support from its locale, but the app
      // spawns tmux under whatever env node-pty inherits — which, for an
      // Electron app launched from Finder/Dock, has no UTF-8 locale (LANG
      // empty → LC_CTYPE falls back to C). Without UTF-8 the attached client
      // sets client_utf8=0 and renders every multi-byte character (é, ü, …) as
      // "_". `-u` forces UTF-8 regardless of the host locale. MUST be the first
      // token, before the `set`/`new-session` subcommands.
      '-u',
      'set', '-g', 'set-titles', 'on', ';',
      'set', '-g', 'set-titles-string', '#T', ';',
      'set', '-ga', 'terminal-overrides', ',*:tsl=\\E]2;:fsl=\\007', ';',
      // Wheel → tmux copy-mode scroll (not synthesized arrow keys). See the
      // "Wheel scrolling" note above.
      'set', '-g', 'mouse', 'on', ';',
      'new-session', '-A', '-s', tmuxSessionName(sessionId), ...envArgs, '--', command, ...args
    ]
  };
}

/**
 * Wrap a REMOTE login command in a tmux session on the remote host, so a
 * dropped/flaky SSH link can be re-attached with the session intact. Uses
 * `new -A -s` (attach-or-create).
 *
 * `quotedInnerCmd` MUST be the whole remote command as a SINGLE shell-quoted
 * token (the caller quotes it with `shellQuote`). We pass it as tmux's single
 * `shell-command` argument — NOT after `--` — because the inner command is a
 * compound shell string (`cd '…' && exec '…'`), and tmux runs a single-string
 * command through `sh -c` (so the `&&` is honored inside the pane) whereas a
 * `--`-style argv is exec'd directly (which would break the `&&`). This is the
 * standard `tmux new -d '<long command>'` idiom.
 *
 * ## Agent-status title forwarding (why the leading `set` clauses)
 *
 * These mirror the three options {@link buildLocalTmuxCommand} sets locally,
 * for the SAME reason: by default tmux does NOT forward the inner pane's OSC
 * title to its outer tty, so the agent-status detector (which classifies
 * working/idle from claude's title glyph — see `agent-status.ts`) would see
 * nothing THROUGH tmux and every remote agent would read as "Idle". On the
 * remote the outer tty is the `ssh -t` pty, whose output ssh streams back to
 * the local node-pty, so forwarding the title here restores working/idle
 * detection end-to-end.
 *
 * Unlike the local path — where tmux argv is handed to node-pty directly (no
 * shell) — this whole string is parsed ONCE by the remote login shell
 * (`ssh -t` → `$SHELL -c`). So the quoting differs from the local builder:
 *  - the clauses are chained into ONE tmux invocation using tmux's own `;`
 *    command separator, written as `';'` so the remote shell passes a LITERAL
 *    `;` to tmux as an argument (its separator) instead of treating it as a
 *    shell command separator;
 *  - `'#T'` is single-quoted (a bare `#T` starts a shell comment);
 *  - the `terminal-overrides` value is single-quoted because it embeds a `;`
 *    and backslash escapes (`\E`, `\007`) the remote shell would otherwise
 *    mangle — single quotes hand tmux the value verbatim.
 * `set -g`/`-ga` are server-global and idempotent, so re-running them on a
 * re-attach is harmless.
 *
 * The `set -g mouse on` clause mirrors {@link buildLocalTmuxCommand} for the
 * SAME reason (see its "Wheel scrolling" note): without it, xterm.js sees the
 * tmux pane as a no-scrollback alternate buffer and turns wheel notches into
 * arrow keys that scroll the inner program's history/messages instead of the
 * terminal. `mouse on` lets tmux own the wheel (copy-mode scroll) end-to-end,
 * over the `ssh -t` link, so remote tmux-backed sessions scroll like local ones.
 *
 * We rely on `tmux` being on the remote PATH; the caller only emits this when
 * persistence is enabled, and a missing remote tmux surfaces as a normal
 * command error in the terminal. Pure.
 */
export function wrapRemoteTmux(sessionId: string, quotedInnerCmd: string): string {
  return (
    // `-u` forces UTF-8 on the remote tmux for the same reason the local
    // builder passes it: the remote login shell may run under a non-UTF-8
    // locale, and without it multi-byte characters render as "_" through the
    // `ssh -t` pty. First token, before the `set` clauses.
    `tmux -u set -g set-titles on ';' ` +
    `set -g set-titles-string '#T' ';' ` +
    `set -ga terminal-overrides ',*:tsl=\\E]2;:fsl=\\007' ';' ` +
    `set -g mouse on ';' ` +
    `new -A -s ${tmuxSessionName(sessionId)} ${quotedInnerCmd}`
  );
}

/**
 * List the ZCC-owned tmux session names currently on the LOCAL host (the
 * `cc-*` ones we created). Returns the bare session ids (prefix stripped), or
 * `[]` when tmux isn't running / has no sessions. Async + best-effort.
 */
export async function listLocalTmuxSessionIds(): Promise<string[]> {
  if (process.platform === 'win32') return [];
  return new Promise((resolve) => {
    // `tmux ls -F '#{session_name}'` prints one name per line; exits non-zero
    // ("no server running") when nothing is up — treat that as "none".
    execFile(
      'tmux',
      ['ls', '-F', '#{session_name}'],
      { timeout: 3_000 },
      (err, stdout) => {
        if (err) return resolve([]);
        const ids = stdout
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.startsWith(TMUX_SESSION_PREFIX))
          .map((l) => l.slice(TMUX_SESSION_PREFIX.length));
        resolve(ids);
      }
    );
  });
}

/** Kill one ZCC-owned tmux session by ZCC session id. Best-effort, async. */
export async function killLocalTmuxSession(sessionId: string): Promise<void> {
  if (process.platform === 'win32') return;
  return new Promise((resolve) => {
    execFile(
      'tmux',
      ['kill-session', '-t', tmuxSessionName(sessionId)],
      { timeout: 3_000 },
      () => resolve() // ignore errors — already gone is fine
    );
  });
}

/**
 * Reap orphaned ZCC tmux sessions on the local host — `cc-*` servers left over
 * from a previous run that nothing is attached to anymore.
 *
 * ## Why conservative (the Q5 spike conclusion)
 *
 * The ideal reconcile is "kill every `cc-*` session NOT claimed by a restore
 * capability". Surviving sessions are claimed by main's restore-capabilities
 * ledger (`restore-capabilities.json`) plus live tmux ids — not renderer
 * localStorage. Liveness is meaningful only within this instance's recorded
 * ownership. Another Zana instance can use the same default tmux server, so the
 * `cc-` prefix alone never authorizes cleanup. Unknown sessions are left alone.
 * The grace delay gives owned sessions time to re-attach via `new-session -A`.
 *
 * @param isLive returns true if a live pty is currently bound to this session id
 * @returns the session ids that were reaped
 */
export async function reapOrphanTmuxSessions(
  ownedSessionIds: ReadonlySet<string>,
  isLive: (sessionId: string) => boolean
): Promise<string[]> {
  const present = await listLocalTmuxSessionIds();
  const orphans = present.filter((id) => ownedSessionIds.has(id) && !isLive(id));
  await Promise.all(orphans.map((id) => killLocalTmuxSession(id)));
  return orphans;
}
