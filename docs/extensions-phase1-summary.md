# Phase 1 — Runtime Extension Loading: Change Summary (P1-E integration gate)

Branch: `feat/extensions-phase1`. This is the reviewer-facing summary of the
Phase 1 work (built by P1-A..D) plus the cross-ticket bug fix and integration
gate owned by P1-E.

## What Phase 1 delivers

Runtime-loadable extensions discovered on disk under
`~/.zcc/extensions/<id>/` (env override `ZCC_EXTENSIONS_DIR`). Each
extension ships an `extension.json` manifest, an optional renderer bundle
(blob-imported + `activate()`-d into a React panel), and an optional main module
(dynamically `import()`-ed and merged into the existing `setupAll`). Built-in
modules and runtime extensions are merged into one set the sidebar / panels
consume.

## Files added / changed, by area

### SDK (`@zana-ai/zcc-extension-sdk`)
- `packages/extension-sdk/src/index.ts` — `SDK_API_VERSION` (=1),
  `ExtensionManifest`, `ExtensionPermission`, `defineModule`/`defineMainModule`,
  and **`checkApiCompat(range, current?)`** (extended in this ticket — see fix
  below).
- `packages/extension-sdk/src/renderer.ts` — `AppModule`, `ModuleHost`, and the
  new **`RendererEntry { activate({ React, host }) }`** factory contract.
- `packages/extension-sdk/src/main.ts` — `MainModule`, `MainModuleContext`,
  `ModuleCapability`; `MainModule.teardown?()` for hot-unload.
- `packages/extension-sdk/src/__tests__/checkApiCompat.test.ts` — **new** (P1-E),
  23 cases covering the fix.

The SDK keeps its process split: `.` (process-agnostic, no React/Node),
`/renderer` (React peer dep), `/main` (Node), `/helpers`. This split is what
keeps the main bundle React-free.

### Main process
- `src/main/extensions/discovery.ts` — disk discovery + manifest validation +
  enabled-map (`enabled.json`, default-on) + version gate via `checkApiCompat`;
  `readRendererEntry` (path-contained), `setExtensionEnabled`, `extensionDir`.
  Electron-free so vitest imports it directly.
- `src/main/extensions/loader.ts` — dynamic `import()` of main modules, merged
  into `setupAll`; flips `loaded:false` + `main-load-failed` on import error.
- `src/main/modules/registry.ts` — `MainModuleHost.teardown(id)`.
- `src/main/index.ts` — `cc.extensions` IPC handlers + `onChanged` push.
- `src/main/__tests__/extensions.test.ts` — discovery + loader suite (~15 cases).

### Renderer
- `src/renderer/modules/loader.ts` — blob-import + `activate` factory,
  `useExtensionModules` store, host eviction, per-panel ErrorBoundary, reconcile
  on `onChanged`.
- `src/renderer/modules/index.ts` — `useMergedModules()` (built-ins + runtime).
- `src/renderer/modules/ModulePanelHost.tsx`, `App.tsx`, `components/Sidebar.tsx`,
  `components/ListPane.tsx`, `components/SettingsPanel.tsx` — consume the merged
  set / surface extension state.

### Scaffold + sample
- `tools/create-zcc-extension/` — scaffolder (`template/extension.json`,
  template renderer/main).
- `examples/extensions/hello/` — committed sample: `extension.json`
  (renderer-only, `engines.zccApi: "^1.0.0"`) + hand-authored ESM `renderer.js`.

### Docs
- `docs/extensions-authoring.md` — authoring guide.
- `docs/extensions-phase1-summary.md` — this file.

## New `cc.extensions` IPC channels
Bridge mirrors `cc.plugins`. Channel ids in `src/shared/ipc.ts`, typed in
`src/shared/types.ts`, wired in `src/preload/index.ts`:

