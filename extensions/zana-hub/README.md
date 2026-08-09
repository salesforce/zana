# zana-hub — global Zana dashboard

A disk extension that adds a top-level **Zana** entry to the Command Center
sidebar (under "Extensions"), showing the Zana framework as a whole —
**cross-project**, read from the global `~/.zana` workspace.

This is the app-level companion to the per-project **Zana** tab (core's
ProjectTickets view, which reads each project's `.zana`): that tab is one
project's tickets/sprints; this surface is the framework — its reusable catalog
and recent activity.

## What it shows

Five sub-tabs, all sourced from `~/.zana/*.json`:

- **Overview** — KPI tiles (teams · profiles · skills · sprints · workers ·
  autopilot goals) and a run-state breakdown.
- **Teams** — reusable team templates (`~/.zana/teams`): roster size,
  concurrency ceiling, auto-start.
- **Profiles** — reusable launch profiles / personas (`~/.zana/profiles`).
- **Skills** — reusable skills (`~/.zana/skills`): enabled state, kind,
  description.
- **Runs** — recent agent runs (`~/.zana/runs`), newest first, with a live state
  chip. The sidebar nav badge shows the count currently `running`.

Every Teams / Profiles / Skills / Runs row is **clickable**: it opens a
right-hand detail drawer that reads the full on-disk record on demand (via the
`detail` capability) and shows the fields the summary omits — a team's roster +
rules + initial prompt, a profile's system prompt + allowed tools, a skill's
content, a run's prompt + result. Long values render in a scrollable text block
(capped at 8 KB); the drawer closes on the ✕ or a scrim click.

## How it reads data (sandbox scope)

The extension runs out-of-process and is capability-gated. It reads files only
through the brokered `ctx.fs` capability, declared in `extension.json` as
`fs:read` scoped to `fsRoots: ["~/.zana"]`. No raw `node:fs`, no network, no
exec.

Deliberately **out of scope** (not reachable from the sandbox):

- **Tickets** live in a SQLite DB (`~/.zana/tickets.db`) the sandbox can't open
  — the per-project Zana tab reads those via the trusted in-process core module.
- **In-flight deliberations / live team orchestration** live behind the Zana MCP
  server, not on disk — only their on-disk artifacts (runs, sprints,
  `automation-state.json`) are visible here.

## Build

```sh
npm install
npm run build      # build:renderer + build:main → dist/{renderer.js,main.mjs}
npm run package    # copy into examples/extensions/zana-hub + seed ~/.zcc/extensions/zana-hub
```

`npm run dev` at the repo root runs `seed-extensions.mjs`, which builds +
packages every `extensions/*` (this one included) so a cold start loads the
current bundle.
