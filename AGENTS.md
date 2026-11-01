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
8. **New or modified code needs at least 80% test coverage**, covering meaningful branches and failure paths. For Electron main/renderer seams, also add or update the built-Electron E2E test. Before completion, run the focused tests plus any matching command in the Verification triggers section (`docs/live-zana-verification.md`).
9. **PR monitoring means diagnose and repair.** Watch checks until complete. On failure, use `gh run view <run-id> --job <job-id> --log-failed`; for external checks, `gh api repos/<owner>/<repo>/commits/<sha>/check-runs` then `gh api repos/<owner>/<repo>/check-runs/<id>/annotations` for file, line, rule, and remediation. Fix, verify locally, push, repeat until every required check passes.

## Native runtime and test isolation

- Never flip the installed SQLite addon between Node and Electron. `pnpm rebuild:electron` prepares the Electron ABI cache without replacing Node's binary. Product DB connections use `createSqliteDatabase` (or `sqliteNativeBinding`) from `@zana-ai/zcc-db`.
- `pnpm build` for production output; `pnpm test:e2e -- <spec>` for a private build; `pnpm test:e2e:only -- <spec>` snapshots an existing build. Direct Playwright uses the same isolation. Do not run `electron-vite build` directly or hand-copy native binaries into the installed package.
- Dev output is `out-dev/`, production `out/`. The shared build lock covers preparation and snapshots, not test runs. Each Playwright invocation owns `e2e/.artifacts/runs/<id>`; never clear another run's files.
- E2E homes are isolated by bootstrap; never write or restore the real user's config from a fixture. Regression checks: `docs/native-runtime-isolation.md`.

## Local verification

- Day-to-day changed-code verification: `pnpm verify:fast`. It runs typecheck, `vitest run --changed origin/main`, and source-text guard tests. Full CI remains merge authority.
- Pre-push verifies feature branches in an isolated snapshot with typecheck, changed tests, and source-text guards. Protected refs and unsafe push shapes run `pnpm verify:full`. Policy: `docs/native-runtime-isolation.md`.

### Optional TinyNod review and skips

Guide: `docs/tinynod-local-review.md`. Opt-in is `git config zana.tinynod.enabled true` or `ZANA_TINYNOD_REVIEW=1`; the pre-push adapter (`scripts/tinynod-pre-push-review.mjs`) runs an advisory review when enabled. Setup, opt-in/out, reading results, and troubleshooting are in the guide.

- When reporting a push or handoff, state the skip/review reason, base, head, and which checks ran (Zana verification, TinyNod). Include no secrets, config bodies, or prompt contents.
- Never claim a change was reviewed by TinyNod when review was skipped, failed, timed out, or returned non-JSON; that is a warning, not a clean review.
- Never use `TINYNOD_SKIP_HOOK` to hide findings. It skips TinyNod only; Zana verification still runs.
- The full pre-hook skip is a separate permission. If used, list every skipped gate (Zana verification and TinyNod).
- Never run `tinynod hooks install` or change global `core.hooksPath`; Zana owns `.githooks`.

## Product Design Rules

- **Explore meaningful UI changes interactively.** When building or substantially changing a user-facing Zana feature or plugin, proactively show a realistic, clickable mock early, with meaningful alternatives or a Current / Proposed comparison where useful; do not wait for an explicit mockup request. Make the interactions under review work. In Zana desktop, show the preview in the thread's in-app browser; in remote chat, return an accessible preview or artifact through that conversation. Use the `zana-ui-proposals` skill when available. Keep trivial fixes lightweight, honor explicit requests to implement directly, and continue within existing authorization without adding an automatic approval gate.
- **A project has a fixed local or remote target.** Local projects browse their local checkout, remote projects their registered remote checkout. Explorer must not expose a Machine selector or a separate machine/path header, even when backend source mappings exist; thread explorers keep their recorded environment scope internally.
- **Choose a layout per feature; never expose it as a preference.** A panel is either a centered reading/configuration surface or a full-width workbench, encoded in its layout classes. No global "Centered / Full width" Settings control.
- **Keep catalogues distinct by ownership.** ZCC-installed extensions are **Plugins** in the ZCC Plugins hub. Claude Code's `~/.claude/plugins` catalogue is a compatibility surface and must not appear as a competing Settings destination unless a user explicitly asks.
- **Sidebar folders are Projects, not Workspaces.** User-facing copy (website, docs, Plugin Guide, in-app guides) says **Project**. Keep API tokens (`placement: "workspace"`, `--source workspace`, `personal-workspaces/` on disk) unchanged.

## Cross-cutting invariants

- **Help videos publish independently of app releases.** Add/revise the public catalogue and immutable media under `content/videos/`; read `content/videos/AGENTS.md` and `content/videos/README.md`. Merge content into `main` and run `pnpm exec tsx scripts/check-help-videos.ts`. Preserve stable IDs and compatibility bounds; do not add future videos only to the bundled renderer list or tag an app release just to publish a video.

- **Core is portable; integrations are extensions.** No environment- or vendor-specific behavior in core. Integration points are the generic SSH parser (`apps/server/src/services/projects/ssh-config.ts`) and the extension SSH-host-provider seam; environment-specific integrations ship as separately distributed extensions, never in this tree.
- **Plugins are full-trust in-process after install and never receive host-daemon tokens.**
- **Verify child-process integrations at the real Electron production boundary**, not only via mocks, shell, or Node/Vitest — Electron main once truncated piped child stdout at exactly 8192 bytes while shell and Vitest saw the full payload. For every main-process CLI integration, test realistic output size, env/HOME, cwd, executable resolution, timeout, and exit/error behavior through the full IPC-to-UI flow in the built app. When pipes can't be proven complete, capture to uniquely named `0600` temp files with a size cap, timeout, concurrency bound, and cleanup on every path. Never swap a proven capture mechanism for `execFile` or piped `spawn` on unit-test or shell evidence. Example (OpenCode discovery): `apps/host-daemon/AGENTS.md`.

## Verification triggers

Triggers: Job Team launch surfaces; thread/CLI Agent lifecycle and configuration (spawn, stop, mode, reasoning, permissions, plugin catalog injection: `PtyManager.create()`, `term.create`, `/api/v1/cli-agents`, `acpMode` / `reasoningLevel` / `permissionMode`, `harnessRouting`, `zcc thread` / `zcc agent`); memory CLI (`contributeInstructions`, `zcc memory`); BrowserView / `zcc browser`; OpenCode discovery; packaged plugin runtime and plugin authoring; Windows title bar overlay (`titleBarOverlay`, `--bg-base` / `--titlebar-h`). Touching any of these requires reading [docs/live-zana-verification.md](docs/live-zana-verification.md) for the exact command before claiming verification.

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
