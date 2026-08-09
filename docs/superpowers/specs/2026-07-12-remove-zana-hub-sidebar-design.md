# Remove the global "Zana" sidebar entry (zana-hub) — Design

**Date:** 2026-07-12
**Status:** Approved (design), pending implementation plan

## Goal

Remove the global **"Zana"** sidebar entry — the `zana-hub` disk extension —
from the app, because it is no longer needed. Keep the extension's source in the
repo (dormant, re-enableable), but stop it being seeded/packaged and remove the
live runtime copy so the sidebar entry disappears.

## Scope — what "the zana tab" means here

The repo has **two** independent UI surfaces both labeled "Zana" (a legacy of the
zana→core merge that split the old zana panel). This spec removes **only the
first**:

1. **REMOVE — global sidebar "Zana"** = the `zana-hub` disk extension. A
   cross-project `~/.zana` dashboard (Overview / Teams / Profiles / Skills /
   Runs) that appears in the left sidebar under the "Extensions" heading. Panel
   header renders `'Zana — global'`.
2. **KEEP — per-project "Zana" tab** = `WorkspaceMode 'tickets'` /
   `ProjectTicketsView` inside each project's workspace (tickets/sprints/docs/
   profiles). Backed by the live core `zanaMainModule` via the `ticketsApi` seam.
   **Untouched by this spec.**

### Explicitly NOT touched

- The per-project "Zana" tab (`Workspace.tsx`, `ProjectTicketsView.tsx`,
  `ProjectTickets/*`, `WorkspaceMode 'tickets'`).
- The core `zanaMainModule` (`MAIN_MODULES`), `plugins/zana/main/*`, and the
  quarantined `src/renderer/util/ticketsApi.ts` seam.
- The `zana_*` MCP tools (agent-facing, not a tab).
- The Settings → "Zana" version section (`SettingsPanel.tsx` `ZanaVersionSection`).
- The shared `gus-*` CSS classes (used by both the per-project tab and the GUS
  extension — a documented coupling).
- `~/.zana` daemon data (read by the surviving per-project tab and the daemon).

## Background — how zana-hub is installed (the mechanics that constrain the design)

