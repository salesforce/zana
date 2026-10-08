# AGENTS.md

Zana Command Center — an Electron + React + TS multi-project terminal hub.

CLAUDE.md files are `@AGENTS.md` stubs; edit AGENTS.md only.

## Worktrees

Do not create git worktrees by default; work in the existing checkout.
If one is explicitly requested, put it under `.worktrees/<branch-name>` so repo instructions and tooling stay in the ancestor.

## Engineering Rules

1. **The renderer is untrusted — main authorizes.** Validate any path / projectId / cwd in main before granting access; renderer-side checks are advisory.
2. **Confine paths before trusting them.** A renderer- or agent-supplied path is a trust anchor only after `realpath`-matching a registered project (or a HOME/cloneRoot base).
3. **Subscribe long-lived emitters once, at app init** — never inside `createWindow()` (it re-runs). Release every subscription, timer, and per-session resource on its shutdown path.
4. **Shared-file writes are atomic and serialized** — tmp + uniquely-suffixed rename, plus one in-process mutex for read-modify-write (or be strictly append-only).
5. **Keep heavy, unbounded work off the main event loop** — bound/`LIMIT`/paginate growing reads; an accumulating store needs a retention cap.
6. **Core never names a specific extension in logic.** Concrete ids appear only in the `MAIN_MODULES` (empty) / `APP_MODULES` (`docs`) registration. The `'zana'` module-id literal must not appear anywhere in `apps/app/src/**` code; `apps/app/src/__tests__/rule6-zana-literal.guard.test.ts` fails on any bare `'zana'`/`"zana"` token in comment-stripped renderer code. The registration site is guarded by `apps/server/src/services/extensions/__tests__/core-extension-separation.guard.test.ts`.
7. **Promotion to a built-in is deliberate and bounded** — only when the broker can't grant the capability even scoped, and the trusted version (`builtinExec`/`builtinFetch`) is no weaker than its broker-gated twin (redirects, body cap, timeout).
8. **New or modified code needs at least 80% test coverage**, covering meaningful branches and failure paths. For Electron main/renderer seams, also add or update the built-Electron E2E test. Before completion, run the focused tests plus any verification trigger below.
9. **PR monitoring means diagnose and repair.** Watch checks until complete. On failure, use `gh run view <run-id> --job <job-id> --log-failed`; for external checks, `gh api repos/<owner>/<repo>/commits/<sha>/check-runs` then `gh api repos/<owner>/<repo>/check-runs/<id>/annotations` for file, line, rule, and remediation. Fix, verify locally, push, repeat until every required check passes.

## Native runtime and test isolation

- Never flip the installed SQLite addon between Node and Electron. `pnpm rebuild:electron` prepares the Electron ABI cache without replacing Node's binary. Product DB connections use `createSqliteDatabase` (or `sqliteNativeBinding`) from `@zana-ai/zcc-db`.
- `pnpm build` for production output; `pnpm test:e2e -- <spec>` for a private build; `pnpm test:e2e:only -- <spec>` snapshots an existing build. Direct Playwright uses the same isolation. Do not run `electron-vite build` directly or hand-copy native binaries into the installed package.
- Dev output is `out-dev/`, production `out/`. The shared build lock covers preparation and snapshots, not test runs. Each Playwright invocation owns `e2e/.artifacts/runs/<id>`; never clear another run's files.
- E2E homes are isolated by bootstrap; never write or restore the real user's config from a fixture. Regression checks: `docs/native-runtime-isolation.md`.

## Product Design Rules

- **A project has a fixed local or remote target.** Local projects browse their local checkout, remote projects their registered remote checkout. Explorer must not expose a Machine selector or a separate machine/path header, even when backend source mappings exist; thread explorers keep their recorded environment scope internally.
- **Choose a layout per feature; never expose it as a preference.** A panel is either a centered reading/configuration surface or a full-width workbench, encoded in its layout classes. No global "Centered / Full width" Settings control.
- **Keep catalogues distinct by ownership.** ZCC-installed extensions are **Plugins** in the ZCC Plugins hub. Claude Code's `~/.claude/plugins` catalogue is a compatibility surface and must not appear as a competing Settings destination unless a user explicitly asks.
- **Sidebar folders are Projects, not Workspaces.** User-facing copy (website, docs, Plugin Guide, in-app guides) says **Project**. Keep API tokens (`placement: "workspace"`, `--source workspace`, `personal-workspaces/` on disk) unchanged.

## Cross-cutting invariants

