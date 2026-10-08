# host-daemon — launch & spawn notes

## Spawn-plan assembly in PtyManager.create()

Local-spawn argv/env assembly lives in `PtyManager.create()` and dispatches through the per-profile `LaunchProvider`. `@zana-ai/zcc-spawn-plan` is the pure helper library it draws on (monolithic `buildSpawnPlan` was retired when providers took over identity + layering).

**Invariants:**

1. **Assembly precedence order is exact and observable.** Base profile args → AppConfig globals (in args) → sessionIdArgs → claudeMcpArgs → projectSettings → PERSONA → hookArgs → per-tab extraArgs. Then `mergeAllowedTools(argv, inboxAllow)` from `argv-utils.ts` folds every `--allowedTools` into one last-wins flag. Reordering any layer changes spawned argv.

2. **Golden-argv net is the regression contract.** `apps/host-daemon/src/__tests__/pty-golden-argv.test.ts` snapshots `create()`'s `{command, args, env}` (UUIDs normalized to `<SID>`) across profile × persona × projectSettings × scheduled × overseer × pinned-session × heap-ceiling matrix. A diff in that `.snap` means you changed launch behavior — regenerate only if intended.

3. **Historical import surface preserved via re-exports.** `pty.ts` re-exports `personaArgs_build`, `cleanExtraArgs`, `extractPinnedSessionId`, `applyHeapCeiling`, `buildAutoModeSettings` so test files importing from `../pty.js` keep working. New code should import spawn-plan helpers from `@zana-ai/zcc-spawn-plan` directly.

4. **`buildRemoteCmd` shares the same pure helpers** (`resolveLaunch`, `computeAutoModeActive`, `resolveEffectiveModel`, `personaArgs_build`, `projectSettingsArgs`, `cleanExtraArgs`, `buildHookSettings`) but assembles its own remote precedence. A change to a shared helper touches both local and remote spawn paths; keep them in lockstep (see `pty.ts createRemote()` remote-parity hot-zone note).

**Why:** Dispatching through providers eliminated duplicate identity logic; precedence order is the observable contract; pure helpers enable remote/local sharing.

**When changing:**
- Run `apps/host-daemon/src/__tests__/pty-golden-argv.test.ts` and regenerate snapshots only if the argv change was intended.
- Verify both local (`create()`) and remote (`buildRemoteCmd`) paths if touching a shared helper.

## Launch IDENTITY registry-dispatched

Launch identity is registry-dispatched via `apps/host-daemon/src/harness/registry.ts`, the `MAIN_MODULES` analogue for interactive harnesses (Rule 6). Per-profile launch identity — concrete provider id, tab title, capability descriptor, base command/args — lives only in per-harness folders (`harness/claude/`, `harness/shell/`, …) + the registry (`HARNESS_REGISTRATIONS`), never re-inlined in core launch logic.

Core resolves a profile via `providerFor(profile)` and reads `.title(...)`, `.capabilities(...)`, `.resolveBaseLaunch(...)`. The seam owns only identity; byte-sensitive argv/env/hook assembly stays in `PtyManager.create()` (drawing on `@zana-ai/zcc-spawn-plan` pure helpers).

**Invariants:**

1. **`providerFor` is total over registered profiles.** Every registered profile is served by exactly one provider. The `?? leastCapable` (`LeastCapableProvider`) fallback is a defensive floor for an unknown persisted profile (degrades to the non-featureful shell floor, never crashes the spawn). Adding a harness = one `harness/<id>/` folder + one `HARNESS_REGISTRATIONS` entry in `registry.ts`, zero caller edits.

2. **Providers are stateless value objects.** Registry is a boot-time constant, not rebuilt per `createWindow` (Rule 3: nothing to subscribe/dispose).

