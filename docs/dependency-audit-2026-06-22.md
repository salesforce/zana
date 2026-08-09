# Dependency Audit — 2026-06-22

Scope: `npm audit` + `npm outdated` against `package.json` @ v0.8.5 and the
`packages/*` workspaces (`@zcc/cli`, `@zana-ai/zcc-extension-sdk`). **No files were
modified** — analysis only.

`npm audit`: **48 vulnerabilities — 14 high, 3 moderate, 31 low.**
With `--omit=dev`: **33 — 1 high, 1 moderate, 31 low.** That gap is the whole
story: **13 of the 14 highs are build/dev-only** (the `tar` / `node-gyp` /
`cacache` / `make-fetch-happen` / `form-data` toolchain under `electron-builder`
+ `@electron/rebuild`, and the `vite`/`esbuild`/`electron-vite` dev server).
They never ship in a release build. The 31 lows are a *single*
`@codingame/monaco-vscode-*` advisory counted across ~30 sibling packages.

State is materially **unchanged since the 2026-06-20 audit**. Two cosmetic
deltas only: `form-data` and `hono` now report non-major fixes — but both are
held back by major-version *parents* (see notes), so neither lands without a
deliberate parent bump.

Workspaces (`packages/cli`, `packages/extension-sdk`) have **no runtime deps**
of their own; `cli` carries only `vitest` (dev). Nothing to triage there.

---

## What actually reaches users (prod tree)

Only two advisories survive `--omit=dev`, and both are **transitive — neither is
imported by our `src/`**:

| Package | Severity | Path | Real-world reachability |
|---|---|---|---|
| `hono` 4.12.23 | **HIGH** | `@modelcontextprotocol/sdk@1.29.0` → `@hono/node-server` → `hono` | Advisories are CORS-wildcard-reflects-Origin + AWS Lambda/serve-static. ZCC runs the MCP server on **local UDS/localhost, stdio**, no Lambda, no public CORS → **not reachable in practice.** |
| `dompurify` ≤3.4.10 | **MODERATE** (XSS / prototype-pollution bypass) | `monaco-editor@0.55.1`, `@codingame/monaco-vscode-api`, `mermaid@11.15.0` | In the threat path *only* if those surfaces render attacker-controlled markup. App renders its own markdown/diagrams; renderer is `contextIsolation:true` / no `nodeIntegration`. Patch opportunistically. |

`electron-updater` 6.8.9 — no advisory, but it's the auto-update trust anchor;
keep current alongside any electron bump.

---

## Concrete upgrade candidates (with risk notes)

### Tier 0 — within-range, zero-decision (a plain `npm install` picks these up)
| Package | Current → Wanted | Risk |
|---|---|---|
| `vitest` | 4.1.8 → 4.1.9 | None — patch. Do anytime. |
| `@types/node` | 22.19.19 → 22.20.0 | None — types patch (stay on 22.x, see Tier 4). |
| `@types/react` | 18.3.30 → 18.3.31 | None — types patch. |

### Tier 1 — runtime advisories, but blocked behind a parent bump
| Candidate | Move | Clears | Risk |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | 1.29.0 → latest 1.x that pins `hono ≥ 4.12.26` | the prod **hono HIGH** | Low — SDK minor. **Latest published SDK is still 1.29.0 today**, so the patched hono may not be pullable yet; recheck, or add an `overrides` pin for `hono` if it stays stuck. |
| `mermaid` | 11.15.0 → latest 11.x | part of the **dompurify MODERATE** | Low — minor; pulls patched dompurify. **Latest 11.x is currently 11.15.0**, so no newer 11 is available right now — dompurify fix here rides on the monaco bump (Tier 4) instead. |

> Net: the two *prod* advisories have **no clean in-range fix available today**.
> Both fixes are gated on either an unreleased SDK minor or the monaco-vscode 34
> major. An `overrides` pin for `hono`/`dompurify` is the only way to force them
> short of those bumps.

