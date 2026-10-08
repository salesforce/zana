# Extensions service coupling notes

## Local plugins are ordinary installs + pointer

Invariants:
- "create your own plugin" (`CreateExtensionDialog` → `extensions:createLocal`) mints unique id, scaffolds into `~/zcc-workspace/extensions/<id>`.
- Scratch working dir is never HOME, a project, or `~/.zcc`.
- Reload/Continue re-derive the working dir from main's `local.json`, never renderer/agent free-text; renderer passes only an id (Rule 1).
- Registers dedicated project `Ext: <title>` (`category: 'Extensions'`, `EXTENSION_PROJECT_CATEGORY`), idempotent by path + self-healing.
- Opens Creator agent (`builtin:ext-creator`, `baseProfile: claude`, `permissionMode: acceptEdits`) bounded to working dir.
- Agent output INERT until main path-installs via `PluginService`.
- No "trust local" fast-path; same install/enable confirm as any plugin.

Why: Scaffold includes `AGENTS.md`/`CLAUDE.md` for orient + trust boundary + `zcc plugin dev` loop. Local stored beside install in `local.json` (`discovery.markLocal`/`getLocalRecord`/`clearLocal`, keyed id → `{ workingDir }`), never inside plugin dir.

Where: `local-extension.ts mintLocalId`, `workingDirFor(scratchWorkspaceRoot(), id)`. `local.json` read by `reinstallLocal(id)` which sanity-checks plugin id matches registry key (ID_MISMATCH). `localInfo`/`createLocal` return working dir + dedicated Extensions-category project id (re-derived via `ensureExtensionProject`, Rule 1). Hub reads `entry.source === 'local'` for badge + local actions.

Guard: `apps/server/src/services/extensions/__tests__/local-extension-install-seam.guard.test.ts` scans `local-extension.ts` source for `~/.zcc`; naive backtick-pairing desyncs on lone backtick in code.

When changing: `'Extensions'` category string shared with ListPane `projects:extensions` group — change both. Uninstall calls `clearLocal(id)` but LEAVES working dir on disk (user's in-progress work); a re-create mints a fresh id, never reclaims the orphaned dir. Leftover `extension.json` working dirs still pack through `installFromDir`.

## Starter generated from @zana-ai/zcc-plugin-templates

Invariants:
- `scaffoldLocalExtension` calls `scaffoldPlugin()` which writes from `pluginScaffoldFileMap` in `packages/plugin-templates/src/files.ts`.
- Generates `package.json` `zcc` plugin (panel / main-panel / mcp-consumer / agent-preset).
- Tokens are scaffold args (`id`, `name`, `description`), not `__EXT_ID__` substitution.
- Generates identical `AGENTS.md` and `CLAUDE.md` (both from `claudeMd()`) plus `LIVE_TEST.md`; `packages/plugin-templates/src/index.test.ts` asserts they match.

Why: No `extension.json` disk template; enhance starter by editing file map.

Where: File map defines kinds, `definePluginApp` panel, server factory, skills, MCP. Creator auto-loads `AGENTS.md`/`CLAUDE.md` as project instructions; `extension-creator` / `zcc-plugin-authoring` skills are deeper reference.

Guard: Install-seam guard backtick gotcha documented in test; avoid stray backticks in `local-extension.ts` non-template-literal code.

When changing: Update file map for starter enhancements; generated `AGENTS.md`/`CLAUDE.md` references stay in sync with skills; starter teaches `.module-panel-slot` fill pattern (`height: '100%'`).

## Packaged plugins ship compiled runtimes

Invariants:
- `scripts/before-pack-plugins.mjs` runs for every electron-builder packaging; produces `out/packaged-plugins`.
- Bundles server/app/pty entries, prebuilt `dist/host.js` + checksum, skills, branding, declared `zcc.extra.runtimeAssets`.
- Never copy plugin sources or node_modules into app.
- `loadPluginHostArtifactSnapshot` validates shipped bridges without rebuilding.
- Failed bridge retains unavailable provider declarations for existing threads; clears usable model choices; directs users to Plugins.

Why: Runtime assets referenced by URL must be declared (e.g., Salesforce `playground/dist`). Path installs rebuild; builtin rebuilding requires `watchBuiltinPluginSources` (managed development). Failed replacements preserve last running generation.

Guard: `e2e/packaged-provider-startup.spec.ts` covers retained source, compiled runtimes, corruption, recovery. Mac and Windows release gates also run it against actual packaged executable.

When changing: Run E2E on these seams; verify packaging includes declared runtime assets; ensure failed bridge preserves last-good generation.

## Plugin authoring must work outside checkout

Invariants:
- CLI `scripts/postbuild.mjs` includes esbuild's platform binaries and SDK app facade/types in `dist/`; `extraResources` copies complete tree.
- Scaffolds teach in `AGENTS.md`, `CLAUDE.md`, and `LIVE_TEST.md`; skills `zcc-plugin-authoring` / `extension-creator` aligned.
- `plugin dev --once` must return nonzero on failure; reload HTTP ack insufficient (PluginService preserves last-good generation).

Why: Repo-local CLI test can hide missing packaged dependencies.

Guard: `packages/cli/src/__tests__/bundled-bin.test.ts` and `e2e/plugin-authoring-live.spec.ts` copies CLI outside repo, verifies create/install, UI↔CLI, reload/persistence, broken builds, failed backend replacements in Electron.

When changing: Run both bundled-bin unit test and live E2E for authoring-loop changes; verify `--once` returns nonzero on failure.
