# Zana → Core merge — migration & rollback notes

> **SUPERSEDED (2026-07): the UI move was reversed.** The zana ticket/sprint UI
> is once again a disk extension — `zana-tickets` — NOT a core WorkspaceMode.
> See **[Re-extraction: core UI → `zana-tickets` disk extension](#re-extraction-core-ui--zana-tickets-disk-extension)**
> at the bottom for what changed. The sections below document the intermediate
> merged state for historical context and as the rollback target's origin; where
> they describe core-resident tickets UI, read them as "the state before the
> re-extraction." The main-side SQLite layer (`zanaMainModule`) is unaffected by
> both moves — it has stayed a core built-in throughout.

The zana→core merge (epic `zana-core-merge`, tickets **A1–D6**) folded the zana
ticket/sprint UI out of a sidebar extension and into **core**, while keeping
zana's trusted main-side SQLite layer in place. This doc records what moved, what
stayed, what was dropped, and how to roll the UI move back if needed.

Design artifacts (read in this order — **the validation supersedes the design
wherever they differ**):

- Design: artifact `1d75b8e4-c7e2-4513-9ee2-66ddeacbf08a`
- Validation: artifact `c9f8df82-5906-4a90-9f93-f09878755602`

---

## Migration note

### What moved (extension UI → core)

- The zana **sidebar panel / `AppModule`** became a per-project **Tickets
  WorkspaceMode** inside core's Projects view. It is no longer a top-level nav
  entry backed by a plugin panel; it is a workspace mode scoped to the active
  project.
- The panel's React surface was lifted into core components:
  - `ZanaPanel` → `src/renderer/components/ProjectTicketsView.tsx` (KPI strip +
    kanban, plus the `ProjectTickets/*` sub-views: Sprints, Docs, Profiles).
  - `ZanaDetailModal` → `src/renderer/components/ProjectTickets/TicketDetailModal.tsx`.
  - `ZanaAssign` (assign picker + optimistic-assign/undo) → ported into the core
    store + the detail modal.
  - `ZanaSettings` (the `@zana-ai/mcp` version check) → folded into core's
    `SettingsPanel` via `ticketsApi.getVersionInfo()`.
- Core reaches zana's capabilities through a single quarantined seam:
  `src/renderer/util/ticketsApi.ts`. This is the **only** renderer site allowed
  to name the `'zana'` module id (CLAUDE.md Rule 6); every view/store imports
  `ticketsApi.*`, never `getHost('zana')` / `window.cc.modules`. The B4 guard
  (`src/renderer/__tests__/rule6-zana-literal.guard.test.ts`) enforces this.

### What stayed (zana is still the trusted main-capability provider)

- **`zanaMainModule` stays registered in `MAIN_MODULES`** (`src/main/modules/index.ts`)
  as a main-only built-in (no `AppModule`, not in `APP_MODULES`). The permission
  broker still bypasses it (it uses native `better-sqlite3`, which can't cross the
  disk-extension `utilityProcess` isolation boundary).
- The SQLite read/write layer survives in `plugins/zana/main/`:
  `zana-db.ts` + `zana-main.ts`. **The DB-first / JSON-fallback read path is
  retained** — `readTickets` reads from the SQLite DB (`readTicketsFromDb`) when
  the native driver and a `tickets.db` are present, and otherwise falls back to
  the legacy `tickets/<uuid>/ticket.json` tree (`readTicketsFromJson`). The merge
  dropped the *panel*, **not** the fallback.
- **Global agent Profiles** remain global-only (`~/.zana`), surfaced by the
  Profiles sub-tab and the `{ kind: 'global' }` source.
- The **Rule-5 read bound** is intact: `MAX_TICKETS` + the SQL `LIMIT ?` on the
  `ORDER BY updatedAt DESC` list query keep the per-project read bounded on the
  Electron main thread (guarded by `plugins/zana/main/zana-db.test.ts`).

### What was dropped

- The per-project **Global ticket/sprint source rail** (multi-source switcher).
  The per-project view takes its scope from the active `Project` prop, so it never
  rebuilds a multi-source rail.
- The `selectedSourceId` storage key (retired by D1; see rollback note).
- The `probeProjects` / `listSources` / source-switch capabilities as a *live*
  path. (The thin `ticketsApi.listSources` / `ticketsApi.probeProjects`
  marshallers are retained but currently unconsumed — see the note in
  `src/renderer/util/ticketsApi.ts`. They were not deleted to avoid mutating B2's
  contract-locked surface.)

---

## Rollback / feature-flag note

There is no runtime feature flag for the UI move — it is a structural lift. To
revert the **UI** move, `git revert` the two Sprint-D UI commits **in
reverse-merge order** (D3 is `blockedBy` D2, so revert D3 first):

1. **Revert D3 first** (commit `ebef91ff`) — this re-adds `plugins/zana/renderer/*`
   (`ZanaPanel.tsx`, `ZanaDetailModal.tsx`, `ZanaAssign.tsx`, `ZanaSettings.tsx`)
   and `plugins/zana/module.ts`, and restores the dead `probeProjects` /
   `listSources` / source-switch main capabilities.
2. **Then revert D2** (commit `bb7c67fe`) — this re-adds `zanaModule` to
   `APP_MODULES` (`src/renderer/modules/index.ts`) so the renderer panel mounts
   again as a sidebar nav entry.

> The commit hashes above are the epic's canonical references. If the local
> branch squashed/rebased the sprints, map them by sprint label (Sprint D, D2/D3)
> rather than by raw hash.

### Things a rollback must tolerate

- **D1's storage-key migration is forward-only.** D1 renamed the panel prefs keys
  (`activeTab` / `autoRefresh` / `collapsedColumns`) and **retired
  `selectedSourceId`**. A rollback must tolerate the old keys being absent — the
  restored panel simply falls back to its defaults (the keys are read at
  `ZanaPanel.tsx:60-70` in the restored file). Do **not** also revert D1 to
  "restore" the keys; let the panel default.
- **The shared `gus-*` CSS** is untouched by the rollback (the merge deliberately
  did not rename it). See CLAUDE.md → *Coupling notes*.

### Do NOT revert the Sprint-A security fixes

The Sprint-A hardening is **independent of the UI lift** — it hardens
`zanaMainModule`, which **survives** any UI rollback. A UI rollback must **not**
drag these back out:

- **A3 — `resolveProjectRoot` path confinement.** Realpath-matches a renderer-
  supplied `projectPath` against a registered project (or the fixed
  `realpath(HOME)/.zana` anchor) and **throws** on an unregistered/escaping path —
  no silent global fallback. (Rules 1–2.)
- **A4 — `opts.id` validation** on the source-resolution path.
- **A5 — the per-file in-process write mutex** on the JSON `assignTicket` write
  (atomic + serialized read-modify-write). (Rule 4.)
- **A6 — `sanitizeExtraArgs`** in MAIN for launch args.

These live below the UI seam and have no dependency on whether the renderer
surface is a panel or a workspace mode. Reverting them with a UI rollback would
re-open the confinement/validation/serialization holes Sprint A closed.

---

## Re-extraction: core UI → `zana-tickets` disk extension

**2026-07.** The UI move documented above was reversed: the ticket/sprint
renderer surface was extracted out of core again, this time into a first-class
**disk extension** named `zana-tickets` (id `zana-tickets`, title "Zana"). This
was NOT a git rollback of the merge — the merged code had evolved (D1 prefs, C5
per-project probe, D5 KPIs) — but a fresh extraction that preserves that
evolution while making **core fully zana-free**.

### What moved (core UI → extension)

- **Renderer sources → `plugins/zana/renderer/*`** (the extension's build
  source): `ProjectTicketsView.tsx` (now a `{ host }`-driven panel that derives
  its project from `host.getActiveProject()`), `TicketDetailModal.tsx` (takes
  `host`; uses `host.launchSession` / `host.toast` / `host.listProjects`),
  `ticketsStore.ts`, `ticketsApi.ts`, `zanaPrefs.ts`, `ticketColumns.ts`, the
  `Sprints/Docs/Profiles` sub-views, plus a new local `Markdown.tsx` and
  `VersionSettings.tsx`. Their tests moved alongside into
  `plugins/zana/renderer/__tests__/`.
- **The `@zana-ai/mcp` version check → the extension's own `settingsPanel`**
  (`VersionSettings.tsx`). Core's `SettingsPanel` `ZanaVersionSection` +
  `versionState` were deleted.
- **Extension shell → `extensions/zana-tickets/`**: manifest
  (`projectTab.global: false` — project-tab-only, no sidebar entry), the
  react/jsx-runtime shims + `host-react.ts` (host-React capture, copied from the
  gus extension), `renderer-entry.tsx` (`activate({ React }) → { panel,
  settingsPanel }`), and the vite/pack/dev scripts.

### The transport pivot (the key difference from the merge)

The merge reached zana via a **core** quarantine seam,
`src/renderer/util/ticketsApi.ts`, using `getHost('zana').call(cap, opts)`. That
seam is **deleted**. The extension instead reaches the `zana` built-in through
the generic module bus from its OWN seam (`plugins/zana/renderer/ticketsApi.ts`):

```
window.cc.modules.call('zana', capability, [arg])   // args forwarded as an array; main does fn(...args)
```

`ModuleRouter` routes a built-in id straight to the in-process `MainModuleHost`
(built-ins are never broker-gated), and MAIN re-resolves every source path
(`resolveProjectRoot`/`resolveSource`) — so `projectPath`/`useGlobal` remain
advisory hints (Rules 1–2). Use `window.cc.modules.call(...)`, **not**
`host.call(...)`: `host` binds to the extension's OWN id (`zana-tickets`), while
the DATA lives under the `zana` built-in id.

### What stayed in core

- **`zanaMainModule` is still registered in `MAIN_MODULES`** — unchanged. Native
  `better-sqlite3` cannot cross the extension `utilityProcess` boundary, so the
  trusted read/write provider stays a main-only built-in. The extraction moved
  ONLY the renderer surface. (`src/main/__tests__/core-extension-separation.guard.test.ts`
  still asserts `zanaMainModule` is registered and no disk-extension source is
  imported into the registry.)
- **The shared `gus-*` / `zana-*` CSS** stays in core `src/renderer/styles/global.css`.
  The extension bundles no CSS; its panel mounts into the host document
  (`.module-panel-slot`) so those classes cascade in — same pattern as the `gus`
  extension. Do NOT delete those class defs as "unused." (CLAUDE.md → shared-CSS
  coupling note.)

### Core is now fully zana-free (guard change)

- The `'tickets'` `WorkspaceMode` literal is gone from the renderer store,
  `ProjectScopedNav`, `Workspace`, and the palette. `normalizeConfig`'s
  `workspaceModes` filter was relaxed from a fixed 5-literal value-allowlist to
  **shape-only (any non-empty string)** so an opaque extension-id project view
  (e.g. `"zana-tickets"`) round-trips — the old whitelist had also been silently
  dropping `goals`/`followups`/`feed`. (`src/main/store.ts`; guarded by
  `store.test.ts`.)
- The Overview KPI line (`TicketsKpiLine`) and the `action:zana-status` palette
  command were removed from core.
- **Rule-6 guard repurposed**: `src/renderer/__tests__/rule6-zana-literal.guard.test.ts`
  no longer allowlists a `ticketsApi.ts` seam — it now asserts the `'zana'`
  literal appears in `src/renderer/**` code **nowhere at all**.

### Rolling THIS back

Uninstall/disable the `zana-tickets` extension to hide the UI; the main module and
DB are untouched. To restore the core-resident UI, revert this extraction's
commit(s) — the pre-extraction merged state (this doc's upper sections) is the
target. The main-side layer and the Sprint-A hardening are unaffected either way.
