# Extension Lifecycle Design Program

Status: **proposed** · Owner: GUS/extensions · Date: 2026-06-16

How extensions get **built, installed, versioned, and updated** — so (a) developing
against one is a tight edit→see loop, and (b) end users always run the latest
compatible version instead of being silently stuck on a stale bundle.

This is a **global design for all extensions** (gus, zana, cu, and future ones),
not a gus-specific patch. Concrete work lands gus-first as the reference
implementation, then generalizes.

---

## 1. Why this exists (the problem we hit)

GUS ships as a **disk extension**, not a compiled-in module. The path from
source to the running app is:

```
plugins/gus/**            ← source (edited here)
  └─ vite build  →  extensions/gus/dist/{renderer.js, main.mjs}
       └─ package  →  examples/extensions/gus/   (committed artifact)
       └─ package  →  ~/.zcc/extensions/gus/      (runtime install dir)
                                  ▲
        discovery.ts scans ONLY this dir at boot ─┘
```

Between source and the running app sit **two copy steps** (`build`, then
`package`) that nothing automates. During this feature's development that bit us
repeatedly:

- Editing `plugins/gus` and relaunching changed nothing — the app loads the
  bundle in `~/.zcc/extensions/gus`, which `npm run build` does **not** refresh
  (only `npm run package` does).
- There is **no version field** on the manifest and **no staleness signal**, so
  "is the running bundle current?" is answered by `stat`-ing file mtimes.
- A packaged app seeds whatever `dist` shipped and **never reseeds**, so a user
  is frozen on that version until the whole app is reinstalled.

Three distinct problems fall out, addressed in §3–§5.

## 2. Design principles

1. **One source of truth per extension** — the `plugins/<id>` source. Everything
   downstream is a derived artifact.
2. **Dev is live; prod is safe.** The inner loop optimizes for "edit → see";
   the shipped path optimizes for integrity + never-regress.
3. **Reuse the existing precedents.** `skill-installer.ts` already does
   boot-time, edit-respecting, never-throws seeding from `resources/`. The
   extension reseed mirrors it rather than inventing a new mechanism.