- **Core is portable; integrations are extensions.** No environment- or vendor-specific behavior in core. Integration points are the generic SSH parser (`apps/server/src/services/projects/ssh-config.ts`) and the extension SSH-host-provider seam; environment-specific integrations ship as separately distributed extensions, never in this tree.
- **Plugins are full-trust in-process after install and never receive host-daemon tokens.**
- **Verify child-process integrations at the real Electron production boundary**, not only via mocks, shell, or Node/Vitest — Electron main once truncated piped child stdout at exactly 8192 bytes while shell and Vitest saw the full payload. For every main-process CLI integration, test realistic output size, env/HOME, cwd, executable resolution, timeout, and exit/error behavior through the full IPC-to-UI flow in the built app. When pipes can't be proven complete, capture to uniquely named `0600` temp files with a size cap, timeout, concurrency bound, and cleanup on every path. Never swap a proven capture mechanism for `execFile` or piped `spawn` on unit-test or shell evidence. Example (OpenCode discovery): `apps/host-daemon/AGENTS.md`.

## Verification triggers

| Change touches | Run | Details |
| --- | --- | --- |
| Job Team owner-launch surfaces (Team UI, CLI Agent owner, Modern ACP owner) | `pnpm run test:e2e:jobteam` | `docs/job-team-e2e.md` |
| Thread / CLI Agent spawn, mode, reasoning, stop, plugin catalog injection: `acpMode`, `reasoningLevel`, `permissionMode`, `/api/v1/cli-agents`, `term.create`, `harnessRouting` / `executionState` / `modelLevel` / native roles, host-daemon harness providers, `PtyManager.create()`, Control SDK launch/wait, plugin session instructions, `zcc thread` / `zcc agent` | `pnpm live:mode-reasoning` then `pnpm live:memory` | `docs/control-sdk.md` |
| Memory CLI, catalog injection (`contributeInstructions`), scope isolation, `zcc memory` | `pnpm live:memory` | `docs/control-sdk.md` |
| BrowserView leases, loopback CDP, capture, cookie import-source redaction, `zcc browser` / `experimental_desktopBrowsers` | `pnpm live:browser` | `docs/control-sdk.md` |
| OpenCode discovery, filtering, launcher, model catalog | see doc | `apps/host-daemon/AGENTS.md` |
| Packaged plugin runtime seams | `pnpm test:e2e -- e2e/packaged-provider-startup.spec.ts` | `apps/server/src/services/extensions/AGENTS.md` |
| Plugin authoring loop | `pnpm test:e2e -- e2e/plugin-authoring-live.spec.ts` | `apps/server/src/services/extensions/AGENTS.md` |

Live suites (`live:*`) need an attached app on `:8780`/`:8781`, an enrolled host-daemon, and a host shell (`unset ZCC_SESSION_ID`). Preflight skips with `console.warn`, so a verify that finishes in milliseconds is a false green. Keep them off `pnpm live:matrix`.

## Coupling index

Detail lives next to the code and loads when you work there. Read the file before changing that area.

- Spawn argv/env assembly (`PtyManager.create`, `@zana-ai/zcc-spawn-plan`, golden-argv), launch identity registry, OpenCode role/model + discovery → `apps/host-daemon/AGENTS.md`
- Permission broker `"*"` wildcard, `PersonaTeamRegistry`, lifecycle hooks `onInstall`/`onUninstall`, uninstall storage purge, `projectTab.global` → `apps/desktop/src/extensions/AGENTS.md`
- Local plugins, plugin starter templates, packaged plugins, plugin authoring outside the checkout → `apps/server/src/services/extensions/AGENTS.md`
- Plugin-contributed skills + MCP servers, bundled skills + per-project MCP config → `apps/server/src/services/skills/AGENTS.md`
- Feed category registry (SIGNAL vs NOISE) → `packages/domain/AGENTS.md`
- Feed-noise classifier, Activity Feed → `apps/server/src/services/feed/AGENTS.md`
- Inbox `inbox_push`/`inbox_search` split, Inbox AI Summary → `apps/server/src/services/inbox/AGENTS.md`
- Auto-close-idle → `apps/server/src/services/followups/AGENTS.md`
- Shared `gus-*`/`zana-*` CSS, `.module-panel-slot` placement, sidebar automation toggles → `apps/app/AGENTS.md`
- Plugin Guide surfaces roster → `plugins/plugin-guide/AGENTS.md`
- Release feed + release notes rules → `docs/releases/AGENTS.md`
