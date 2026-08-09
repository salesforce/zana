# Dependency audit — 2026-06-24

Scheduled vuln + version-drift sweep. **Inspection only — nothing installed or
edited.** Follows up [`dependency-audit-2026-06-23.md`](dependency-audit-2026-06-23.md).

## TL;DR

- `npm audit`: **48 total** (31 low, 3 moderate, 14 high). `--omit=dev`: **33** (31
  low, 1 moderate, 1 high). Counts unchanged vs 06-23.
- **Two real deltas since 06-23:** `hono` and `form-data` HIGH advisories now both
  report a **non-major in-range fix** (`fixAvailable: true`) — no `overrides` pin
  needed anymore for hono.
- **New drift finding:** `npm audit fix` can't run at all — `vite@6` vs
  `electron-vite@2.3.0` (peers `vite ^4||^5`) **ERESOLVE conflict**. Fixes must be
  applied per-package, not via blanket `audit fix`.
- Only **two advisories reach prod**, both transitive, both low real-world reach
  (unchanged analysis): `hono` (local UDS MCP, no Lambda/CORS) and `dompurify`
  (renders own content).
- **Electron 33.4.11 is EOL** and carries 18 advisories fixed in ≥38.8.6/39.8.5.
  Biggest single risk item; needs a deliberate major.

## Prod-reaching vulnerabilities (the ones that matter)

| Pkg | Sev | Path | Fix today | Real-world reach |
|---|---|---|---|---|
| **hono** ≤4.12.24 | HIGH | `@modelcontextprotocol/sdk@1.29.0` → `@hono/node-server@1.19.14` → hono@4.12.23 | **In-range, non-major** (`audit fix` would bump to ≥4.12.27; SDK pin no longer blocks) | Low — advisories are Lambda@Edge / serve-static / CORS; ZCC runs MCP on local UDS/localhost, no Lambda, no public CORS |
| **dompurify** ≤3.4.10 | MOD (XSS) | monaco-editor@0.55.1 (3.2.7), mermaid@11.15.0 (3.4.9), monaco-vscode-api@33 (3.4.5) | Only via **monaco-vscode 34 major**, or an `overrides` pin to dompurify@3.4.11 | Low — reachable only if those render attacker-controlled markup; app renders own content |

**Recommendation:** the hono delta is the cleanest win available — a plain targeted
update now patches a HIGH with no major bump and no override. dompurify still needs
either the monaco-34 major or a pin; patch opportunistically.

## High-severity dev/build-only (do not reach the shipped app)

All gated behind major bumps; none load at runtime.

| Cluster | Advisory chain | Fix |
|---|---|---|
| **electron-builder@25.1.8** | `app-builder-lib`, `dmg-builder`, `…-squirrel-windows`, **`form-data@4.0.5`** (CRLF injection, GHSA-hmw2-7cc7-3qxx) | electron-builder **26.15.3** (major). `form-data` itself now has `fixAvailable: true` but its only parent is app-builder-lib, so it rides the major |
| **@electron/rebuild@3** | `@electron/node-gyp`, `node-gyp`, `make-fetch-happen`, `cacache`, `tar` | `@electron/rebuild` **4.0.4** (major) |
| **electron-vite@2.3.0** | `esbuild` (moderate, dev-server SSRF) | electron-vite **5.0.0** (major) — also resolves the ERESOLVE below |

## Major-version drift (`Current == Wanted`, intentional upgrades)

| Pkg | Cur | Latest | Risk note |
|---|---|---|---|
| **electron** | 33.4.11 | 42.5.0 | ⚠️ **EOL + 18 advisories** (ASAR integrity bypass, multiple UAF, IPC spoofing — fixed ≥38.8.6/39.8.5). Highest-priority major. Native-module rebuild + main-process API review needed |
| **electron-vite** | 2.3.0 | 5.0.0 | ⚠️ **Currently conflicts with `vite@6`** (peer wants `^4\|\|^5`) → installed only via legacy-peer-deps; blocks `npm audit fix`. Upgrading realigns the toolchain |
| **electron-builder** | 25.1.8 | 26.15.3 | Clears the whole build-chain HIGH cluster incl. form-data |
| **@electron/rebuild** | 3.x | 4.0.4 | Clears node-gyp/tar cluster |
| **@codingame/monaco-vscode-*** (≈30 pkgs) | 33.0.9 | 34.0.3 | Lockstep major; carries patched dompurify. Editor-surface regression test needed |
| **react / react-dom** | 18.3.1 | 19.2.7 | Deliberate React 19 migration (also `@types/react` 18→19) |
| **vite** | 6.4.3 | 8.1.0 | Couple to the electron-vite bump |
| **typescript** | 5.9.3 | 6.0.3 | TS 6 major |
| **better-sqlite3** | 11.10.0 | 12.11.1 | Native rebuild; pair with the electron major |
| **@xterm/xterm** (+addons) | 5.5.0 | 6.0.0 | Terminal-surface major |
| **lucide-react** | 0.453.0 | 1.21.0 | Icon API churn possible |
| **@vitejs/plugin-react** | 4.7.0 | 6.0.3 | Couple to vite/electron-vite |
| **@types/node** | 22 | 26 | Track Node runtime target |

## Within-range safe bumps (picked up by plain `npm install`)

`Wanted > Current` — non-breaking: `vitest` 4.1.8→4.1.9 (+ minor `@types/*` per
06-23). Note: the lockfile still installs via legacy-peer-deps because of the
vite/electron-vite conflict, so even a "safe" install should be verified.

## Recommended sequencing (no action taken)

1. **Targeted, low-risk now:** update `hono` to its patched in-range release (HIGH,
   prod, no major) — the single cleanest fix on the board.
2. **Toolchain realign (one branch):** `electron-vite` 5 + `vite` 8 +
   `@vitejs/plugin-react` 6 together — fixes the ERESOLVE and the esbuild moderate.
3. **Build-chain majors:** `electron-builder` 26 + `@electron/rebuild` 4 — clears the
   form-data/node-gyp/tar HIGH cluster (dev-only, low urgency).
4. **Deliberate, highest security value:** `electron` 33→latest (EOL, 18 advisories).
   Pair with `better-sqlite3` 12 native rebuild.
5. **Opportunistic:** monaco-vscode 34 (carries patched dompurify), React 19, TS 6.

`npm audit fix --force` is **not** advised — it would force-resolve the vite peer
conflict and pull unreviewed majors. Apply per-package on a branch with the full gate
(mind [[git-worktree-test-hazard]]).
