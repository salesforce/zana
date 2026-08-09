# Dependency Audit — 2026-06-20

Scope: `npm audit` + `npm outdated` against `package.json` @ v0.8.5 and the
`packages/*` workspaces (`cli`, `extension-sdk`). **No files were modified** —
this is an analysis-only report.

`npm audit` summary: **48 vulnerabilities — 14 high, 3 moderate, 31 low.**
The 31 "low" are almost entirely the `@codingame/monaco-vscode-*` fan-out (one
advisory counted across ~25 sibling packages) plus a couple of dev-only items.

## The risk split that matters

An Electron app's threat surface depends on **whether a package ships to users
or only runs at build/dev time.** Most of the high-count noise is build-time.

| Bucket | Packages | Ships to user? |
|---|---|---|
| **Runtime (shipped in the app)** | `electron`, `dompurify` (via monaco/mermaid), `hono` (via MCP SDK), `electron-updater` | **Yes** — real attack surface |
| **Build / packaging only** | `electron-builder`, `@electron/rebuild`, `tar`, `form-data`, `node-gyp`, `cacache` | No — CI/dev machine only |
| **Dev server / test only** | `vite`, `esbuild`, `electron-vite`, `vitest` | No — never in a release build |

---

## Priority 1 — Runtime, ships to users

### `electron` 33.4.11 → fix requires **≥ 39.8.6** (latest 42.4.1) — **MAJOR**
The single most important item. Multiple **HIGH** use-after-free advisories
(offscreen paint callback, WebContents permission callbacks, PowerMonitor) plus
renderer command-line-switch injection, ASAR integrity bypass, and IPC-spoofing
moderates — all fixed in the 38.8.6 / 39.8.x line.
- **Current 33 is EOL** (Electron supports the latest 3 stable majors; 33 no
  longer receives Chromium security backports), so this is also a maintenance
  cliff, not just these CVEs.
- **Risk:** large jump (33→42 = 9 Chromium majors). Native modules
  (`better-sqlite3`, `node-pty`) must be rebuilt against the new ABI
  (`npm run rebuild` already wires `electron-rebuild`). Watch for renderer
  sandbox / `contextIsolation` default changes and any `webPreferences` the
  app relies on. Recommend stepping to a current **even** major (40 or 42) and
  doing a full smoke test of terminal (pty), SQLite, the Monaco editor surface,
  and the auto-updater feed.
- **Suggested target:** `electron@^42` (or whichever is the latest stable at
  upgrade time), bundled with the `electron-builder`/`@electron/rebuild` bump
  below since they move together.

### `dompurify` — 3.2.7 / 3.4.5 / 3.4.9 present → fix **≥ 3.4.7** (some advisories want ≥ 3.4.11)
Transitive via `monaco-editor@0.55.1` (3.2.7), `@codingame/monaco-vscode-api`
(3.4.5), and `mermaid@11.15.0` (3.4.9). A pile of **moderate** XSS/prototype-
pollution bypasses. This app renders **untrusted markdown** (`react-markdown` +
`rehype-highlight`) and mermaid diagrams, so DOM sanitization is genuinely in
the threat path.
- **No direct dependency to bump** — it rides on monaco/mermaid. The fix is to
  upgrade the parents:
  - `mermaid` 11.15.0 → latest 11.x (pulls a patched dompurify; minor, low risk).
  - `monaco-editor` 0.55.1 and `@codingame/monaco-vscode-*` (see P3) carry older
    dompurify; their bump is the larger lift.
- **Mitigating factor:** the renderer should already be `contextIsolation: true`
  with no `nodeIntegration`; confirm that holds so a sanitizer bypass can't reach
  Node. Worth verifying as part of this item.

### `hono` 4.12.23 → fix **≥ 4.12.25** — one **HIGH** (CORS wildcard reflects Origin w/ credentials) + 4 moderates
Transitive via `@modelcontextprotocol/sdk@1.29.0` (`@hono/node-server` + `hono`).
Only exploitable if the MCP server actually exposes the hono **HTTP/CORS**
transport; the stdio path is unaffected. The Lambda-adapter moderates don't
apply here.
- **Fix:** bump `@modelcontextprotocol/sdk` to a release that pins hono ≥ 4.12.25
  (check `^1.x` latest). Low risk — SDK minor.
- **Action even if low-exposure:** confirm the MCP transport in use; if it's
  stdio-only, downgrade the practical severity but still take the SDK bump.

### `electron-updater` 6.8.9 — *not flagged*, but it ships and pulls the release feed
No advisory today. Flagging only because it's the auto-update trust anchor; keep
it current alongside the electron bump.

---

