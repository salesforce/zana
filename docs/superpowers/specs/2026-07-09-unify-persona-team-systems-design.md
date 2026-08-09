# Unify the two persona/team systems by context

**Date:** 2026-07-09
**Status:** Approved (ready for implementation plan)

## Problem

Zana Command Center (ZCC) surfaces **two parallel, overlapping vocabularies** for
"named agent" and "team of agents", backed by two different on-disk stores:

| | System A — ZCC-native | System B — Zana daemon |
|---|---|---|
| **On disk** | `~/.zcc/personas/*.json`, `~/.zcc/teams/*.json` (+ per-project `.zcc/`) | `~/.zana/profiles/*.json` (+ `@zana-ai/core` built-ins), `~/.zana/teams/*.json` |
| **UI words** | "Persona", "Team" | "Profile", "Squad" |
| **Stores** | `src/main/persona-store.ts`, `src/main/team-store.ts` (full CRUD, hot-reload, editors) | `plugins/zana/main/zana-main.ts` (`listProfiles`/`getProfile`), `src/main/daemon-team-store.ts` (`listSquads`) — **read-only** |
| **Execution** | ZCC spawns real PTYs; supports autonomous runs | ZCC does not spawn; a picked squad seeds one agent's first prompt with `/zana:team <id>`, and that agent orchestrates the roster in-session |
| **Owner** | This Electron app | The external `@zana-ai` npm daemon |

The concepts overlap enough that a user cannot tell "Persona" from "Profile", or
"Team" from "Squad" — they look like peers but come from different backends with
different capabilities.

**Where they actually collide:** only one surface shows both vocabularies
head-to-head — the **`LaunchPanel`** ("New agent" modal), which renders a
**Persona** picker (A), a **Squad** picker (B), and an **Autonomous team → Team**
picker (A) at once: three words, two backends, no signal that they differ.

Everywhere else they are already context-separated:
- **PersonasPanel / TeamsPanel** (sidebar) — System A only.
- **Tickets → Profiles / assignee picker** — System B only, and **load-bearing**:
  tickets live in the `.zana` store and can only be assigned to `.zana` profiles.

## Goal

Reduce **user confusion** (UI/UX), not delete code. Present **one coherent
vocabulary per context**. System B (Zana) is load-bearing in Tickets and the app
is literally named "Zana Command Center", so this is explicitly **not** a removal
of Zana — it is removing the one place the two systems collide.

Non-goals: renaming persona/profile terminology app-wide; merging the two on-disk
data models; deleting `~/.zana` data; changing the Zana daemon, the
`@zana-ai/core` package, or the Tickets integration.

## Approach (chosen: "A — separate by context")

Each UI context speaks exactly one vocabulary:

- **Launcher (`LaunchPanel`)** → ZCC-native only: **Persona** picker + **Autonomous
  team** picker. The **Squad** picker is **removed**.
- **Tickets (`ProfilesView` + assignee)** → Zana-only: **Profiles** — unchanged.

Considered and rejected:
- **B — unify vocabulary + source badge:** keeps every feature but is a wide
  rename across many components and user-facing copy, and a badge still asks the
  user to understand two backends.
- **C — ZCC primary, Zana demoted (conditional surfacing):** cleanest end-state
  but the most behavioral change and risks hiding Zana from users who rely on it.

## Escape hatch preserved

Removing the Squad *picker* does not remove the capability. `/zana:team <id>` is a
slash command; a user who wants a Zana daemon team types `/zana:team <id>` into the
launcher prompt exactly as before. The daemon, the `~/.zana` files, and the slash
command are all untouched.

## Part 1 — Backup (insurance, runs before any deletion)

The user has real data in `~/.zana` (6 profiles, 10 squads). Approach A does not
delete it, but we still take a **verbatim safety copy** into the "new place":

**Destination:** `~/.zcc/backups/zana-2026-07-09/`
- `profiles/` ← all `~/.zana/profiles/*.json` (byte-for-byte)
- `teams/` ← all `~/.zana/teams/*.json` (+ `.seeded`) (byte-for-byte)
- `README.md` — what these are, the date, and a note that `/zana:team <id>` still
  resolves against the live `~/.zana/teams` (this is a copy, not a move).

Nothing under `~/.zana` is modified. Pure insurance.

### No functional migration

Investigation found the ZCC side is **not** an empty target awaiting a migration:

- All 10 Zana squad ids (`backend-squad`, `core-dev-squad`, …) **already have
  `~/.zcc/teams` counterparts with identical ids** — but the ZCC versions are
  **newer, hand-tuned, and use a different schema** (persona **slug** references +
  `orchestratorPersonaId`, vs the Zana squads' profile **UUID** references +
  `orchestratorProfileId`, `maxTotalWorkers`, `rules`, `workerProfileIds`).
- The rosters differ materially (e.g. Zana `core-dev-squad`: intake-analyst →
  architect → 2 backend-devs → test-engineer → org-validator → reviewer; ZCC
  `core-dev-squad`: researcher → UDD-specialist → 2 implementers → ftest → 2
  reviewers).