| Method | Channel | Purpose |
| --- | --- | --- |
| `list()` | `extensions:list` | discovered `ExtensionEntry[]` |
| `setEnabled(id, enabled)` | `extensions:setEnabled` | toggle in `enabled.json`; disable tears down the main module |
| `reveal(id)` | `extensions:reveal` | open the extension dir in Finder |
| `readRendererEntry(id)` | `extensions:readRendererEntry` | renderer bundle JS as a string (or null) for blob-import |
| `onChanged(cb)` | `extensions:onChanged` | main → renderer push when the set changes |

## New SDK exports
`SDK_API_VERSION`, `ExtensionManifest`, `ExtensionPermission`, `defineModule`,
`defineMainModule`, `checkApiCompat`; `RendererEntry` (`/renderer`);
`MainModule.teardown?()` (`/main`).

## checkApiCompat fix (the bug this ticket gated on)

**Bug:** `checkApiCompat` only parsed the integer-comparator grammar
(`/^(>=|<=|>|<|=)?(\d+)$/`). It failed closed on `^1.0.0`. But the sample, the
scaffold template, and the authoring docs all declare
`"engines": { "zccApi": "^1.0.0" }`, which discovery.ts passes straight into
`checkApiCompat` — so every scaffolded extension (and the `hello` sample) was
silently skipped as `version-mismatch`. Phase 1 loaded nothing.

**Fix (no semver dependency added):** the hand-rolled parser now evaluates each
space-separated token against two grammars, intermixable, all must hold (AND):

1. Integer comparators (unchanged): `>=N`, `<=N`, `>N`, `<N`, `=N`, bare `N`.
2. Semver-ish "major pin": `^1.0.0`, `~1.2.0`, `1.x`, `1.2.x`, `1`, `1.2`,
   `1.2.3` (regex `^[\^~]?(\d+)(?:\.(?:\d+|[xX*]))*$`). Because the contract
   version is a single integer, all of these collapse to "major === current".
   So `^1.0.0`, `~1.2`, `1.x`, `1.2.3` are all satisfied iff `current === 1`.

Truly unparseable tokens still fail closed (`false`). `>=1 <2` keeps working.

## Installing an extension

```sh
cp -R examples/extensions/hello ~/.zcc/extensions/hello
# or, against a sandbox dir (used by the smoke test):
ZCC_EXTENSIONS_DIR=/tmp/cc-ext cp -R examples/extensions/hello /tmp/cc-ext/hello
```

Discovery is default-on; toggle via the Extensions UI (writes `enabled.json`).

## Integration gate results (P1-E)

| Gate | Command | Result |
| --- | --- | --- |
| SDK tests | `npx vitest run packages/extension-sdk` | PASS — 23/23 |
| Typecheck | `npm run typecheck` | PASS — clean |
| Full tests | `npm run test` | PASS — 528/528 across 42 files |
| Build | `npm run build` | PASS — main + preload + renderer built |
| Main bundle React-free | grep `out/main/index.js` | PASS — 0 real react/react-dom imports, 0 React API usage; the only "react" hit is the word "reacts" in a comment |
| Smoke (runtime load path) | throwaway vitest harness w/ `ZCC_EXTENSIONS_DIR` | PASS — see below |

### Smoke test (what it asserted)
A throwaway vitest harness set `ZCC_EXTENSIONS_DIR` to a temp dir, `cp -R`'d
`examples/extensions/hello` into it, ran `discoverExtensions()`, and asserted on
the `hello` entry:
- discovered, `error === undefined` (the regression: `^1.0.0` is NOT skipped as
  `version-mismatch`),
- `loaded: true`, `enabled: true`, `manifest.engines.zccApi === "^1.0.0"`,
- renderer-only → `mainEntryPath === undefined`, `entry.renderer === "renderer.js"`,
- `readRendererEntry('hello')` returns a non-empty JS string.

Temp dir and harness file were deleted after running. Full visual mount of the
React panel is a manual step (can't headlessly mount it here).