Three physical copies, and **no hardcoded seed list anywhere** — every path is
directory-driven (engineering Rule #6: the seeders are extension-agnostic):

| Copy | Path | Role |
|---|---|---|
| SOURCE | `extensions/zana-hub/` | TS source, built by its own Vite config. `dist/` is git-ignored. |
| SEEDED artifact | `examples/extensions/zana-hub/` | Committed, prebuilt `extension.json` + `main.mjs` + `renderer.js`. The canonical shipped form. |
| RUNTIME install | `~/.zcc/extensions/zana-hub/` | What discovery scans/loads at runtime. Not in repo. |

**Two seeders regenerate it — both must be addressed:**

1. **Boot seeder** — `seedBundledExtensions` (`src/main/extension-installer.ts:216`),
   called at `src/main/index.ts:4577`. Copies each dir under `bundledRoot()`
   (`examples/extensions/` in dev; `process.resourcesPath/extensions` when
   packaged) into `~/.zcc/extensions/<id>` when nothing is installed or the
   bundled version is strictly newer. Deleting `examples/extensions/zana-hub/`
   removes it from this set.
2. **Dev seeder** — `scripts/seed-extensions.mjs`, run on every `predev` /
   `prestart` (root `package.json:16,18`). Scans `extensions/*` for any dir whose
   `package.json` has **both** a `build` and a `package` script (line 40), then
   **rebuilds from source** and rewrites *both* `examples/extensions/zana-hub/`
   AND `~/.zcc/extensions/zana-hub/` (via `extensions/zana-hub/scripts/package.mjs`).

**Consequence:** merely deleting the two copies is not enough — the next
`npm run dev` rebuilds zana-hub from source and both copies reappear. To keep the
source in-tree yet dormant, the dev seeder's skip condition must be tripped for
zana-hub.

**Production packaging:** `electron-builder.yml:42-43` copies `examples/extensions`
→ `extensions` generically. Removing `examples/extensions/zana-hub/` is therefore
sufficient to drop it from packaged builds — no electron-builder edit needed.

## Approach (chosen)

**Removal depth:** stop seeding + uninstall runtime, keep source in-tree
(re-enableable). Rejected alternatives: full source deletion (loses the dormant
in-tree code the user wants kept); disable-only via consent (leaves the sidebar
entry visible).

### Repo changes (committed) — 2

**Change A — trip the dev seeder's skip for zana-hub.**
In `extensions/zana-hub/package.json`, rename the `"package"` script key to
`"package:disabled"` (body unchanged):

```json
    "build": "npm run build:renderer && npm run build:main",
    "package:disabled": "node scripts/package.mjs",
    "typecheck": "tsc --noEmit -p tsconfig.json"
```

The dev seeder gate is `if (!scripts.build || !scripts.package) continue;` — with
no `package` script, `seed-extensions.mjs` skips zana-hub entirely. The source
stays fully in-tree and buildable (`build`, `typecheck` untouched). Re-enabling
later is a one-word rename back to `"package"`. This edit is confined to the
extension's own manifest; the shared seeder code names no ids (Rule-6 safe).

**Change B — delete the committed seeded artifact.**
Remove the directory `examples/extensions/zana-hub/` (3 files: `extension.json`,
`main.mjs`, `renderer.js`). This stops the boot seeder from installing it and
drops it from packaged builds (electron-builder copies this dir verbatim).

### Runtime cleanup (local machine, NOT committed) — 2

These make the sidebar entry disappear on the current dev machine. They are
operator steps, not repo changes:

1. `rm -rf ~/.zcc/extensions/zana-hub` — removes the live discovered copy.
2. Remove the `"zana-hub"` key from `~/.zcc/extensions/consent.json` (currently
   grants `fs:read`, `fs:write`, `external:open`). Hygiene: a future reinstall
   re-prompts for consent instead of silently inheriting the grant. Edit
   atomically (read-modify-write the JSON, preserving the other extensions'
   entries). No KV purge needed — `~/.zcc/modules/zana-hub.json` does not exist.

### Why not touch the shared seeders or discovery

The boot seeder, dev seeder, discovery, and packaging are all deliberately
id-agnostic (Rule #6). Editing them to special-case zana-hub would violate that
invariant and is unnecessary — directory presence + the per-extension `package`
script key fully control seeding.

## Invariants / tests

- **`src/main/__tests__/core-extension-separation.guard.test.ts`** — continues to
  pass. It asserts zana-hub is *absent* from `MAIN_MODULES` (line 255, an absence
  check) and that `extensions/` exists with >0 dirs (satisfied by the surviving
  `gus`, `cu`, `consensus`, and the kept zana-hub source). It also asserts
  `seed-extensions.mjs` is predev/prestart-only — unaffected.
- **`extensions/zana-hub/src/__tests__/*` (5 files)** — the extension's own unit
  tests stay green; we keep `src/` and only rename a script key.
- **`e2e/extensions-panel-layout.spec.ts`** — generic (asserts panel layout, not
  a specific extension). Unaffected.
- **No new guard test** asserting zana-hub's absence — that would contradict the
  "keep it re-enableable" decision.
- **Known-stale comment (non-blocking):** `core-extension-separation.guard.test.ts:239`
  has a *comment* listing "zana-hub" among runtime-loaded disk extensions. After
  this change zana-hub is dormant (not seeded/discovered), so the comment is
  slightly stale — but it is a comment, not an assertion, and the test still
  passes. Optionally tidy the comment during implementation; not required.

## Verification (manual, post-change)

1. Grep confirms no committed `examples/extensions/zana-hub/` remains and
   `extensions/zana-hub/package.json` has `package:disabled`, not `package`.
2. `npm run dev` (or `start`): predev seed runs and does **not** recreate
   `examples/extensions/zana-hub/` or `~/.zcc/extensions/zana-hub/`.
3. In the running app: the left sidebar "Extensions" group shows only
   consensus / cu / gus — **no "Zana"** entry.
4. The per-project "Zana" tab still opens and renders tickets/sprints (KEEP
   surface unaffected).
5. `npm run typecheck` exits 0; targeted test files above pass.

## Rollback / re-enable

- Restore `examples/extensions/zana-hub/` (from git history) and rename
  `package:disabled` → `package` in `extensions/zana-hub/package.json`. The next
  `npm run dev` rebuilds and re-seeds it; the boot seeder reinstalls it into
  `~/.zcc/extensions/`. Consent re-prompts on first activation.
