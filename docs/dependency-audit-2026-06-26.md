# Dependency audit — 2026-06-26

Scheduled vuln + version-drift sweep. **Inspection only — nothing installed or
edited.** Follows up [`dependency-audit-2026-06-24.md`](dependency-audit-2026-06-24.md).

Toolchain at audit time: Node v26.3.0, npm 11.16.0, repo on branch `0.8.6`.

## TL;DR

- `npm audit`: **47 total** (31 low, 3 moderate, 13 high). `--omit=dev`: **33**
  (31 low, 1 moderate, 1 high).
- **Delta vs 06-24:** total 48→**47**, high 14→**13**, moderate unchanged (3). The
  drop is in the build-chain `@electron/rebuild` cluster (one fewer node-gyp-path
  advisory after registry metadata refresh); prod-reaching set is **unchanged**.
- **The two prod-reaching advisories are stable** and both still have a clean fix:
  `hono` (HIGH, in-range non-major fix) and `dompurify` (MODERATE). Same picture as 06-24.
- **New since the earlier 06-26 pass:** `mermaid` now publishes an **in-range minor**
  (11.15.0 → 11.16.0) whose dompurify range widened to `^3.3.3`, resolving to the
  **patched dompurify@3.4.11**. A plain `npm install` would pick this up and clear the
  **mermaid** dompurify subtree — no major, no override. The two *monaco* dompurify
  subtrees still need the monaco-vscode 34 major (or an `overrides` pin).
- Note on `hono`: the surfaced advisory title is now the **serve-static Windows
  path-traversal via `%5C`** (GHSA, ≤4.12.24); still `fixAvailable: true`, still
  in-range, no SDK pin needed. Resolved version on disk is `hono@4.12.23`.
- **`npm audit fix` still cannot run** — `vite@6` vs `electron-vite@2.3.0`
  (peers `vite ^4||^5`) ERESOLVE conflict. Fixes must be applied per-package.
- **Electron 33.4.11 remains EOL** and is the single highest-value security item.

## Prod-reaching vulnerabilities (the ones that matter)

| Pkg | Sev | Path | Fix today | Real-world reach |
|---|---|---|---|---|
| **hono** ≤4.12.24 | HIGH | `@modelcontextprotocol/sdk@1.29.0` → `@hono/node-server@1.19.14` → hono@4.12.23 | **In-range, non-major** (`fixAvailable: true`; ≥4.12.27) | Low — advisory is serve-static path traversal on **Windows** via `%5C`; ZCC runs MCP on local UDS/localhost, no public static serving, primary host is macOS |
| **dompurify** ≤3.4.10 | MOD (XSS) | monaco-editor@0.55.1 (3.2.7), mermaid@11.15.0 (3.4.9), monaco-vscode-api@33 (3.4.5) | **mermaid subtree now in-range** (bump mermaid → 11.16.0 pulls 3.4.11); monaco subtrees via **monaco-vscode 34 major** or an `overrides` pin | Low — reachable only if those render attacker-controlled markup; app renders own content |

**Recommendation:** `hono` is still the cleanest single win — a targeted update
patches a HIGH with no major bump and no override. Verify the bump on a branch
(the lockfile installs via legacy-peer-deps, so even targeted installs need the gate).

## High-severity dev/build-only (do not reach the shipped app)

All gated behind major bumps; none load at runtime.

| Cluster | Advisory chain | Fix |
|---|---|---|
| **electron-builder@25.1.8** | `app-builder-lib`, `dmg-builder`, `…-squirrel-windows`, **`form-data@4.0.5`** (CRLF injection, GHSA-hmw2-7cc7-3qxx) | electron-builder **26.15.3** (major). `form-data` reports `fixAvailable: true` but its only parent is app-builder-lib, so it rides the major |
| **@electron/rebuild@3.7.2** | `@electron/node-gyp`, `node-gyp`, `make-fetch-happen`, `cacache`, `tar` (hardlink path-traversal arbitrary file write) | `@electron/rebuild` **4.0.4** (major) |
| **electron-vite@2.3.0** | `esbuild` (moderate, dev-server SSRF) | electron-vite **5.0.0** (major) — also resolves the ERESOLVE below |

