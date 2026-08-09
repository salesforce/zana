# Edit & create Zana team templates from the zana-hub Teams tab

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan
**Supersedes:** `2026-07-07-edit-squad-team-from-flow-design.md` (wrong target — that
spec edited the app-native `~/.zcc` `Team` from the Flow view; this one edits the
Zana daemon's `~/.zana/teams/<id>.json` templates from the Zana extension).

## Problem

The **Zana** extension (`zana-hub`) has a **Teams** tab that lists the Zana
daemon's reusable team templates (`~/.zana/teams/<id>.json`) — the squads a
single agent runs via `/zana:team <id>`. Today that tab is **read-only**: it
shows each team's name, slot count, concurrency, and auto-start, but to change a
roster, orchestrator, or opening prompt the user must hand-edit the JSON on disk.

We want to **edit an existing template and create a new one** directly from the
Teams tab — the full template, saved back to `~/.zana/teams/<id>.json`.

Scope is the **on-disk template**, not any live run: editing a template affects
the *next* `/zana:team` launch, never an in-flight squad.

## Two "team" concepts — do not confuse them

| | App-native `Team` | **Zana template (this spec)** |
|---|---|---|
| Stored | `~/.zcc/teams` | **`~/.zana/teams/<id>.json`** |
| Edited by | `TeamEditor.tsx` (Teams panel) | **zana-hub Teams tab (new)** |
| Runs as | N terminal tabs | one agent via `/zana:team <id>` |

`TeamEditor.tsx` is a useful **UX reference only** — it is NOT reused here. This
editor lives inside the sandboxed extension (injected React, brokered `ctx.fs`,
a different on-disk schema).

## Sandbox reality (what makes this feasible)

The zana-hub extension is **out-of-process and capability-gated**. It touches
the filesystem ONLY through the brokered `ctx.fs` cap; raw `node:fs` is
denylisted in the child. Confirmed against the code:

- `ctx.fs.writeFile(path, data)` exists (SDK `packages/extension-sdk/src/main.ts`),
  gated by the `fs:write` permission and **path-confined to `fsRoots`** with a
  realpath escape check (`src/main/extensions/broker-caps.ts` `writeFile` →
  `broker.assert(moduleId, 'fs:write', …)`).
- Module handlers receive args: `host.call('saveTeam', input)` dispatches to
  `fn(...args)` in the child (`src/main/extensions/host-child.ts`).
- The manifest currently declares `permissions: ["fs:read", "external:open"]`
  with `fsRoots: ["~/.zana"]`. Adding `fs:write` re-triggers the P3-D consent
  screen — the user re-approves "Zana" with write access **scoped to `~/.zana`**.

Because the broker realpath-confines every write to `~/.zana`, a
renderer/agent-supplied path can never escape that root (Rules 1 & 2). The
filename is additionally derived host-side (see §4), never taken as a path from
the renderer.

## On-disk schema (verified against all 11 real `~/.zana/teams/*.json`)

The **source of truth is `slots`**; several sibling fields are **derived** and
must be kept consistent on write. Verified formulas (held for every file,
including the UUID-based `core-dev-squad`):

```
{
  "id":                    "<slug>",                 // = filename stem
  "name":                  "Backend Squad",
  "icon":                  "⚙️",
  "description":           "…",
  "orchestratorProfileId": "orchestrator",
  "slots": [ { "profileId": "architect", "quantity": 1 }, … ],   // SOURCE OF TRUTH
  "initialPrompt":         "…",
  "rules": {
    "maxConcurrentWorkers": 4,          // user-editable, INDEPENDENT of totals
    "autoRestart":          false,      // preserved round-trip (not in this UI)
    "requireApproval":      false       // preserved round-trip (not in this UI)
  },
  "updatedAt":       "2026-06-21T05:37:15.961Z",      // stamped on save
  "workerProfileIds": ["architect","backend-dev","test-writer"],  // DERIVED
  "autoStart":        false,                          // user-editable
  "dynamicSpawning":  false,                          // preserved round-trip
  "maxTotalWorkers":  4                               // DERIVED
}
```

Derived-field rules (proven across all files):

- `workerProfileIds` = **distinct** slot `profileId`s, in first-seen order.
- `maxTotalWorkers` = **Σ of slot `quantity`** (NOT `rules.maxConcurrentWorkers`
  — e.g. `core-dev-squad` is 7 total but 4 concurrent).
- `rules.maxConcurrentWorkers` is **independent** and user-editable.
- Fields the UI does not expose (`description` we DO expose; `autoRestart`,
  `requireApproval`, `dynamicSpawning`, and any unknown top-level keys) are
  **preserved round-trip** — read, held, written back unchanged.

## Approach (chosen: A — inline editor inside the Teams tab)

Make the Teams tab editable in place: each team row gets an **Edit** action, a
**"+ New team"** button sits above the list, and both open a **`TeamEditorView`**
form rendered within the panel. Save goes through one new main handler
(`saveTeam`) that owns all normalization and the single `ctx.fs.writeFile` seam.

**Rejected alternatives:**
- **B — open the raw JSON in an editor.** Minimal build, but exposes the
  derived-field footguns (a user who edits `slots` but not `workerProfileIds`
  produces an inconsistent file). Rejected — the whole point is to hide that.
- **C — deep-link to the app-native `TeamEditor`.** Wrong store and schema
  (`~/.zcc` vs `~/.zana`); would edit the wrong "team". Rejected.

## Components & data flow

### 1. Manifest (`extensions/zana-hub/extension.json`)

Add `"fs:write"` to `permissions` (keep `fsRoots: ["~/.zana"]`):

```json
"permissions": ["fs:read", "fs:write", "external:open"]
```

Re-triggers consent on next load. No `fsRoots` change — write stays scoped to
`~/.zana`.

### 2. Shared types (`extensions/zana-hub/src/shared/types.ts`)

Add fuller shapes alongside the existing thin `ZanaTeamSummary` (which the
Overview/list keep using):

```ts
/** One roster slot. */
export interface ZanaTeamSlot { profileId: string; quantity: number; }

/** The full editable template returned by getTeam / accepted by saveTeam. */
export interface ZanaTeamTemplate {
  id?: string;                 // absent = create (slug minted from name)
  name: string;
  icon?: string;
  description?: string;
  orchestratorProfileId?: string;
  slots: ZanaTeamSlot[];
  initialPrompt?: string;
  maxConcurrentWorkers?: number;   // → rules.maxConcurrentWorkers
  autoStart?: boolean;
}

/** A profile option for the dropdowns. */
export interface ZanaProfileOption { id: string; displayName: string; icon?: string; }

/** saveTeam result. */
export type SaveTeamResult =
  | { ok: true; id: string }
  | { ok: false; error: string };
```

The `getTeam` return additionally carries the **preserved round-trip blob** (the
raw parsed object) so `saveTeam` can merge onto it; see §3.

### 3. Main module (`extensions/zana-hub/src/main/index.ts`) — three handlers

Extend the local `FsCap` type with `writeFile(path, data): Promise<void>`.

- **`getTeam(id: string): Promise<{ template: ZanaTeamTemplate; raw: unknown } | null>`**
  Reads `~/.zana/teams/<id>.json`, returns the full editable projection AND the
  raw parsed object (for round-trip preservation on save). `id` is basename-guarded
  (reject `/`, `..`, empty) before building the path — defense in depth on top of
  the broker's realpath confinement. Returns `null` if absent/malformed.

- **`listProfiles(): Promise<ZanaProfileOption[]>`**
  Reads `~/.zana/profiles`, returns `{id, displayName, icon}` for each. Reuses the
  existing bounded `readJsonDir`. Used to populate the slot & orchestrator
  dropdowns.

- **`saveTeam(input: ZanaTeamTemplate): Promise<SaveTeamResult>`** — the single
  write seam. Steps, all host-side:
  1. **Validate:** `name` non-empty; `slots` an array of `{profileId non-empty,
     quantity ≥ 1 integer}`; `maxConcurrentWorkers` (if present) a positive
     integer. On failure → `{ ok:false, error }` (never throws).
  2. **Resolve id/filename (§4):** edit → preserve `input.id`; create → mint a
     unique slug from `name`.
  3. **Merge onto round-trip base:** for an edit, start from the raw object read
     by `getTeam` (so `autoRestart`/`requireApproval`/`dynamicSpawning`/unknown
     keys survive); for a create, start from `{}`.
  4. **Normalize derived fields:** set `slots`; `workerProfileIds` = distinct
     slot ids; `maxTotalWorkers` = Σ quantities; `rules.maxConcurrentWorkers` =
     `input.maxConcurrentWorkers ?? existing ?? Σ quantities`; `autoStart`;
     `id`; `updatedAt` = current ISO time (`new Date().toISOString()` — allowed
     in the extension child, unlike in workflow scripts).
  5. **Write:** `ctx.fs.writeFile(join(ZANA_ROOT,'teams',`${id}.json`),
     JSON.stringify(merged, null, 2))`. The broker realpath-confines to
     `~/.zana`. Return `{ ok:true, id }`.

  Factor steps 1 & 4 into a **pure `normalizeTeam(input, base)`** helper (no fs)
  so it is unit-testable in isolation.

### 4. New-team id — slug from name

`slugify(name)` → lowercase, spaces→`-`, strip non `[a-z0-9-]`, collapse repeats
(`"Backend Squad"` → `"backend-squad"`). On collision with an existing
`teams/*.json` stem, append `-2`, `-3`, … Collision is detected by listing the
teams dir (already available). `id` is **immutable after creation** — renaming
the team keeps the filename. An empty/degenerate slug falls back to `team`.

### 5. Profile pickers — dropdown only

Slot `profileId` and `orchestratorProfileId` are `<select>`s populated from
`listProfiles()`. **Unknown-profile edge case:** an existing team may reference a
profileId with no matching profile file (the UUID-based `core-dev-squad` does).
The editor injects a synthetic disabled-looking option **`⚠ unknown: <id>`** for
any such referenced id so editing never silently drops or rewrites that slot; the
id round-trips untouched unless the user changes it.

### 6. Renderer panel (`extensions/zana-hub/src/renderer/panel.tsx`)

Built with injected `h = React.createElement` (NO JSX — it would compile to an
unresolvable jsx-runtime import in the blob-imported bundle), matching the
existing panel.

- **List mode (default):** the existing `TeamsView`, plus (a) a **"+ New team"**
  button above the rows, and (b) an **Edit** button on each `Row` (`right` slot,
  next to the auto-start chip).
- **Edit mode:** a **`TeamEditorView`** form with local `useState`:
  - Name (text, required), icon (text), description (textarea).
  - Orchestrator (dropdown).
  - **Slots:** a list of rows — profile dropdown + quantity stepper (min 1) +
    remove button; an "Add slot" button appends. At least one slot required to
    save.
  - Initial prompt (textarea).
  - Max concurrent workers (number).
  - Auto-start (checkbox).
  - **Save** / **Cancel**.
- **Wiring:** panel holds `editing: ZanaTeamTemplate | 'new' | null`. Opening
  Edit calls `getTeam(id)` to load; New seeds an empty template. On Save →
  `host.call('saveTeam', input)`; on `{ok:true}` re-run `overview()` (refreshes
  the list + nav badge) and return to list mode; on `{ok:false}` show the inline
  error and keep the form open. `listProfiles()` is fetched once when the editor
  opens (or cached on the panel).

## Error / edge handling

- **Missing `fs:write` grant** (user declined re-consent): `saveTeam`'s
  `ctx.fs.writeFile` rejects with a PermissionDenied-tagged error; the handler
  catches it and returns `{ ok:false, error: 'write permission not granted' }`,
  surfaced inline. No crash.
- **Malformed / deleted team on Edit:** `getTeam` returns `null` → editor shows
  "template no longer readable" and returns to list.
- **Slug collision:** resolved silently by suffixing (§4).
- **Unknown profileId in an existing team:** preserved via the synthetic option
  (§5).
- **Daemon writes the same file concurrently:** see §Known limitations.
- **Validation failures:** returned as `{ ok:false, error }`, shown inline; the
  file is never touched.

## Known limitations (documented, not engineered)

The Zana daemon owns `~/.zana/teams`. These are human-edited templates and
writes are rare, so we accept a **plain `ctx.fs.writeFile`** (no tmp+rename, no
cross-process lock). A simultaneous daemon write is a last-writer-wins race with
a tiny window; building cross-process locking is out of scope. (Note: the app's
own shared-file rule — atomic tmp+rename + in-process mutex — governs files the
*app* owns; `~/.zana/teams` is the daemon's, and the brokered `writeFile` is a
direct write. If Zana later adds a lock protocol, revisit.)

## Testing

- **`normalizeTeam` unit tests** (pure, no fs): derived `workerProfileIds`
  (distinct, order-preserving, dedup), `maxTotalWorkers` = Σ quantities,
  `rules.maxConcurrentWorkers` independence, round-trip preservation of unknown
  keys (`autoRestart`/`dynamicSpawning`), `updatedAt` stamping, and validation
  rejections (empty name, empty slots, quantity < 1).
- **`slugify` + collision** unit tests: spaces/case/punctuation → slug; empty →
  `team`; `-2/-3` suffixing on collision.
- **Panel render test** (if the extension has a renderer test harness): list mode
  shows New + per-row Edit; opening the editor renders slot rows; Save calls
  `saveTeam` with the normalized shape; unknown-profile slot surfaces the
  synthetic option.

## Non-goals

- **No delete** of team templates.
- **No editing** of profiles or skills (still read-only tabs).
- **No launching** a team from this UI (`/zana:team` remains the run path).
- **No cross-process locking** (see Known limitations).
- **No changes** to the app-native `TeamEditor.tsx` / `~/.zcc` teams.
