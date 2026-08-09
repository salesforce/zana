# @zcc/streamdeck

Drive a physical **Elgato Stream Deck** as a live control surface for Zana
Command Center. The deck rests on a landing page showing a single **ZCC** hub
icon; press it and every zcc capability fans out onto the keys — live agents,
projects, schedules, and a fleet-status overview — each a real control-plane
action, not a keystroke sprayed at a window.

Adapted from the [`claude-stream-deck-showcase`](https://github.com/Philaphonic/claude-stream-deck-showcase)
design, but rebuilt on zcc's own data + control plane. The two key differences
from that showcase:

| | showcase | @zcc/streamdeck |
|---|---|---|
| **State** | *inferred* by tailing `~/.claude` logs (a 4s heuristic) | **authoritative** — `agent.list` fuses live status |
| **Interaction** | synthetic keystrokes into the OS-focused window (Windows-only) | explicit **control-plane RPC** addressed by agent handle/sessionId (cross-platform) |

There is no window and no focus: an agent is addressed by its stable identity,
so a keypress is a precise `agent.send` / `term.reply`, not a keystroke sprayed
at whatever happens to be foreground.

## How it connects

The daemon speaks the same control plane the `@zcc/cli` does — the UDS at
`~/.zcc/control.sock`, authed with `~/.zcc/control.token`. **Zana Command Center
must be running** for the socket to exist. Reads use `agent.list`, `project.list`,
`sched.list`, and `status`; writes use `term.reply` (inject text at an agent's
prompt, e.g. to answer a permission prompt), `agent.send` (peer message),
`term.create` (spawn an agent into a project), and `sched.runNow` /
`sched.setEnabled`. Mutating ops are operator-class; a hardware daemon carries no
`ZCC_SESSION_ID`, so it's treated as the operator — exactly the privilege a
physical button should have.

## Layout

The deck is a small navigation tree rooted at the landing page. `Back` (row 3,
col 7 on every view) pops one level.

- **Landing:** a single **ZCC** hub tile at (0,0). The rest of the grid is free
  for other functions (media, spotify, home automation). Press ZCC → the menu.
- **ZCC menu:** one tile per capability — **Agents**, **Projects**,
  **Schedules**, **Status** (row 0) — plus **Approve all** (reply `y` to every
  blocked agent) and **Back** (row 3).
- **Agents** (live-polled): rows 0–2 = one tile per live agent, colour = status
  (green=working, **amber=blocked/needs-you**, rust=unknown, slate=idle), label =
  handle. Row 3 = Approve-all / Refresh / Back. Press a tile → per-agent overlay:
  Approve (`y`), Deny (`n`), Continue, Ping, Back.
- **Projects** (fetched on open): rows 0–2 = project tiles. Press one → overlay:
  spawn a `claude` or `claude-yolo` agent into that project (`term.create`).
- **Schedules** (fetched on open): rows 0–2 = schedule tiles (green when
  enabled). Press one → overlay: Run now (`sched.runNow`) / Enable-Disable
  toggle (`sched.setEnabled`).
- **Status** (fetched on open): count tiles — Agents / Working / Blocked (amber
  when non-zero) / Projects / Schedules — plus Refresh.

Only the Agents view polls continuously (its status changes second-to-second);
Projects / Schedules / Status are fetched once on open and via their Refresh key,
so the deck isn't hammering the control plane for slow-changing data.

## Architecture

Pure, testable core with the hardware and the optional image lib isolated behind
lazy imports, so the whole app runs headless against a `FakeDeck`:

- `deck/` — device-agnostic framework (`Page`/`Navigator`/`DeckController`),
  ported from the showcase. `elgato-device.ts` wraps `@elgato-stream-deck/node`
  v7 (cross-platform HID); `fake-device.ts` is the test double.
- `lib/control-client.ts` — control-plane transport (ported from `@zcc/cli`).
- `lib/zcc-source.ts` — deck-shaped read/write wrappers over the control ops
  (agents, projects, schedules, status + the writes above).
- `lib/poller.ts` — fixed-interval `agent.list` snapshots, plus `pollNow()` for
  an immediate fetch when the Agents view opens.
- `lib/actions.ts` — an action queue so the press callback never blocks on I/O;
  its `Intent` union covers reply/send/spawn/sched-run/sched-toggle.
- `pages/` — the landing page, the ZCC menu, and each capability view + overlay.
- `app.ts` — wires it together (`createDeckApp`); `bin/zcc-deck.ts` is the daemon.

## Usage

```
# Elgato's official app must be fully quit first — only one process can hold the HID connection.
npm run build --workspace @zcc/streamdeck    # from the repo root
node packages/streamdeck/dist/bin/zcc-deck.js
```

The Elgato HID lib and `@napi-rs/canvas` (label compositing) are
`optionalDependencies`: headless builds/tests skip them, and the renderer falls
back to solid status tiles when canvas is absent.

### Try it without hardware — terminal simulator

No Stream Deck and no running app required. `zcc-deck-sim` stands up an
in-process demo control plane (canned agents / projects / schedules on a temp
socket), renders the 8×4 grid to your terminal as coloured, labelled tiles, and
lets you "press" a key by typing its `col row`:

```
npm run build --workspace @zcc/streamdeck
npm run sim   --workspace @zcc/streamdeck        # or: node packages/streamdeck/dist/bin/zcc-deck-sim.js
```

Then walk the full flow: `0 0` (ZCC hub) → `0 0` (Agents) → a tile → `0 1`
(Approve). The mutating ops (reply / spawn / schedule toggle) print under the
grid as they fire. It runs the same navigation and action code the hardware
daemon does — only the blit target (terminal) and the input source (stdin)
differ. `q` quits.

## Status

The ZCC hub and all four capability views (agents, projects, schedules, status)
plus their action overlays are implemented and covered by end-to-end tests
(press hub → menu → view → action → RPC over a real UDS).

A ticket-board ("kanban columns") view is **not** built: the control plane
exposes no ticket/board ops today, so it would need new server-side ops first.
Teams and personas are read-only in the control plane and not yet surfaced as
tiles — natural next additions to the menu.