## Major-version drift (`Current == Wanted`, intentional upgrades)

| Pkg | Cur | Latest | Risk note |
|---|---|---|---|
| **electron** | 33.4.11 | 42.4.1 | ⚠️ **EOL + multiple HIGH advisories** (ASAR integrity bypass, UAF, IPC spoofing). Highest-priority major. Native-module rebuild + main-process API review needed |
| **electron-vite** | 2.3.0 | 5.0.0 | ⚠️ **Conflicts with `vite@6`** (peer `^4\|\|^5`) → installed only via legacy-peer-deps; blocks `npm audit fix`. Upgrading realigns the toolchain |
| **electron-builder** | 25.1.8 | 26.15.3 | Clears the build-chain HIGH cluster incl. form-data |
| **@electron/rebuild** | 3.7.2 | 4.0.4 | Clears node-gyp/tar cluster |
| **@codingame/monaco-vscode-*** (≈25 pkgs) | 33.0.9 | 34.0.3 | Lockstep major; carries patched dompurify. Editor-surface regression test needed |
| **react / react-dom** | 18.3.1 | 19.2.7 | Deliberate React 19 migration (also `@types/react` 18→19). Note `extension-sdk` also pins react 18 — bump together |
| **vite** | 6.4.3 | 8.0.16 | Couple to the electron-vite bump |
| **typescript** | 5.9.3 | 6.0.3 | TS 6 major |
| **better-sqlite3** | 11.10.0 | 12.11.1 | Native rebuild; pair with the electron major |
| **@xterm/xterm** (+addons) | 5.5.0 | 6.0.0 | Terminal-surface major |
| **lucide-react** | 0.453.0 | 1.21.0 | Icon API churn possible |
| **@vitejs/plugin-react** | 4.7.0 | 6.0.2 | Couple to vite/electron-vite |
| **@types/node** | 22.19.19 | 26.0.0 | Track Node runtime target (running Node 26 locally) |

## Within-range safe bumps (picked up by plain `npm install`)

`Wanted > Current` — non-breaking:
- **`mermaid` 11.15.0 → 11.16.0** — clears the mermaid dompurify XSS subtree (pulls 3.4.11). New this run.
- `vitest` 4.1.8 → **4.1.9** (root + `cli` workspace)
- `@types/node` 22.19.19 → **22.20.0**
- `@types/react` 18.3.30 → **18.3.31**

Lockfile still installs via legacy-peer-deps (vite/electron-vite conflict), so even
a "safe" install should be verified on a branch.

## Recommended sequencing (no action taken)

1. **Targeted, low-risk now (two clean in-range wins):** update `hono` → 4.12.27
   (HIGH, prod, no major) **and** `mermaid` → 11.16.0 (clears one of three dompurify
   XSS subtrees, in-range) — the cleanest fixes on the board.
2. **Toolchain realign (one branch):** `electron-vite` 5 + `vite` 8 +
   `@vitejs/plugin-react` 6 together — fixes the ERESOLVE and the esbuild moderate.
3. **Build-chain majors:** `electron-builder` 26 + `@electron/rebuild` 4 — clears the
   form-data/node-gyp/tar HIGH cluster (dev-only, low urgency).
4. **Deliberate, highest security value:** `electron` 33→latest (EOL). Pair with
   `better-sqlite3` 12 native rebuild.
5. **Opportunistic:** monaco-vscode 34 (carries patched dompurify), React 19, TS 6.

`npm audit fix --force` is **not** advised — it would force-resolve the vite peer
conflict and pull unreviewed majors. Apply per-package on a branch with the full gate
(mind [[git-worktree-test-hazard]]).
