# ZCC Extensions — Overview

Zana Command Center (ZCC) has an **extension system**: self-contained
features — a sidebar nav entry plus a panel, optionally backed by main-process
capabilities — that plug into the app shell **without editing core**. Extensions
build against a stable, published contract (`@zana-ai/zcc-extension-sdk`) and never
import core internals.

> **Start here, then go to the right doc:**
> - **Building one?** → [`extensions-authoring.md`](./extensions-authoring.md) (the how-to).
> - **Scaffolding?** → [`tools/create-zcc-extension`](../tools/create-zcc-extension) (template + sample source), or copy a shipped first-party extension under [`bundled-extensions`](../bundled-extensions).
> - **Understanding the design?** → the architecture docs linked at the bottom.

---

## Two tiers (this is the key mental model)

ZCC tiers extensions on **provenance**, not capability:

| | **Built-in** (trusted) | **Disk extension** (runtime) |
|---|---|---|
| Lives in | compiled into the app | `~/.zcc/extensions/<id>/`, loaded at runtime |
| Registered | `MAIN_MODULES` / `APP_MODULES` arrays | discovered from disk — no core edit |
| Trust | full Node access, in-process | **isolated**: own `utilityProcess`, capabilities brokered |
| Permissions | none (trusted) | **declared + user-consented + enforced** deny-by-default |
| Example | **slack** (the one feature the broker can't grant a capability for) | **zana** (a Tickets board; its data flows over a brokered MCP capability) |

Both consume the **same `@zana-ai/zcc-extension-sdk` contract** and look identical in
the UI. The only differences are where they load from and how much the host
trusts them. **Almost everything ships as a disk extension** — a feature stays
**built-in** only when the broker genuinely can't grant the capability it needs.

> Zana (the Tickets board) is deliberately a disk extension even though it is
> first-party — living proof that the full runtime + isolation + consent path
> works on a real, non-toy feature. Its ticket data flows over a brokered **MCP**
> capability to a host-managed server pool, so it needs no raw Node access and
> stays fully isolated.

---

## Architecture at a glance

```
                        ┌─────────────────────────────────────────────┐
   ~/.zcc/        │  ZCC (Electron)                            │
   extensions/<id>/     │                                             │
     extension.json ────┼─► discovery ─► consent gate ─► load         │
     renderer.js        │      (manifest)   (declared      │          │
     main.mjs           │                    permissions)  │          │
                        │                                  ▼          │
                        │   RENDERER (sandboxed)      MAIN process     │
                        │   ┌───────────────┐                         │
                        │   │ panel (blob-  │   built-in modules ─────┤ in-process
                        │   │ imported ESM, │   (slack) trusted        │ (trusted)
                        │   │ host React)   │                         │
                        │   └──────┬────────┘   disk-ext main ────────┤ utilityProcess
                        │          │ host.call  (zana) ISOLATED        │ (per extension)
                        │          ▼                  │               │
                        │     ModuleHost ──IPC──► router ─┐           │
                        │   (the only surface)            │           │
                        │                                 ▼           │
                        │                    PermissionBroker ───► ctx.exec / fs / fetch
                        │                    (deny-by-default,       (gated, scoped)
                        │                     consent-derived grant)                │
                        └─────────────────────────────────────────────┘
```

- **Renderer panels** are blob-imported ESM bundles that receive the host's
  React via `activate({ React, host })` (no second React → no broken hooks). A
  panel touches the host **only** through `ModuleHost` — never `window.cc`.
- **Disk-extension main code** runs in a per-extension `utilityProcess`, not the
  Electron main process. It gets capabilities (`exec`, `fs`, `fetch`, `storage`)
  only via a brokered `MainModuleContext`, each call **permission-gated** against
  the user-consented grant. Raw `node:child_process`/`fs`/etc. are denied in the
  child (a Node-builtin denylist).
- **Built-in modules** (today just **slack**) skip the broker and run trusted
  in-process. A feature earns this tier only when the broker can't grant the
   capability it needs even scoped — other first-party features such as Zana
  ships as an isolated disk extension. zana's data-heavy Tickets board is the
  proof point: rather than embedding native SQLite in core, it reaches a
  host-managed MCP server pool through the brokered **MCP** capability, so it
  stays fully isolated.

---

## What an extension can do (the `ModuleHost` surface)

- `call(capability, …)` — invoke its own main-side capabilities
- `storage` (persisted KV) and `cache` (sync, in-memory, survives unmount)
- `on(event, cb)` — subscribe to host events (project/session/inbox/schedule/…)
- `getActiveProject` / `listProjects` / `selectProject`
- `launchSession`, `openExternal`, `pushInbox`, `toast`
- Contribute beyond a panel: **`commands`** (→ command palette) and **`navBadge`** (→ sidebar)
- Contribute **Personas and Teams** to core's registries (in-memory, lifecycle-bound, host-stamped provenance — see [extensions-authoring.md#contributing-personas--teams](./extensions-authoring.md#contributing-personas--teams))

Full signatures + the events table are in
[`extensions-authoring.md`](./extensions-authoring.md).

---

## Permissions & trust (disk extensions)

A disk extension **declares** the capabilities it needs in its manifest; the
user **consents** at install (a plain-language prompt); the host **enforces**
the granted set deny-by-default. The effective grant is `declared ∩ consented`,
so an unconsented extension can do nothing and doesn't even load. A later update
that **widens** permissions re-prompts.

Vocabulary, scoping (`execAllowlist` / `fsRoots` / `egressAllowlist`), and the
remaining trust boundaries are documented in
[`extensions-authoring.md` → Permissions](./extensions-authoring.md#permissions-are-enforced-for-disk-extensions-p3-b).

---

## Document map

**Use these to build:**
- [`extensions-authoring.md`](./extensions-authoring.md) — **the authoring guide** (manifest, the `activate` factory + the host-React contract, events, cache, contributions, the main module, build externals, install/dev loop, permissions). The one doc an extension author needs.

**Reference (the contract):**
- [`packages/extension-sdk/src`](../packages/extension-sdk/src) — the SDK source: `index.ts` (manifest types, `checkApiCompat`), `renderer.ts` (`AppModule`, `ModuleHost`, `RendererEntry`), `main.ts` (`MainModule`, `MainModuleContext`).
- [`tools/create-zcc-extension/sample-hello`](../tools/create-zcc-extension/sample-hello) — minimal worked sample source for scaffolding.
- [`bundled-extensions`](../bundled-extensions) — packaged first-party extension artifacts you can inspect.

## Status & what's deferred

**Shipped & working** (verified live end-to-end with Zana): the SDK, runtime disk
loading, the rich API, contributions, and the **MIN trust boundary** —
untrusted *main/headless* disk extensions are isolated, permission-gated, and
consented.

**Deferred by design** (gated on actually opening to untrusted third parties):
- **P3-C** — renderer iframe isolation, required only to let strangers ship
  *panels* (today panels are a curated tier; a panel can reach the renderer's
  React tree). Large effort — see the phase-3 design doc.
- **OS-level sandbox** (Node `--permission` / seatbelt) — the deeper seal beyond
  the JS-level builtin denylist; the denylist is not a hard boundary against a
  determined native-addon or realm escape.
- A real **first-run installer** for bundled extensions (today: manual copy /
  `npm run package`, mirroring the `hello` sample).
