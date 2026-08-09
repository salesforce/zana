# Extensions → SDK/API: Team Findings

**Question:** Let third parties build "Extensions" for ZCC against a stable **SDK/API**, with *no direct dependency on core code*.

**Verdict in one line:** The hard part is already done — the runtime contract (`ModuleHost` + capability dispatch) is well-designed and genuinely decoupled. What's missing is **delivery** (extensions are still compiled into core), a **published SDK package**, and — the real gate — a **trust/permission boundary** for untrusted code. This is a contained, high-leverage change, not a rewrite.

A 4-engineer team analyzed the codebase: Principal Architect (contract & package), Build/Runtime, Security, and Product/DX.

---

## DECISION (2026-06-12): Curated-first, open-capable

**Build a curated extension set now; keep the architecture open-capable for later.** Extensions are vetted (as trusted as gus/zana are today), so the Phase 3 trust boundary is **deferred**. Phases 0–2 are built as-is.

Two forward-compatibility rules so opening up later is additive, not breaking:

1. **Declare permissions in the manifest from day one — don't enforce them yet.** The `permissions` field ships now (cheap); enforcement is the deferred Phase 3 work. Retrofitting permissions onto extensions that never declared them means chasing every author later; declaring-now/enforcing-later makes opening up a matter of *adding enforcement to data that already exists*.
2. **Extensions reach privileged ops through `MainModuleContext`, not by importing `child_process`/`fs` directly.** (gus/zana currently shell out directly — change this pattern for new extensions.) That way the future capability broker is a transport swap invisible to extension authors, not an API change.

Everything else (SDK package, disk loading, richer API) is identical for curated vs. open — only *who writes files into the extensions dir* differs.

---

## What exists today

There is already an internal "module" system (`plugins/gus`, `plugins/zana`) with a deliberately narrow contract:

- `src/shared/module-api.ts` — renderer contract: `AppModule` (id/title/icon/panel), `ModuleHost` (the capability bridge).
- `src/shared/module-main.ts` — main contract: `MainModule.setup()` → capability map.
- A **generic IPC multiplexer**: any `{moduleId, capability, args}` routes through one channel (`modules:call`) → `MainModuleHost.dispatch`. A new module adds **zero** core IPC wiring.
- Per-module namespaced storage, atomic writes, per-module setup-failure isolation.

```
panel ─host.call('listWork',opts)─► window.cc.modules.call('gus','listWork',[opts])
      ─► modules:call IPC ─► MainModuleHost.dispatch('gus','listWork',[opts])
      ─► gus capability ─► JSON back to the panel
```

**This bridge is the asset. You're changing how modules *register*, not how they *communicate*.**

---

## The 3 things blocking "internal module → external extension"

### 1. Registration is compile-time static (the core blocker)
Both registries hard-code imports that Rollup bundles into core at build time:

- `src/renderer/modules/index.ts:11-12` → `import { gusModule } from '../../../plugins/gus/module'`
- `src/main/modules/index.ts:8-9` → `import { gusMainModule } from '...'`

Installing an extension today = editing core source + recompiling. Impossible for a third party.

### 2. No published SDK; contract imported via deep relative paths
Modules import the contract via `../../../src/shared/module-api`. There is no `@zana-ai/zcc-extension-sdk` to `npm install`. One real **leak** also exists: `plugins/zana/renderer/ZanaDetailModal.tsx:44` imports a core util (`src/renderer/util/markdown`) — the single runtime import that would break a package boundary.

### 3. No trust boundary — fine for first-party, unacceptable for third-party
Today a module's `setup()` runs **in the Electron main process with full Node access** (stated by design: `module-main.ts:11-13`). For untrusted code that is **RCE-by-install**. There is no permission model, no isolation, no CSP, and `window.cc` (the full host API) is reachable from any panel.

---

## Findings by area

### A. SDK contract & package shape (Architect)

Publish **`@zana-ai/zcc-extension-sdk`** with subpath exports preserving the existing main/renderer split (so a main-only extension never pulls React):

```
@zana-ai/zcc-extension-sdk
  "."          → apiVersion constant + manifest types (process-agnostic)
  "./renderer" → AppModule, ModuleHost            (react peerDependency)
  "./main"     → MainModule, MainModuleContext, ModuleCapability
```

- **React must be a `peerDependency`** — `panel` is a `ComponentType` rendered by core's React tree; two React copies break hooks.
- **Versioning:** SDK version tracks the *contract* (SemVer), independent of app version. Export an integer `SDK_API_VERSION`; manifest declares `engines.zccApi` range; host gates at load and refuses-to-mount on mismatch (extend the existing per-module fail-isolation in `registry.ts:81-88`).
- **Manifest** (`package.json#zcc` block — npm-native, installable as a package):

