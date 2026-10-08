# Extension coupling notes

## Scope-allowlist wildcard (exec / net / mcp / stream)

Invariants:
- Permission tokens remain a closed enum; no token-level wildcard.
- `"*"` is honored in `execAllowlist` (any bin), `egressAllowlist` (any host), `mcpAllowlist` (any registered server), `streamAllowlist` (any registered handle).
- Exec basename guard (`scope.bin === basename(scope.bin)`) checked BEFORE wildcard; `/bin/rm`, `../rm`, or a shell string is still rejected (no `sh -c` via wildcard).
- `fsRoots` NEVER has a wildcard — it would defeat Rule 2 confinement and the `fs:write` sensitive-root blocklist (`~/.ssh`, `~/.aws`, `~/.zcc`); fs access is always an enumerated canonical-prefix list.

Why: Wildcard widens scope opaquely without exposing breadth in token list; consent screen renders "*" as "⚠ ANY tool/host (unrestricted)" so user sees impact.

Where: `PermissionBroker.decide` (`permission-broker.ts`) `grant.<list>.has('*') || grant.<list>.has(concrete)`. Consent screen `scopeLines` in `ConsentBody.tsx` (re-exported by `ExtensionConsent.tsx`).

Guard: `broker-caps.ts` delegates to `broker.assert`; `decide` gates are the ONLY enforcement — keep it that way.

When changing: Update consent rendering if wildcard presentation changes; verify basename guard still precedes wildcard check for exec.

## Extension-contributed personas/teams

Invariants:
- Extensions contribute via `ctx.personas`/`ctx.teams` at runtime, in-memory only.
- Provenance is host-stamped (`source: { extensionId }` from authenticated `moduleId`, never literal).
- Ids namespaced `ext:<moduleId>:<slug>`.
- Cleared on teardown/crash.

Why: Rule-6-clean pattern; host owns identity so no extension can forge another's provenance.

Where: `PersonaTeamRegistry` (`persona-team-registry.ts`). Shared gates: `sanitizePersona`/`sanitizeTeam`. Renderer source badge checks `'extensionId' in source`.

When changing: Changes to shared sanitize gates or `PersonaSource` narrowing affect extension-contributed entries; verify renderer badge narrowing stays accurate.

## Extension lifecycle hooks (onInstall/onUninstall)

Invariants:
- `onInstall` fires exactly once per explicit install, via pending-mark consumed on `ready`.
- Mark set BEFORE `runDiskSync()`; NOT cleared on teardown.
- `onUninstall` fires while child alive, before teardown; `dispatchLifecycle` never rejects.
- Hooks are best-effort: a throw, dead child, or deadline resolves and does NOT roll back the install/uninstall.

Why: Sandboxed callbacks (not npm shell scripts); run in same `utilityProcess` with brokered `ctx`. Pending-mark survives reinstall-over-running respawn. Non-rejecting dispatch prevents hook wedging uninstall.

Where: Wire `LifecycleMessage` → `ExtensionProcessHost.dispatchLifecycle` → `host-child.ts handleLifecycle` → `module[hook](ctx)`. Install handler calls `extProcessHost.markPendingInstall(id)` before sync.

When changing: Do NOT move fire onto plain `ready` or becomes per-activation; do NOT clear mark on teardown; ensure `dispatchLifecycle` stays never-rejecting.

## Uninstall purges ctx.storage

Invariants:
- `extensions:uninstall` calls `moduleRouter.storageClear(id)` after removing dir.
- Clears in-memory cache AND `~/.zcc/modules/<id>.json`.
- Called on uninstall only; teardown/disable preserve state.

Why: Storage twin of removing dir; disk KV would outlive dir and reinstall would inherit stale state.

Where: Both tiers (built-in + disk) route through `MainModuleHost`; same split as `storageGet/Set`.

When changing: Preserve uninstall-only call; verify KV outlives-dir scenario doesn't regress.

## projectTab.global (extension surface opt-out)

Invariants:
- `projectTab.global: false` suppresses top-level sidebar entry; absent/`true` keeps dual surface.
- Project-tab-only extension still must branch on `host.getScopedProjectId()` for data scope.

Why: `global:false` hides sidebar entry only; doesn't scope data.

Where: Parsed `discovery.ts parseProjectTab` → `toManifestView`. Typed on `ExtensionManifestView.projectTab` and SDK `ProjectTabContribution`. Docs uses `true` (global rail + per-project Library).

When changing: Verify project-tab-only extensions still scope data themselves; hiding entry doesn't imply scope.
