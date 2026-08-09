# Dependency Audit — 2026-06-23

Scope: `npm audit` + `npm outdated` against `package.json` @ v0.8.5 and the
`packages/*` workspaces. **No files were modified** — analysis only.

## Counts (identical to 2026-06-20 / 06-22)

| Tree | high | moderate | low | total |
|---|---|---|---|---|
| full (incl. dev) | 14 | 3 | 31 | **48** |
| `--omit=dev` (ships to users) | **1** | **1** | 31 | **33** |

The gap is the whole story: **13 of 14 highs are build/dev-only** (the
`tar`/`node-gyp`/`cacache`/`make-fetch-happen`/`form-data` toolchain under
`electron-builder` + `@electron/rebuild`, plus the `vite`/`esbuild` dev server).
The 31 lows are a *single* `@codingame/monaco-vscode-*` advisory counted across
~30 sibling packages.

## What actually reaches users (2 transitive advisories, neither imported by `src/`)

| Package | Installed | Severity | Path | Reachability |
|---|---|---|---|---|
| `hono` | 4.12.23 | **HIGH** | `@modelcontextprotocol/sdk@1.29.0` → `@hono/node-server@1.19.14` → `hono` | Advisories are CORS-wildcard-reflect + AWS Lambda/serve-static. ZCC runs MCP on **local UDS/localhost, stdio** — no Lambda, no public CORS → **not reachable in practice.** |
| `dompurify` | 3.4.5 / 3.4.9 / 3.2.7 | **MODERATE** (XSS) | `monaco-editor`, `@codingame/monaco-vscode-api`, `mermaid@11.15.0` | In path *only* if those render attacker-controlled markup; app renders its own content, renderer is `contextIsolation:true`. Patch opportunistically. |

## What changed since 06-22

Materially **nothing.** Upstream deltas worth recording:
- **`@modelcontextprotocol/sdk` still 1.29.0** — still pins the vulnerable `hono 4.12.23`. Patched `hono@4.12.27` now exists, but the SDK won't pull it → **override still required** to clear the prod HIGH short of waiting on a new SDK.
- **`mermaid` still 11.15.0** — no newer 11.x. Patched `dompurify@3.4.11` now exists → the MODERATE is now clearable via an `overrides` pin (previously the fix only rode on monaco 34).
- **`electron` latest is now 42.5.0** (was 42.4.1). Our 33.4.11 is still EOL.

## Concrete upgrade candidates (with risk notes)

### Tier 0 — within-range, zero-decision (`npm install` picks up)
| Package | Current → Wanted | Risk |
|---|---|---|
| `vitest` | 4.1.8 → 4.1.9 | None — patch. |
| `@types/node` | 22.19.19 → 22.20.0 | None — types patch (stay on 22.x). |
| `@types/react` | 18.3.30 → 18.3.31 | None — types patch. |

### Tier 1 — retire the two prod advisories via `overrides` (now both pinnable)
| Pin | To | Clears | Risk |
|---|---|---|---|
| `hono` | `≥4.12.27` | prod **HIGH** | Low — patch within 4.12.x; verify `@hono/node-server` still resolves. |
| `dompurify` | `≥3.4.11` | prod **MODERATE** | Low — patch line; smoke-test Monaco + mermaid render. |

> This is the cheapest path to a clean `--omit=dev` audit today, since the
> proper-parent fixes (SDK minor, mermaid minor) are still unpublished.

### Tier 2 — build/packaging chain (own branch; build machine only)
| Candidate | Move | Clears | Risk |
|---|---|---|---|
| `electron-builder` | 25.1.8 → 26.15.3 (**MAJOR**) | bulk of HIGH `tar`/`form-data`/`app-builder-lib` cluster | 26 changed signing/notarize defaults — re-test `dist:mac` + `release:mac`. |
| `@electron/rebuild` | 3.7.2 → 4.0.4 (**MAJOR**) | `node-gyp@9`/`tar`/`cacache` HIGHs | Pairs with electron; re-run `npm run rebuild` (node-pty, better-sqlite3). |

### Tier 3 — the big runtime one (own branch)
| Candidate | Move | Why | Risk |
|---|---|---|---|
| `electron` | 33.4.11 → 42.5.0 (**MAJOR, 9 Chromium majors**) | **33 is EOL** — no Chromium security backports. Retires use-after-free / cmdline-injection / ASAR-bypass line. | Rebuild native modules (new ABI); verify sandbox/`contextIsolation`; smoke-test pty, SQLite, Monaco, auto-updater. |
| `better-sqlite3` | 11.10.0 → 12.11.1 (**MAJOR**) | native ABI bump | Couple with the electron rebuild. |

### Tier 4 — major drift, no advisory pressure (deliberate migrations, defer)
| Package | Current → Latest | Note |
|---|---|---|
| `@codingame/monaco-vscode-*` (~30 pkgs) | 33.0.9 → 34.0.3 | **MAJOR, lockstep** — pin all to same 34.x. Also clears dompurify the "proper" way; supersedes the Tier-1 dompurify pin. |
| `react` / `react-dom` (+ `@types/*`) | 18.3.1 → 19.2.x | React 19 migration; large surface. |
| `@xterm/xterm` + addons | 5.5.0 → 6.0.0 | Terminal core major — test pty rendering. |
| `vite` (+ `@vitejs/plugin-react`) | 5.4.21 → 8.1.0 | **MAJOR**, dev-server only. `vitest@4.1.x` already pulls `vite@8` transitively → app builds on 5, tests on 8. Worth unifying. |
| `electron-vite` | 2.3.0 → 5.0.0 | **MAJOR** — riskiest dev change (plugin API churn). Coordinate with vite. |
| `lucide-react` | 0.453.0 → 1.21.0 | Icon-set major — possible renamed/removed icons. |
| `typescript` | 5.9.3 → 6.0.3 | TS 6 — new strictness possible. |
| `@types/node` | 22.x → 26.0.0 | Pin to the **Electron-bundled Node**, not latest. |

## Recommended sequencing
1. **Tier 0 freebies** via `npm install`.
2. **Tier 1 overrides** (`hono ≥4.12.27`, `dompurify ≥3.4.11`) → clean prod audit now.
3. **Tier 2 packaging branch** → collapses the dev/build HIGH cluster; re-test `dist:mac`.
4. **Tier 3 electron branch** → electron 42 + better-sqlite3 12 + native rebuild + full smoke test.
5. **Defer** the Tier 4 migrations (monaco 34, React 19, xterm 6, vite/electron-vite, TS 6).

> `npm audit fix` (non-`--force`) resolves nothing meaningful — every available
> fix is `isSemVerMajor` or gated behind a major parent. All real remediation is
> a deliberate bump or an `overrides` pin. Nothing auto-applied. See
> [[git-worktree-test-hazard]] before running the full gate.