## Priority 2 — Build / packaging chain (`tar`, `form-data`, builder)

These run on the **build machine**, not in the shipped app. Still worth fixing
because a malicious dependency tarball could exploit `tar` path-traversal during
`npm install` / packaging.

### `electron-builder` 25.1.8 → 26.15.3 — **MAJOR**
Drags in the vulnerable `app-builder-lib` → `@electron/rebuild@3.6.1` →
`node-gyp@9` → `tar@6.2.1` chain. Bumping the builder to 26.x is what clears the
bulk of the **HIGH tar** advisories (arbitrary file write / symlink poisoning /
hardlink traversal — `tar < 7.5.x`) and the **HIGH form-data** CRLF-injection
(`form-data 4.0.5 → ≥ 4.0.6`).
- **Risk:** electron-builder 26 changed some config defaults and signing/notarize
  flow; re-test `dist:mac` and the `release:mac` publish path (the GH_TOKEN /
  soma feed). Medium risk, contained to packaging.

### `@electron/rebuild` 3.7.2 → 4.0.4 — **MAJOR**
Same `tar`/`node-gyp` cleanup on the native-rebuild side. Pairs with the electron
bump (it rebuilds `node-pty` / `better-sqlite3`). Re-run `npm run rebuild` after.

> After bumping builder + rebuild, re-run `npm audit` — the `tar`, `node-gyp`,
> `cacache`, `make-fetch-happen`, `form-data` cluster (the bulk of the 14 highs)
> should collapse to near-zero.

---

## Priority 3 — Dev / test toolchain (low real-world risk)

Dev-server-only advisories; never in a release build. Fix opportunistically.

- **`vite` 5.4.21 → 8.0.16 (MAJOR)** — `server.fs.deny` bypass + path-traversal
  in optimized-deps `.map` handling (HIGH/moderate, **dev server only**).
  Note: `vitest@4.1.8` already pulls `vite@8` transitively, so the test path is
  partially on 8 while the app build is on 5 — a split worth unifying.
- **`esbuild ≤ 0.24.2`** (via `electron-vite`/`vite` 5) — dev-server SSRF-style
  request leak. Cleared by the vite/electron-vite majors.
- **`electron-vite` 2.3.0 → 5.0.0 (MAJOR)** — moves the bundler onto vite 6/7+
  and patched esbuild. Coordinate with the vite bump; this is the riskiest dev
  change (build config / plugin API churn) so do it on its own branch.
- **`vitest` 4.1.8 → 4.1.9** — trivial patch, do anytime.

---

## Major-version drift (no advisory, FYI — larger migrations)

| Package | Current | Latest | Note |
|---|---|---|---|
| `react` / `react-dom` | 18.3.1 | 19.2.x | React 19 migration; `@types/react` 18→19 too. Defer — large surface. |
| `@codingame/monaco-vscode-*` | 33.0.9 | 34.0.3 | **MAJOR**, ~25 packages in lockstep; also the dompurify carrier. Big, coupled lift — pin all to the same 34.x. |
| `@xterm/xterm` + addons | 5.5.0 | 6.0.0 | Terminal core major; test pty rendering. |
| `better-sqlite3` | 11.10.0 | 12.11.1 | Native ABI bump — must rebuild; couple with electron upgrade. |
| `lucide-react` | 0.453.0 | 1.21.0 | Icon set major (possible renamed/removed icons). |
| `typescript` | 5.9.3 | 6.0.3 | TS 6 — check for new strictness breaks. |
| `@types/node` | 22.19.x | 26.0.0 | Keep aligned to the Electron-bundled Node version, not latest. |

---

## Recommended sequencing

1. **Patch-level freebies first:** `vitest` → 4.1.9; bump `@modelcontextprotocol/sdk`
   for the hono fix; bump `mermaid` within 11.x for dompurify. Low risk, quick wins.
2. **Packaging chain (own branch):** `electron-builder` 26 + `@electron/rebuild` 4
   → clears the HIGH `tar`/`form-data`/`node-gyp` cluster. Re-test `dist:mac`.
3. **The big one (own branch):** `electron` → current stable major + rebuild
   native modules + smoke-test pty/SQLite/Monaco/updater. This retires the bulk
   of the runtime HIGH/moderate advisories.
4. **Dev toolchain (own branch):** `vite` + `electron-vite` majors to unify on
   vite 8 and clear esbuild.
5. **Defer (dedicated migrations):** React 19, monaco-vscode 34, xterm 6, TS 6.

`npm audit fix` (non-`--force`) will resolve almost nothing here — every
available fix is `isSemVerMajor`. All meaningful remediation is a deliberate
major bump, which is why none of it should be auto-applied.
