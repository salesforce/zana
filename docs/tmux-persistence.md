# tmux persistence (Phase 2)

**Status:** shipped (Phase 2 of `docs/tmux-agent-mesh-implementation-plan.md`),
gated behind `AppConfig.tmuxScope: 'off' | 'remote' | 'all'`. **Defaults to
`'all'`** (`store.ts` — absent-in-file ⇒ `'all'`; degrades gracefully to plain
node-pty when tmux is absent). `'remote'` wraps only SSH-backed sessions (the
strongest use case — surviving a dropped link) and leaves local sessions
unwrapped; `'off'` never wraps. This field replaced the earlier boolean
`tmuxPersistence` (`true`/`false` ⇒ `'all'`/`'off'`). The "default OFF" framing
below is historical.

**See also:** `.zcc/library/findings/tmux-untapped-capabilities.md` — live-verified
tmux features beyond `new -A -s` (send-keys / capture-pane / pane_dead) that
deepen the remote-resilience story. Shipped so far (see
`findings/remote-connection-resilience.md`): SSH keepalives, tmux auto-reattach,
and a `has-session` **liveness probe** so a finished remote agent finalizes
instead of triggering a zombie reconnect (a blind `new -A -s` would otherwise
spawn a fresh conversation).

## What it is — and what it is NOT

tmux backs a ZCC session so the underlying process **survives an app restart**
and a **dropped SSH link can be re-attached**. That is the entire value:
**durability / detach, not performance.**

It does **not** make terminals faster, lighter, or smoother. The review
(`docs/tmux-agent-mesh-review.md`) found every performance claim to be a myth or
already solved:

- PTY spawn is not the bottleneck; the `claude` child tree dominates, and tmux
  *adds* a server + client process.
- IPC flooding from chatty commands was already fixed by the 8 ms output
  coalescer in `pty.ts` — tmux does nothing for it (a re-attach actually *adds*
  a one-time scrollback replay burst the coalescer must absorb).
- Memory is neutral-to-worse (tmux server RSS on top of everything).

So the UI copy and any user-facing description must say **"survive app restart /
network blips"**, never "faster" or "lighter".

**Control mode (`tmux -CC`) is rejected for v1** — it would be a rewrite of the
core runtime (one demuxed stream replacing N independent `pty.IPty`s, and a
redesign of the per-session identity-bearing env injection). Model 2 (below)
delivers the persistence win with a near-zero diff.

## How it works (Model 2 — tmux behind node-pty)

We only change the *command* node-pty spawns; node-pty stays the client, so
`onData` / `write` / `resize` / the 8 ms coalescer / the 50-session cap / env
injection are all unchanged (the tmux pane's child inherits the env).

- **Local** (`pty.ts` `create`): when enabled, spawns
  `tmux new-session -A -s cc-<sessionId> -- <command> <args>` instead of
  `<command> <args>`. `-A` attaches if a session of that name already exists
  (the restore re-attach path) or creates it.
- **Remote** (`pty.ts` `createRemote`): when enabled, wraps the remote login
  command in `tmux new -A -s cc-<sessionId> -- …` behind the existing `ssh -t`.
  This is the **strongest** use case — survive a flaky SSH connection. We rely
  on `tmux` being on the remote PATH; a missing remote tmux surfaces as an
  ordinary command error in the terminal.

The `cc-` session-name prefix is the match key the orphan reaper uses, so we
only ever touch sessions ZCC created — never a tmux session the user started by
hand.

## Graceful fallback (cross-platform)

tmux is an external binary, **not** an npm dependency, and is **absent on
Windows**. `isTmuxAvailable()` (`src/main/tmux.ts`) returns false on `win32`
unconditionally (mirroring the `env.ts` Windows guard) and false when `tmux`
isn't on PATH. When unavailable — or when the flag is off — sessions spawn via a
plain `node-pty` exactly as before, with **no error and no behavior change**.

Scheduled and headless runs **never** use tmux: they're short-lived and
auto-closed, so persistence buys nothing and would only leak tmux servers.

## Orphan reaper

A `cc-*` tmux server outlives the app by design, so a crashed/quit run can leave
one behind. On boot (only when the flag is on), after a 10 s grace delay, the
reaper kills every `cc-*` tmux session that **no live pty is bound to**.

### Why liveness, not the restore snapshot (the Q5 spike conclusion)

The ideal reconcile is "kill every `cc-*` session not in the restore snapshot",
but that snapshot (`cc.openSessions`) lives in **renderer localStorage and is not
readable by the main process** at boot. So the reaper reconciles by **liveness**
instead: a `cc-*` session is an orphan iff no live pty in `PtyManager` is bound
to it (`ptys.getSession(id) !== null`) — the main process's own live map, which
*is* authoritative. The grace delay lets the renderer's session-restore re-spawn
its tabs first; each re-attaches via `new-session -A`, becoming live and thus not
an orphan. Anything still unclaimed after the window is genuinely abandoned.

A missed reap is harmless — the dead server just lingers until the next boot.

## Items still needing a live check (the rendering spikes)

Two Phase-2 spikes require observing real tmux output in the running Electron app
and **could not be verified in the headless build environment**. The code ships
with the conservative choice; these should be confirmed once before enabling the
flag widely:

- **Q1 — re-attach scrollback replay vs the single-mount xterm.** On
  `tmux attach`, tmux replays its scrollback as a burst. The 8 ms coalescer will
  batch it, but whether it renders cleanly into a *fresh* xterm vs *double-draws*
  into an existing one needs a real attach. **Mitigation in place:** restore
  re-spawns into a fresh xterm, which is the clean case; verify there's no
  duplication.
- **Q2 — `proc.resize()` over a tmux client.** Single-client resize should track
  the tmux window; a multi-attach (e.g. a stray external `tmux attach`) triggers
  tmux's smallest-client size negotiation and can flicker. Acceptable for the
  single-client v1; documented as a known caveat.

Both are isolated to rendering behavior behind the default-off flag — they do
not affect Phases 0/1 or any non-tmux session.

## Enabling it

Set `tmuxScope: 'all'` (both local and remote) or `'remote'` (SSH sessions
only) in the app config — a Settings dropdown surfaces this. Requires `tmux`
on PATH (macOS: `brew install tmux`). `'off'`, or a host without tmux,
everything behaves exactly as it did before.