3. **`pty.ts` tab title delegates** to `providerFor(profile).title(profile)`, byte-identical to old inline map, asserted by golden-argv net (which snapshots `create()`'s title).

4. **Two source-text guards protect the seam.** `apps/host-daemon/src/__tests__/rule6-launch-provider.guard.test.ts` fails if `'claude-code'` id or a bare launch-profile comparison reappears in `pty.ts`. Existing `packages/domain/src/launch-provider.guard.test.ts` forbids a re-rolled `isClaudeProfile` triplet. Keep the two `-suffix` claude profile literals on separate lines in provider code (a one-line pair trips the dedup guard).

**Why:** Providers own identity so concrete harness ids stay out of core (Rule 6); the seam owns identity only, not argv/env assembly.

**Guards:**
- `apps/host-daemon/src/__tests__/rule6-launch-provider.guard.test.ts` (no `'claude-code'` literal in `pty.ts`)
- `packages/domain/src/launch-provider.guard.test.ts` (no re-rolled `isClaudeProfile` triplet)

**When changing:** Run both guard tests.

## OpenCode role/model coupling

OpenCode agent discovery uses bounded temp-file capture (`opencode agent list` + `opencode debug agent`) in `apps/host-daemon/src/harness/opencode/provider.ts`. Its live consumer is launch-time preflight, not the picker: `discoverRoleTargets`, called from `preflightStructuredRouting` in `apps/server/src/services/launch/execution-routing.ts`, validates the picked `--agent` role and blocks the spawn (`role target unavailable`, surfaced as `Structured execution unavailable: …` error toast) when the role is not directly-launchable (non-subagent, non-hidden) agent.

CLI Agent picker no longer runs discovery — it sources native roles from the same ACP session-mode list the Modern composer uses (`catalogEntry.acpMode`, from `acp-opencode` `session/new` `mode` configOption), so both surfaces show identical, plain-named list. A picked mode that maps to a subagent (surfaced as a mode but not directly launchable) is offered in the picker yet rejected at preflight — deliberate.

**A picked native role and a forced catalog `--model` are mutually exclusive — the role wins, carrying no model.** An OpenCode agent pins its own model; forcing a catalog model alongside `--agent <role>` overrides that pin and dies with `ProviderModelNotFoundError` (dead session / exit 64) on any install whose provider inventory differs from shipped static snapshot (e.g. `llmgw`-backed setup with stale `aisuite/*` catalog).

**Enforced at two layers** (forced model reaches argv from more than the composer):

1. Composer (`LegacyAgentHomeComposer` `launch()`) builds `adapterEntry` as role-XOR-model, so per-tab model isn't co-sent.

2. Authoritative gate at argv assembly: resolved native role suppresses the injected `--model` from any source (per-tab / persona / project / global `harnessRouting`), via `provider.nativeRolePinsModel` capability flag (`BaseLaunchProvider` default `false`; `OpenCodeProvider` `true`, Rule-6-clean — no provider literal in core). `pty.ts create()` gates both `modelTarget.contribution` splices on `suppressModelForRole = roleTarget.targetId && provider.nativeRolePinsModel`. Remote paths (`base-provider.ts simpleRemoteExec`, `OpenCodeProvider.buildRemoteCommand`) gate identically.

Composer fix alone was insufficient — observed exit-64 came from global routing (`~/.zcc/config.json harnessRouting.byAdapter.opencode.modelTargetId`), which composer can't clear.

**Launch-boundary fixture** (`e2e/fixtures/bin/opencode`) reproduces the failure: its bare TUI exits 64 when `--model` rides with `--agent` (any model id) or on bare `aisuite/*` `--model`, so positive `reviewer` launch passing proves the model was dropped.

**OpenCode model catalog** (`opencode/provider.ts targets`) is release-maintained snapshot of `opencode models`; it drifts (gateway renamed `aisuite/*` → `llmgw/*` with `-1M` gpt suffix). Suppression protects role launches from that drift; no-role path still needs correct catalog.

**Why:** Electron child-process runtime differs from Node/shell. Piped stdout truncated at 8192 bytes in observed failure while shell/Vitest returned complete payload. Temp-file capture with explicit bounds + cleanup on every path is the proven mechanism. A native role pins its model; forced model conflicts must be suppressed at spawn, not only at composer.

**When changing discovery, filtering, IPC, launcher, or model catalog, run both:**

1. Deterministic launch-boundary spec:
   ```
   pnpm test:e2e -- e2e/opencode-launch-boundary.spec.ts
   ```
   Proves preflight `discoverRoleTargets` resolves directly-launchable role (spawns) and rejects subagent role (`role target unavailable` toast) at real Electron boundary.

2. Live ACP mode list:
   ```
   ZCC_LIVE_OPENCODE=1 npx playwright test e2e/opencode-agent-picker.spec.ts -g 'actual project agents'
   ```
   Against this actual project + HOME config — proves live ACP mode list reaches picker with plain names.