4. **Core stays extension-agnostic** (engineering rule #6). No reseed/version
   logic names a concrete extension id in logic — it iterates a manifest set.
5. **Version + compat are first-class.** Every reseed/update decision is gated by
   `engines.zccApi` (`checkApiCompat`, already exists) AND a new `version`.

## 3. Problem 1 — Dev inner loop (live reload)

**Goal:** editing `plugins/<id>` is reflected in the running app without
remembering a manual build+package.

**Chosen approach — symlink the dev install dir + a watch task.**

- **Symlink:** in dev only, make `~/.zcc/extensions/<id>` a symlink to the repo's
  built artifact dir (`extensions/<id>/dist` + manifest, or the committed
  `examples/extensions/<id>`). Discovery resolves entries with `resolveContained`
  (realpath-based), so a symlinked dir is safe. A rebuild is then instantly live —
  the copy step disappears.
- **Watch:** `extensions/<id>` gets a `dev` script = `vite build --watch` so
  saves rebuild the bundle automatically. Renderer entries are blob-imported per
  panel mount, so a panel reopen picks up the new bundle; main-side changes still
  need a relaunch (ESM URL cache — documented, not fixed here).
- **Safety net:** root `npm run dev` gains a `predev` that builds+packages every
  `extensions/*` once, so even a cold start without the watch is never stale.

**Why not pure HMR:** the renderer bundle is loaded via `readRendererEntry` →
blob import, outside Vite's HMR graph. True HMR would mean teaching the loader to
proxy the dev server — large change, deferred. Symlink+watch gets ~90% of the
benefit cheaply.

## 4. Problem 2 — Version + staleness awareness

**Goal:** a human (and the app) can tell what version is loaded and whether it's
behind.

- **Add `version` to the manifest** (`extension.json` / SDK `ExtensionManifest`).
  SemVer string. Validation in `discovery.ts#validateManifest` extends to parse
  it; absent ⇒ treat as `0.0.0` + warn.
- **Stamp build provenance** into the bundle at build time: source git SHA +
  ISO build timestamp, emitted as a `__ZCC_BUILD__` banner the loader can read.
- **Surface in the Extensions hub** (`ExtensionsHub.tsx` already reserves an
  "About" card mentioning version): show `vX.Y.Z · built <ts>`. In dev, when the
  source is newer than the loaded bundle, show a **"rebuild needed"** badge —
  this kills the silent-staleness class of bug outright.

`engines.zccApi` (contract version) and `version` (extension's own version) are
**orthogonal**: the former gates compatibility, the latter orders releases.

## 5. Problem 3 — Users get the latest (never stuck)

Staged, smallest-useful-first.

### 5.1 Bundle-with-app auto-reseed *(this phase)*

Mirror `skill-installer.ts`:

- Ship each extension's canonical artifact inside the app (`resources/extensions/<id>/`
  via electron-builder `extraResources`; in dev, `examples/extensions/<id>`).
- **On boot, before discovery**, for each bundled extension compare the bundled
  `version` to the installed `~/.zcc/extensions/<id>` version:
  - installed missing or **older** → reseed (atomic copy).
  - installed **same or newer** → leave it (respects a user/dev override).
  - reseed only when `checkApiCompat` passes for the bundled one.
- Best-effort, never throws, idempotent (skip when content already matches).

This alone guarantees: **every app update moves users forward, and a user can
never be stuck below the shipped version.** No network required.

### 5.2 Remote update channel *(engine shipped — see `extension-registry.ts`)*

Decouples extension releases from app releases:

- A registry index (`{ schema: 1, releases: [...] }`: id → version, `zccApi`,
  archive `url`, `sha256`, optional `signature`, optional `permissions`).
- The host checks on launch / on demand; per installed id it picks the highest
  **compatible** release (`pickBestRelease`), downloads it, and stages into
  `~/.zcc/extensions/<id>` only after passing every gate.
- **Gates (fail-closed):** HTTPS-only; size caps + timeout; bytes must match
  `sha256`; a detached **Ed25519 signature** must verify when a public key is
  configured (`requireSignature` makes a missing signature fail too);
  `checkApiCompat`; **never downgrades** (`compareVersions`).
- A release that **widens declared permissions** is held back as `needs-consent`
  and NOT auto-applied — the user must re-consent.
- Atomic dir-swap with a `.prev` backup for one-step rollback.
- **Opt-in:** OFF unless `~/.zcc/extension-registry.json` has `enabled: true` +
  an HTTPS `registryUrl`. No host reaches the network by default.
- **Dependency-free archive:** a release is a JSON file-bundle
  (`{ files: { name: base64 } }`), so no tar/zlib dep; integrity + signature are
  over the raw archive bytes. Path-escaping file names are rejected.
- **Status:** engine + security gates + `maybeCheckRemoteUpdates` orchestrator
  shipped and unit-tested. Remaining glue (call from `index.ts` boot after the
  P3 reseed; a "Check for updates" button + consent re-prompt in the hub;
  `extraResources`-published index) is left for a follow-up so it doesn't
  entangle in-flight edits to those files.

### 5.3 Full marketplace *(out of scope)*

Install arbitrary third-party extensions from a catalog. Not pursued unless the
platform opens to third parties.

## 6. Rollout

| Phase | Scope | Lands | Status |
|-------|-------|-------|--------|
| P1 | Dev watch+reseed, `predev` safety net | `extensions/gus/scripts/dev.mjs`, `scripts/seed-extensions.mjs`, root `predev`/`prestart` | **shipped** |
| P2 | `version` field + build stamp + hub UI | SDK (`version`/`build`/`compareVersions`), discovery, `ExtensionsHub` About card | **shipped** |
| P3 | Boot-time bundle-with-app auto-reseed | `src/main/extension-installer.ts`, wired in index.ts boot before discovery; `examples/extensions` shipped via `extraResources` | **shipped** |
| P4 | Remote update channel (engine) | `src/main/extension-registry.ts`, SDK `RegistryIndex`/`pickBestRelease` | **engine shipped** (boot/UI glue pending) |

Each phase is independently shippable and leaves the system better than before.

### Shipped implementation notes (P1–P3)

- **P1.** The chosen form is **watch+reseed**, not symlink (simpler, cross-platform,
  no Windows symlink-perms caveat). `extensions/gus/scripts/dev.mjs` watches
  `plugins/gus` + `extensions/gus/src` and runs build→package on save.
  `scripts/seed-extensions.mjs` (root `predev`/`prestart`) builds+packages every
  `extensions/*` once so a cold `npm run dev` is never stale. Both are
  extension-agnostic (discover by `build`+`package` script convention).
- **P2.** `version` and `build` (`{sha, at}`) are optional manifest fields;
  `build` is stamped into the *packaged* manifest by `package.mjs` (source
  `extension.json` stays clean). `compareVersions` in the SDK is the no-dep
  SemVer comparator. The hub About card shows Version / Built / API rows.
- **P3.** `seedBundledExtensions()` runs at boot before `loadExtensions`,
  comparing bundled vs installed `version` (via `compareVersions`), gated by
  `checkApiCompat`, never downgrading, atomic dir swap, best-effort. Overridable
  in tests via `ZCC_BUNDLED_EXTENSIONS_DIR` + `ZCC_EXTENSIONS_DIR`.

## 7. Open questions

- Symlink vs. copy in dev on Windows (symlink perms) — copy-on-watch fallback.
- Where does the canonical bundled artifact live for prod — `resources/extensions/`
  vs. reusing `examples/extensions/`? (Leaning `resources/` for clean separation.)
- Should `zana`/`slack` (compiled-in built-ins) participate in the version UI for
  consistency, even though they don't reseed? (Probably yes — show app version.)
