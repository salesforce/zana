# Extensions — Phase 0 Implementation Plan

**Goal:** Establish the SDK boundary and pay down existing debt, with **no user-visible behavior change** except that `pushInbox` starts working. After Phase 0, gus/zana consume the SDK exactly the way a future external extension will — we dogfood the boundary before anyone depends on it.

**Decision context:** Curated-first (see `extensions-sdk-findings.md`). Phase 0 carries the two forward-compat rules: permissions *declared* (not enforced), and privileged ops reachable through host-provided context (not direct imports).

**Out of scope for Phase 0:** runtime disk loading, dynamic `import()`, the `utilityProcess`/broker, CSP. Those are Phases 1 and 3.

---

## Workstream A — Stand up `@zana-ai/zcc-extension-sdk` as a local workspace package

The SDK becomes the **canonical source of truth** for the contract types. Core and plugins both consume it. It's a local workspace package now; `npm publish` later is a no-op change.

### A1. Create the package
```
packages/extension-sdk/
  package.json
  tsconfig.json
  src/
    index.ts       # apiVersion, manifest/permission types, defineModule helpers (process-agnostic)
    renderer.ts    # AppModule, ModuleHost   (react peerDependency)
    main.ts        # MainModule, MainModuleContext, ModuleCapability  (no react)
    helpers.ts     # unwrapBareFence (promoted from core) + future pure helpers
```

`package.json`:
```jsonc
{
  "name": "@zana-ai/zcc-extension-sdk",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".":          { "types": "./src/index.ts" },
    "./renderer": { "types": "./src/renderer.ts" },
    "./main":     { "types": "./src/main.ts" },
    "./helpers":  { "types": "./src/helpers.ts" }
  },
  "peerDependencies": { "react": "^18", "react-dom": "^18" },
  "peerDependenciesMeta": { "react": { "optional": true }, "react-dom": { "optional": true } }
}
```
> Phase 0 ships **types + a tiny runtime** (`apiVersion`, `unwrapBareFence`, `defineModule`). A real build step (`tsc`/`dist`) is added when we actually publish; for now the workspace resolves `src/*` directly via tsconfig paths, same as the `@shared` alias today.

### A2. Move the contract into the SDK (source of truth)
- `src/renderer.ts` ← current body of `src/shared/module-api.ts` (`AppModule`, `ModuleHost`).
- `src/main.ts` ← current body of `src/shared/module-main.ts` (`MainModule`, `MainModuleContext`, `ModuleCapability`).
- `src/index.ts` adds:
  ```ts
  export const SDK_API_VERSION = 1;
  export interface ExtensionPermissions { /* string union, see A4 */ }
  export function defineModule(m: AppModule): AppModule { return m; }      // inference + forward-compat seam
  export function defineMainModule(m: MainModule): MainModule { return m; }
  ```