```jsonc
{
  "engines": { "zccApi": ">=1 <2" },
  "zcc": {
    "id": "gus", "title": "GUS", "icon": "Ticket",
    "entry": { "renderer": "./dist/renderer.js", "main": "./dist/main.js" },
    "permissions": ["storage","projects:read","session:launch","inbox:push"]
  }
}
```

- **Dogfood:** repoint gus/zana to consume the published SDK + fix the zana leak — they become the first external-path consumers.

### B. Runtime loading & build (Build/Runtime)

- **Extensions live on disk** at `~/.zcc/extensions/<id>/` (the `~/.zcc/` home is already established for module storage). Discover them with a scanner modeled on the existing CLI-plugins code (`src/main/plugin-fs.ts`, `plugins.ts`) — same defensive habits (enabled-map, skip disabled, tolerate bad manifest).
- **Main side loads trivially:** `await import(pathToFileURL(file))` — main *is* Node. Feeds straight into the unchanged `setupAll(MainModule[])`. Extension must **bundle its own deps** (can't rely on host's asar-locked `node_modules`); externalize only Node built-ins + electron. asar is a non-issue since extensions live *outside* the bundle.
- **Renderer side is the only genuinely hard part.** Renderer has `contextIsolation:true, nodeIntegration:false`, no `require`, and a CSP (`script-src 'self' 'wasm-unsafe-eval' blob:`). Recommended path: extension ships a **pre-built ESM panel**; main reads the JS off disk → streams it over the existing bridge → renderer does a **`blob:`-backed dynamic `import()`**. This rides the *existing* CSP with zero changes. Rejected: Module Federation (build-coupling, fights CSP), HTTP-loaded script (CSP blocks). Deferred: `<webview>` isolation as a future *untrusted* tier.
- **Dual-React trap:** hand React to the panel via an `activate({ React, host })` factory rather than letting it `import 'react'` — avoids import-map fragility and "invalid hook call."
- **Build template:** ship `create-cc-extension` using **Vite library mode** — one entry in, one ESM out. Externalize what the host owns (React + UI kit in renderer; electron + Node built-ins in main); bundle everything the extension brings.
- **Lifecycle:** add an optional **`teardown()`** to `MainModule` for disable/uninstall (release timers, watchers, child processes). Renderer hot-reload is clean via new blob URLs (must evict the `ModulePanelHost` host cache); main-side hot-reload needs cache-busting or relaunch.

### C. Security (Security Engineer) — the gating work

**Threat model if third-party main code runs in-process (today):** arbitrary process execution, read/write any file (`~/.ssh`, `~/.aws`, `~/.claude` creds), credential theft via existing CLIs (`sf org display`), network exfiltration, persistence, cross-module storage tampering. **`launchSession` is the sharpest renderer-reachable vector** — `extraArgs` are appended last and win, so a module could launch an auto-approving Claude agent (`--dangerously-skip-permissions`, `--mcp-config`, …) in any project dir (`module-api.ts:80-96`, `host.ts:42-55`).

**Renderer posture:** `contextIsolation` on and `<webview>` hardened (good), but `sandbox:false` on the main window, **no CSP**, and the **entire `window.cc` is exposed to any panel** — the contract's "no escape hatch to window.cc" is a *convention, not enforced*.

**Required before any untrusted extension loads (in order):**
1. **Don't run third-party `setup()` in-process.** Isolate main-side extension code in a **`utilityProcess`** (one per extension) — Electron-native, crash-isolated, mirrors VS Code's extension-host model.
2. **Capability broker + deny-by-default manifest.** The isolated extension gets no raw `child_process`/`fs`/`net`; it gets broker methods (`ctx.exec({bin,args})` allowlist — no shell strings; path-scoped + canonicalized `fs`; egress-allowlisted `fetch`) that the host checks against the manifest. Enforce at `dispatch` with timeout + rate-limit + audit log; key storage by *authenticated* extension id.
3. **Gate `launchSession`:** permission (default off) + `extraArgs` denylist + project scoping + first-use confirmation.
4. **Add a CSP + per-extension renderer isolation** so panels can't free-ride on `window.cc`; flip `sandbox:true` on the main window.
5. **Install-time trust (cheap→strong):** package SHA-256 pinning → publisher signing (TOFU is fine for a solo-dev app) → a plain-language **consent screen** rendering declared permissions; re-prompt when an update widens them. Skip a curated marketplace for now.

