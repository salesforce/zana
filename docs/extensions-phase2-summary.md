# Phase 2 — Extension Host API: Change Summary (P2-D integration gate)

Branch: `feat/extensions-phase1`. Reviewer-facing summary of the Phase 2 work
(built by P2-A/B/C) plus the cache-eviction fix, dogfood, integration gate, and
docs owned by P2-D.

## What Phase 2 delivers

Three additions to the extension host surface, on top of Phase 1's runtime
loading:

1. **`host.on(event, cb)`** — typed subscriptions to read-only host events
   (project/nav/session/inbox/schedule/mcp/skills), returning an unsubscribe fn.
2. **`host.cache`** — synchronous, in-memory, per-module scratch store that
   survives panel unmount (the documented alternative to a module-global
   `let cache`).
3. **Contributions** — `AppModule.commands` (command-palette entries) and
   `AppModule.navBadge` (sidebar badge); `AppModule.panel` is now **optional**.

## Files by area

### SDK (`@zana-ai/zcc-extension-sdk`)
- `packages/extension-sdk/src/renderer.ts` — new `SessionInfo`, `HostEvents`,
  `ExtensionCommand` interfaces; `ModuleHost.on` + `ModuleHost.cache` added;
  `AppModule.panel` made **optional**; `AppModule.commands?` and
  `AppModule.navBadge?` added.
- `packages/extension-sdk/src/index.ts` — re-exports `HostEvents`, `SessionInfo`,
  `ExtensionCommand`.

### Renderer host
- `src/renderer/modules/host.ts` — implements `on` (one `switch` mapping each
  event to the matching `window.cc.*` `on*` stream or a vanilla store
  subscription for project/nav; unknown event → no-op unsubscribe) and `cache`
  (module-scoped `Map`, so the cache is shared across host re-creation for an
  id). Exports `clearModuleCache(moduleId)`.
- `src/renderer/modules/sessionInfo.ts` — pure `toSessionInfo` mapper
  (core session → SDK `SessionInfo`), unit-tested.

### Shell
- `src/renderer/components/CommandPalette.tsx` — merges each merged module's
  `commands(host)` into the palette as `PaletteItem`s, keys namespaced
  `ext:<id>:<cmd>`, hinted by module title, per-module + per-run throw-isolated;
  command `keywords` scored at half weight.
- `src/renderer/components/Sidebar.tsx` — evaluates `navBadge(host)` per module
  (throw-isolated), renders it in the `.nav-badge` slot (number clamps to `99+`;
  `null`/`0`/`''` → no badge).
- `src/renderer/modules/ModulePanelHost.tsx` — guards the now-optional panel
  (panel-less module → `.module-no-panel` placeholder, keeps its nav entry);
  **cache-eviction fix** (below).
- `src/renderer/styles/global.css` — `.module-no-panel` / `.module-no-panel-hint`.

### Sample / built-in (dogfood)
- `examples/extensions/hello/renderer.js` and its source
  `tools/create-zcc-extension/sample-hello/panel.tsx` — extended to exercise
  `host.on('project:changed')` (live re-render) and `host.cache` (mount counter
  + last-seen project list).
- `plugins/gus/module.ts` — built-in module gains one `commands` entry
  (`GUS: say hi` → `host.toast`) and a `navBadge` (open-project count).

### Docs
- `docs/extensions-authoring.md` — new sections for `host.on` (event table +
  payloads + unsubscribe-in-cleanup), `host.cache` (vs `host.storage`), and
  `commands`/`navBadge` contributions (panel-optional + the runtime-bundle
  caveat).
- `docs/extensions-phase2-summary.md` — this file.

## New SDK exports

`SessionInfo`, `HostEvents`, `ExtensionCommand` (types); `ModuleHost.on`,
`ModuleHost.cache`, `AppModule.commands`, `AppModule.navBadge`, and the now-
optional `AppModule.panel`.

## The cache-eviction fix

P2-B exported `clearModuleCache(moduleId)` from `host.ts` but nothing called it,
so a disabled/removed extension's `host.cache` `Map` leaked. Fixed in
`src/renderer/modules/ModulePanelHost.tsx`: `evictHost(moduleId)` now also calls
`clearModuleCache(moduleId)` (imported from `./host`), so the cache lifecycle
matches the host's — the loader already calls `evictHost` for extensions that
drop out. No other call site needed changing.

## What was dogfooded (and the commands/navBadge decision)

The Phase 2 surface is exercised by real code:

- **`host.on` + `host.cache` — via the runtime `hello` sample.** The panel
  subscribes to `project:changed` and re-renders its project list live, caches
  the last-seen list (paints instantly on remount) and a mount counter that
  survives unmount. This proves the new event/cache APIs over the real runtime
  blob-import path.
- **`commands` + `navBadge` — via the built-in `gus` module, NOT a runtime
  bundle.** Reason: these contributions live on the `AppModule`, but a
  runtime-loaded extension's `RendererEntry.activate()` returns only the panel
  component, and `loader.ts` builds the `AppModule` from the manifest + that
  panel (`{ id, title, icon, titleLabel, panel }`) — it carries no
  `commands`/`navBadge`. Wiring a bundle to export command/badge factories means
  changing the `RendererEntry` contract + the loader + every bundle, which is
  beyond P2-D's "prove + one loose end" scope. So per the ticket's option (b),
  commands/navBadge are dogfooded on a built-in (proving the CommandPalette and
  Sidebar shell wiring end-to-end), and the runtime bundle covers `on`/`cache`.
  The authoring doc states this limitation and flags the loader extension as a
  follow-up.

## Gate results

| Command | Result |
|---|---|
| `npm run typecheck` | **green** (exit 0) |
| `npm run test` | **294 passed / 294** (24 files) |
| `npm run build` | main + preload + renderer all built |
| main bundle React-free | **yes** — `out/main/index.js` has no `react-dom`/`react/jsx-runtime`/`createElement`/hooks |

## Note for the reviewer (state on arrival)

The Phase 2 source from P2-A/B/C was present as a `git stash` (plus untracked
`sessionInfo.ts` / its test), not applied to the working tree. P2-D restored the
Phase 2 files from that stash and then did its own work on top. Unrelated
in-flight work (a `better-sqlite3`-backed `plugins/zana` change:
`plugins/zana/main/zana-main.ts` + untracked `plugins/zana/main/zana-db.ts`,
plus the `better-sqlite3` dependency) is **not** part of Phase 2 and was left
untouched; it is internally consistent and typecheck-clean, but the reviewer
should scope it out of the Phase 2 review.