- `src/helpers.ts` ← move `unwrapBareFence` from `src/renderer/util/markdown.ts` **verbatim** (it's a pure function, no core deps).

### A3. Keep core importing via thin re-export shims (zero core churn)
To avoid touching every core import of `@shared/module-api` / `@shared/module-main`, turn those two files into re-export shims:
```ts
// src/shared/module-api.ts
export * from '@zana-ai/zcc-extension-sdk/renderer';
```
```ts
// src/shared/module-main.ts
export * from '@zana-ai/zcc-extension-sdk/main';
```
Core's existing imports (`renderer/modules/host.ts`, `main/modules/registry.ts`, etc.) keep working untouched. The shims are a migration aid; new core code should import the package directly. *(Optional later cleanup: delete the shims and repoint core too — not needed for Phase 0.)*

For `unwrapBareFence`, `src/renderer/util/markdown.ts` becomes:
```ts
export { unwrapBareFence } from '@zana-ai/zcc-extension-sdk/helpers';
```
so core's own callers (whoever imports the util today) are also untouched.

### A4. Permissions — declared, not enforced (the cheap insurance)
Add an optional field to `AppModule`:
```ts
/** Capabilities this extension intends to use. Declared now; ENFORCEMENT lands in Phase 3.
 *  Curated extensions are trusted, so this is documentation + future-proofing today. */
permissions?: ExtensionPermission[];
```
`ExtensionPermission` union (initial): `'storage' | 'projects:read' | 'projects:select' | 'session:launch' | 'external:open' | 'inbox:push'`.

### Build wiring
- Root `package.json`: add `"workspaces": ["packages/*"]` (or the electron-vite equivalent) and a dependency on `@zana-ai/zcc-extension-sdk`.
- `electron.vite.config.ts` + `tsconfig.json`: add a path alias `@zana-ai/zcc-extension-sdk/*` → `packages/extension-sdk/src/*` so both bundler and `tsc` resolve it. Mirror the existing `@shared` alias setup.

---

## Workstream B — Repoint gus/zana + fix the leak (dogfood the boundary)

10 import sites total. Switch each from the deep relative path to the package.

| File | Change |
|---|---|
| `plugins/gus/module.ts:6` | `../../src/shared/module-api` → `@zana-ai/zcc-extension-sdk/renderer` |
| `plugins/gus/main/gus-main.ts:21` | `../../../src/shared/module-main.js` → `@zana-ai/zcc-extension-sdk/main` |
| `plugins/gus/renderer/GusPanel.tsx:29` | → `@zana-ai/zcc-extension-sdk/renderer` |
| `plugins/gus/renderer/GusDetailModal.tsx:24` | → `@zana-ai/zcc-extension-sdk/renderer` |
| `plugins/zana/module.ts:6` | → `@zana-ai/zcc-extension-sdk/renderer` |
| `plugins/zana/main/zana-main.ts:39` | → `@zana-ai/zcc-extension-sdk/main` |
| `plugins/zana/renderer/ZanaPanel.tsx:40` | → `@zana-ai/zcc-extension-sdk/renderer` |
| `plugins/zana/renderer/ZanaDetailModal.tsx:34` | → `@zana-ai/zcc-extension-sdk/renderer` |

**The leak — `plugins/zana/renderer/ZanaDetailModal.tsx:44`:**
```ts
import { unwrapBareFence } from '../../../src/renderer/util/markdown';
// →
import { unwrapBareFence } from '@zana-ai/zcc-extension-sdk/helpers';
```
After this, **grep confirms zero plugin imports reach into `src/`** — the boundary is clean.

**Declare permissions** on each module object (cheap insurance, nothing reads them yet):
- gus: `permissions: ['storage', 'projects:read', 'session:launch', 'external:open']`
- zana: `permissions: ['storage', 'projects:read', 'projects:select', 'session:launch', 'inbox:push']`
  (zana wants `inbox:push` once B's `pushInbox` works — see Workstream C.)

---

## Workstream C — Make `pushInbox` real (the one behavior change)

Today `host.pushInbox` throws (`renderer/modules/host.ts:23-27`) and its contract type is wrong — `InboxStore.append` **requires `projectId`** (`inbox-store.ts:80-83`).

### C1. Fix the contract type (`packages/extension-sdk/src/renderer.ts`)
```ts
/** Push a message to the user's inbox. projectId defaults to the active project;
 *  rejects if neither is available. At least one of comments/docs must be present. */
pushInbox(msg: {
  projectId?: string;
  comments?: string;
  docs?: Array<{ path: string }>;
}): Promise<{ id: string }>;
```

### C2. Add the IPC channel
- `src/shared/ipc.ts` → `modules` block: add `pushInbox: 'modules:pushInbox'`.
- `src/preload/index.ts` → `modules` namespace (after line 228):
  ```ts
  pushInbox: (moduleId, msg) => ipcRenderer.invoke(IPC.modules.pushInbox, moduleId, msg),
  ```
- `src/main/index.ts` → register alongside the existing inbox handlers (~line 586, where `inboxStore` is in scope). **No `MainModuleHost` change** — `inboxStore` is a module-scope singleton:
  ```ts
  handle(IPC.modules.pushInbox, async (_e, moduleId: string, msg) => {
    const entry = await inboxStore.append({
      projectId: msg.projectId,           // required by append; renderer fills from active project
      projectLabel: undefined,
      comments: msg.comments,
      docs: msg.docs
    });
    return { id: entry.id };
  });
  ```
  > `append` already validates `projectId` present + at least one of docs/comments, so malformed pushes reject with a clear message — no extra validation needed here.

### C3. Implement in the renderer host (`renderer/modules/host.ts:23-27`)
```ts
pushInbox: async (msg) => {
  const projectId = msg.projectId ?? useUi.getState().selectedProjectId;
  if (!projectId) throw new Error('pushInbox: no projectId and no active project');
  return window.cc.modules.pushInbox(moduleId, { ...msg, projectId });
},
```
> Mirrors how `getActiveProject()` already reads `selectedProjectId` (host.ts:32). `moduleId` is passed for future per-extension attribution/permission checks (Phase 3) even though it's unused server-side today.

---

## Tests & verification

- **Unit:** move/keep the `unwrapBareFence` test with the function into `packages/extension-sdk` (there's an existing markdown test to relocate). Add an inbox-push handler test using `createMemoryInboxStore()` (`inbox-store.ts:253`) — asserts projectId-missing rejects and a valid push returns an id.
- **Typecheck:** `npm run typecheck` must pass with the new alias — this is the real proof the re-export shims and package exports resolve for both `tsc` and the bundler.
- **Build:** `npm run build` — confirms electron-vite resolves `@zana-ai/zcc-extension-sdk/*` in main, preload, and renderer bundles.
- **Manual smoke:** launch the app, open GUS and Zana panels (proves repointed imports load + render), then trigger a zana `inbox:push` and confirm an inbox entry appears scoped to the active project.

## Risks & mitigations
- **Alias must resolve in 3 bundler contexts + tsc.** Renderer pulls React (peer), main/preload must NOT. The subpath split (`/renderer` vs `/main`) enforces this — verify the main bundle doesn't pull React by checking the build. *Mitigation:* keep `react` out of `main.ts`/`index.ts`; only `renderer.ts` references `ComponentType`.
- **React identity.** Not a Phase 0 risk (plugins are still bundled into core, sharing core's React). Becomes real only in Phase 1 runtime loading — flagged there, not here.
- **Re-export shim drift.** The shims mean two import styles coexist. Acceptable as a migration aid; documented as such. Optional follow-up to delete them.

## Definition of done — ✅ COMPLETE (2026-06-12)
1. ✅ `@zana-ai/zcc-extension-sdk` exists (`packages/extension-sdk`); `SDK_API_VERSION`, contract types (`./renderer`, `./main`), and `unwrapBareFence` (`./helpers`) live there. Wired as an npm workspace; aliased in tsconfig, all 3 electron-vite bundles, and a new `vitest.config.ts`.
2. ✅ gus/zana import only the package — grep confirms **zero** `src/` reaches from `plugins/`.
3. ✅ Both modules declare `permissions` (unenforced).
4. ✅ `host.pushInbox` works end-to-end (IPC `modules:pushInbox` → `inboxStore.append`); contract type includes optional `projectId` (defaults to active project).
5. ✅ `typecheck` clean; **238/238 tests pass**; full `build` green across main/preload/renderer. Main bundle verified to contain **no React** (subpath split holds).

**Verification:** `npm run typecheck && npm run test && npm run build` all green.
**Not mine:** `src/renderer/components/ListPane.tsx` and `src/renderer/store.ts` carry an unrelated context-menu clamp change that was already in the working tree — left untouched.

## Sequencing
A (package + shims + alias) → B (repoint + leak + permissions) → C (pushInbox). A must land first; B and C are independent after A.

---

## Phase 1 — DONE (runtime loading + DX scaffold)

Phase 1 (runtime disk loading of first-party-trusted extensions) is implemented on `feat/extensions-phase1`:

- **Runtime load contract (P1-A/B/C):** disk discovery at `~/.zcc/extensions/<id>/`, main-side `import()`, renderer blob-import + `activate({ React, host })`, `MainModule.teardown()`, version gate via `checkApiCompat`. Manifest is `extension.json` matching `ExtensionManifest` (`icon` = lucide-react name; `entry.renderer`/`entry.main` optional; `permissions` declared-not-enforced).
- **Developer scaffold (P1-D):** [`tools/create-zcc-extension`](../tools/create-zcc-extension) — a complete Vite library-mode template (`extension.json`, `src/renderer/panel.tsx` exporting a `RendererEntry`, optional `src/main/index.ts`, `vite.config.ts` with the right externals, `tsconfig.json`, `package.json`, `README.md`) plus a dependency-light generator (`index.js`).
- **Worked sample (P1-D):** the maintainable source at [`tools/create-zcc-extension/sample-hello`](../tools/create-zcc-extension/sample-hello) (`panel.tsx`) — QA can build and copy it into `~/.zcc/extensions/hello/`. Renders `host.listProjects()` and a `host.toast()` button.
- **Authoring docs (P1-D):** [`extensions-authoring.md`](./extensions-authoring.md) — manifest fields, the activate factory + why React is injected, build externals, install path, enable/disable + relaunch caveat, declared-not-enforced permissions.

> The scaffold and sample are **separate projects** (own tsconfig) and are kept out of the root `tsconfig.json` `include` (which scopes to `src/**` + `packages/extension-sdk/src/**`), so the root typecheck stays green.

**Still trusted-only:** Phase 1 extensions are loadable but run with full trust. The trust boundary (isolation, capability broker, CSP, consent) remains deferred to Phase 3.