### D. API surface & DX (Product/DX)

**`ModuleHost` is request/response only and one method is dead.** `pushInbox` **throws** ("not wired yet", `host.ts:23-27`) — and its type is also wrong (real `InboxStore.append` requires `projectId`). Both real panels hit the same walls:

- **No event subscriptions → manual polling.** Zana hard-codes a 30s `setInterval`; GUS hand-rolls a 60s cache. Neither can react to "project changed" — `getActiveProject()` is read once and never updates because `host` is a stable ref.
- **Duplicated optimistic-write/undo machine.** GUS and Zana independently reimplement optimistic patch → deferred commit → rollback → toast, copy-pasting `UNDO_WINDOW_MS = 6000`.
- **Cross-unmount state loss.** GUS stashes state in a module-global `let cache` to survive panel unmount.

**Highest-value additions:**
1. **Fix `pushInbox`** (wire to `InboxStore.append`, add `projectId` to the type).
2. **`host.on(event, cb)` → unsubscribe** forwarding the ~10 event streams core *already* emits over IPC (`session:agentStatus`, `inbox:appended`, `schedule:fired`, `mcp:changed`, …) plus store-backed `project:changed`/`nav:changed`. Eliminates polling and fixes the stale-active-project bug.
3. **`host.optimisticWrite()` + a sync in-memory `host.cache`** — retire the duplicated undo machines.
4. **Tier the capability catalogue behind a `permissions` manifest** (everything maps to *existing* core IPC — it's curation, not new backends): T1 read-mostly (sessions/inbox/git/fs-read/scheduler-read), T2 mutating (gated), T3 powerful (`writeToSession`, `fs.write`, `git.discard` — opt-in).
5. **More extension points than a nav panel:** make `panel` optional; add declarative `commands` (→ CommandPalette) and `navBadge` (→ Sidebar) first; settings section + context-menu later.
6. **DX:** publish the SDK package (kills the deep relative import), **auto-discovery** (kills the two hand-edited registries — delivers the "drop-in" promise), `create-zcc-extension` scaffold, a `zcc dev ./ext` side-load loop with HMR, and a Patterns doc extracting the gus/zana idioms.

---

## Recommended sequencing

**Phase 0 — SDK foundation (no behavior change, dogfood the boundary)**
- Publish `@zana-ai/zcc-extension-sdk` (types + apiVersion + tiny runtime helpers); repoint gus/zana; fix the zana markdown leak. Fix `pushInbox` + its type.

**Phase 1 — Runtime loading (first-party-trusted extensions on disk)**
- Disk discovery at `~/.zcc/extensions/` (model on `plugin-fs.ts`); main-side `import()`; renderer blob-import + `activate({React,host})`; add `MainModule.teardown()`; `cc.extensions` bridge namespace; version gate. Auto-discovery replaces the static registries. `create-zcc-extension` + Vite-lib template.
- **At this stage extensions are loadable but still trusted — only safe for code you vet.**

**Phase 2 — Richer API (make extensions worth building)**
- `host.on(events)`, `optimisticWrite`, sync cache; tiered T1/T2 capability catalogue behind a `permissions` field; `commands`/`navBadge` extension points.

**Phase 3 — Trust boundary (required before truly untrusted third-party code)**
- `utilityProcess` isolation per extension + capability broker + deny-by-default enforcement at dispatch; gate `launchSession`; add CSP + per-extension renderer isolation + `sandbox:true`; install-time consent + signing/pinning.

> **Key judgment call:** Phases 0–2 give a real, dogfooded extension platform for *vetted* extensions quickly. **Phase 3 is the line between "plugins I curate" and "anyone can publish."** Decide up front which you're building — it changes how much of Phase 3 is mandatory vs deferrable.

---

## Key files
- Contract: `src/shared/module-api.ts`, `src/shared/module-main.ts`
- Registration coupling to break: `src/renderer/modules/index.ts:11-12`, `src/main/modules/index.ts:8-9`
- Runtime bridge (keep — already generic): `src/shared/ipc.ts`, `src/preload/index.ts:209-214`, `src/main/index.ts:876-897`
- Host construction / permission point: `src/renderer/modules/host.ts`, `src/main/modules/registry.ts`
- Disk-discovery precedent: `src/main/plugin-fs.ts`, `src/main/plugins.ts`
- BrowserWindow security config: `src/main/index.ts:316-339`
- The one leak: `plugins/zana/renderer/ZanaDetailModal.tsx:44`
- Reference panels: `plugins/gus/renderer/GusPanel.tsx`, `plugins/zana/renderer/ZanaPanel.tsx`