Therefore a "migrate `~/.zana` → `~/.zcc`" that overwrote would **clobber newer
ZCC work with older Zana definitions**. Per the user's decision, we take the
**verbatim backup only** and perform **no functional import** — the ZCC
personas/teams stay exactly as they are. The backed-up Zana JSON remains available
as reference if the user later wants to hand-craft ZCC equivalents.

## Part 2 — Remove the Squad picker (code changes)

**Critical disambiguation — "squad" is overloaded across two unrelated concepts:**

1. **System B daemon teams** — `SquadSummary`, `listSquads`, the `squads:list`
   IPC, and the `LaunchPanel` Squad picker. **This is what we remove.**
2. **ZCC's runtime "Squad Flow" mesh view** — `SquadSwitcher`,
   `squadLaunchGroups.ts`, `squadFlow.ts` (`buildSquadFlow`), `SquadFlowGraph`,
   `SquadFlowView.tsx`. This visualizes live team-launch cohorts and is **entirely
   separate**. It **must not be touched.**

**The `SquadSummary` type is shared and stays.** It is imported by `squadFlow.ts`
and typed on the optional `SquadFlowGraph.squad?` descriptor field — part of the
Squad Flow view we are not touching. In production nothing ever populates that
field (`SquadFlowView.tsx`'s two `buildSquadFlow(...)` calls never pass `squad`);
only a unit-test fixture sets it. The daemon store (`listSquads`) is the only code
that ever *constructs* a `SquadSummary`, and removing it just means the always-
undefined field keeps being undefined — no behavior change. So we **keep the
`SquadSummary` interface and the `SquadFlowGraph.squad?` field**, and remove only
the `squads.list()` producer chain that fed the picker.

### File changes

| File | Change |
|---|---|
| `src/renderer/components/LaunchPanel.tsx` | Remove: `squads` state, `squadId` state, the `squads.list()` `useEffect`, `selectedSquad`, `squadsCollapsed`, the entire Squad picker `<div>` block, the `selectedSquad` `/zana:team` prompt-seeding branch in `launch()` (body becomes just the typed prompt; title no longer branches on `selectedSquad`), the `launch:squads` collapse handling, and the `SquadSummary` import. Update the `LaunchSectionLabel` doc comment (drops "/ Squad"). |
| `src/main/daemon-team-store.ts` | **Delete** the file (`listSquads`, `readSquadFile`, `workerCount`). |
| `src/main/index.ts` | Remove the `import { listSquads }` and the `safeHandle(IPC.squads.list, …)` registration. |
| `src/shared/ipc.ts` | Remove the `squads: { list: 'squads:list' }` channel. |
| `src/preload/index.ts` | Remove the `squads: { list: … }` bridge. |
| `src/shared/types.ts` | Remove **only** the `squads: { list(): Promise<SquadSummary[]> }` API declaration on the `window.cc` bridge type. **Keep** the `SquadSummary` interface and the `SquadFlowGraph.squad?: SquadSummary` field (both belong to the Squad Flow view, untouched). |
| `src/main/__tests__/daemon-team-store.test.ts` | **Delete** (tests the removed store). |
| `src/renderer/util/__tests__/squadFlow.test.ts` | **Unchanged** — it tests `buildSquadFlow` (the Squad Flow view), which keeps its `squad?` field. |

### Explicitly untouched

- All ZCC personas/teams (`persona-store.ts`, `team-store.ts`, editors, panels).
- Autonomous runs (`autonomous-run-supervisor.ts`, the launcher's Autonomous team
  mode).
- The **entire Squad Flow runtime view** (concept #2 above).
- Tickets → Profiles view and ticket assignment (`plugins/zana/main/zana-main.ts`,
  `ProfilesView.tsx`, `ticketsApi`, `useTickets`).
- The `/zana:team` slash command and everything under `~/.zana`.

## Part 3 — Verify

Run the dev app and confirm end-to-end behavior (not just tests):
1. Launch the dev build.
2. Open "New agent" → the modal shows **only** Profile + Persona + Autonomous
   team; **no "Squad" row**.
3. No console / IPC error from the removed `squads:list` channel (renderer never
   calls it; main never registers it).
4. Confirm `/zana:team <id>` typed into the prompt still launches (the slash
   command path is unchanged) — spot check, not a hard gate.
5. Confirm the backup exists at `~/.zcc/backups/zana-2026-07-09/` with 6 profiles
   + 10 teams.

Also run the test suite; `daemon-team-store.test.ts` is gone and `squadFlow.test.ts`
still passes **unchanged** — its `squad?` fixture stays valid because the
`SquadSummary` interface and the `SquadFlowGraph.squad?` field are kept.

## Net user-facing result

The "New agent" modal speaks one vocabulary (Persona + Team, both ZCC). "Profile"
and "Squad" no longer sit next to "Persona" and "Team" as confusing peers. Zana
stays exactly where it is actually required — the Tickets tab — and the daemon
team capability remains reachable via `/zana:team`.