### Tier 2 — build/packaging chain (own branch; runs on build machine only)
| Candidate | Move | Clears | Risk |
|---|---|---|---|
| `electron-builder` | 25.1.8 → 26.15.3 | **MAJOR** | bulk of the HIGH `tar`/`form-data`/`app-builder-lib`/`dmg-builder` cluster | 26 changed signing/notarize defaults — re-test `dist:mac` + `release:mac` (GH_TOKEN/soma feed). |
| `@electron/rebuild` | 3.7.2 → 4.0.4 | **MAJOR** | the `node-gyp@9`/`tar`/`make-fetch-happen`/`cacache` HIGHs on the native-rebuild side | Pairs with electron bump; re-run `npm run rebuild` after (node-pty, better-sqlite3). |

After both: re-run `npm audit` — the HIGH count should collapse to ~1 (hono).

### Tier 3 — the big runtime one (own branch)
| Candidate | Move | Why | Risk |
|---|---|---|---|
| `electron` | 33.4.11 → 42.4.1 | **MAJOR (9 Chromium majors)** | **33 is EOL** — no more Chromium security backports. Retires the use-after-free / cmdline-injection / ASAR-bypass advisory line (fixed in 39.8.x). | Large jump. Rebuild native modules against new ABI; verify `webPreferences`/sandbox/`contextIsolation` defaults; smoke-test pty, SQLite, Monaco, auto-updater. Step to a current even major (40/42). |
| `better-sqlite3` | 11.10.0 → 12.11.1 | **MAJOR** | native ABI bump | Couple with the electron upgrade (single rebuild). |

### Tier 4 — major drift, no advisory pressure (deliberate migrations, defer)
| Package | Current → Latest | Note |
|---|---|---|
| `@codingame/monaco-vscode-*` (~30 pkgs) | 33.0.9 → 34.0.3 | **MAJOR, lockstep** — pin all to the same 34.x. Also the dompurify carrier, so this bump is what actually clears the prod MODERATE. Big coupled lift. |
| `react` / `react-dom` (+ `@types/*`) | 18.3.1 → 19.2.x | React 19 migration; large surface. |
| `@xterm/xterm` + addons | 5.5.0 → 6.0.0 | Terminal core major — test pty rendering. |
| `vite` | 5.4.21 → 8.0.16 | **MAJOR**, dev-server only. Note: `vitest@4.1.x` already pulls `vite@8` transitively → app build on 5, test path on 8. Worth unifying. |
| `electron-vite` | 2.3.0 → 5.0.0 | **MAJOR** — moves bundler onto vite 6/7+; riskiest dev change (plugin API churn). Coordinate with the vite bump. |
| `lucide-react` | 0.453.0 → 1.21.0 | Icon-set major — possible renamed/removed icons. |
| `typescript` | 5.9.3 → 6.0.3 | TS 6 — new strictness breaks possible. |
| `@types/node` | 22.x → 26.0.0 | Pin to the **Electron-bundled Node**, not latest. |
| `@vitejs/plugin-react` | 4.7.0 → 6.0.2 | Moves with the vite major. |

---

## Recommended sequencing
1. **Tier 0 freebies** — `vitest` 4.1.9 + the two `@types` patches via `npm install`.
2. **Tier 2 packaging branch** — `electron-builder` 26 + `@electron/rebuild` 4 → clears the HIGH `tar`/`form-data`/`node-gyp` cluster. Re-test `dist:mac`.
3. **Tier 3 electron branch** — electron → current even major + `better-sqlite3` 12 + native rebuild + full smoke test.
4. **Tier 1 overrides** — if SDK/mermaid stay stuck, add `overrides` pins for `hono ≥ 4.12.26` and `dompurify ≥ 3.4.11` to retire the two prod advisories without waiting on the majors.
5. **Defer (own migrations):** monaco-vscode 34 (also fixes dompurify), React 19, xterm 6, vite/electron-vite 8, TS 6.

> `npm audit fix` (non-`--force`) resolves **nothing meaningful** here — every
> available fix is `isSemVerMajor` or gated behind a major parent. All real
> remediation is a deliberate bump, which is why none is auto-applied.
