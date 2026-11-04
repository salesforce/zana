# Live Zana verification

Exact verification commands for changes that touch launch, memory, browser, plugin, or window surfaces; root `AGENTS.md` points here.

| Change touches | Run | Details |
| --- | --- | --- |
| Job Team owner-launch surfaces (Team UI, CLI Agent owner, Modern ACP owner) | `pnpm run test:e2e:jobteam` | `docs/job-team-e2e.md` |
| Thread / CLI Agent spawn, mode, reasoning, stop, plugin catalog injection: `acpMode`, `reasoningLevel`, `permissionMode`, `/api/v1/cli-agents`, `term.create`, `harnessRouting` / `executionState` / `modelLevel` / native roles, host-daemon harness providers, `PtyManager.create()`, Control SDK launch/wait, plugin session instructions, `zcc thread` / `zcc agent` | `pnpm live:mode-reasoning` then `pnpm live:memory` | `docs/control-sdk.md` |
| Memory CLI, catalog injection (`contributeInstructions`), scope isolation, `zcc memory` | `pnpm live:memory` | `docs/control-sdk.md` |
| BrowserView leases, loopback CDP, capture, cookie import-source redaction, `zcc browser` / `experimental_desktopBrowsers` | `pnpm live:browser` | `docs/control-sdk.md` |
| OpenCode discovery, filtering, launcher, model catalog | see doc | `apps/host-daemon/AGENTS.md` |
| Packaged plugin runtime seams | `pnpm test:e2e -- e2e/packaged-provider-startup.spec.ts` | `apps/server/src/services/extensions/AGENTS.md` |
| Plugin authoring loop | `pnpm test:e2e -- e2e/plugin-authoring-live.spec.ts` | `apps/server/src/services/extensions/AGENTS.md` |
| Windows title bar overlay (caption button colours, `titleBarOverlay`, title bar `--bg-base` / `--text-muted` / `--titlebar-h`) | On Windows: `pnpm test:e2e -- e2e/windows-titlebar-overlay-theme.spec.ts` (skips on Linux CI) | `apps/desktop/src/window/titlebar-overlay.ts` |

Live suites (`live:*`) need an attached app on `:8780`/`:8781`, an enrolled host-daemon, and a host shell (`unset ZCC_SESSION_ID`). Preflight skips with `console.warn`, so a verify that finishes in milliseconds is a false green. Keep them off `pnpm live:matrix`.
