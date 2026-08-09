# Harness — the interactive-launch seam

This directory is the **launch layer**: everything provider-SPECIFIC about turning
a launch *profile* (`claude`, `cursor`, `codex`, `shell`, …) into a spawned
process. `PtyManager` (`../pty.ts`) owns the provider-AGNOSTIC orchestration
(session-id minting, the launcher-owned MCP config file, lifecycle hooks, session
env, backlog/batching/capacity) and dispatches every provider-*identity* decision
through this seam.

## The pieces

| File | Role |
|------|------|
| `launch-provider.ts` | The `LaunchProvider` interface + its input types (`ResolvedLaunch`, `AutoModeInput`, `RemoteCommandInput`). |
| `base-provider.ts` | `BaseLaunchProvider` — the abstract base with the no-op defaults every provider inherits (capabilities delegation, empty `-c`-channel/persona/project builders, "no auto mode", "no pinned session", the `simpleRemoteExec` template). Extend this. |
| `registry.ts` | `providerFor(profile)` — the ONE place a concrete profile id is paired with a provider instance (the Rule-6 registration seam, mirroring `MAIN_MODULES`). |
| `argv-utils.ts` | `cleanExtraArgs` + `mergeAllowedTools` — pure argv helpers shared by BOTH the local (`pty.ts`) and remote (`buildRemoteCommand`) paths so they can't drift. |
| `shell-quote.ts` | `shellQuote` / `shellQuoteArgv` / `remoteCdPrefix` for remote-command assembly. |
| `claude-code-provider.ts` | The full-featured reference — persona/project flag stacks, auto-mode, `--allowedTools` folding. Do NOT copy this for a new simple CLI (it's dense with claude-only concepts). |
| `cursor-provider.ts` | The **"simple CLI" reference**: base command + resume flag, inherits every no-op default. Copy this for a flag-based CLI. |
| `pi-provider.ts` | A **"simple CLI + global defaults"** provider (the `pi` coding-agent CLI): base command + `--continue` resume flag, plus the launcher-wide multi-provider defaults `--provider`/`--model`/`--thinking` (from `AppConfig.piProvider`/`piModel`/`piThinking`, set in Settings → Harness → "PI defaults"), folded into the base argv in `resolveLaunch` (byte-clean when unset). Still MCP-less and wires hooks via extensions, so the `-c`-channel/persona/hook builders stay the base no-ops. |
| `codex-provider.ts` | The **"config-injection CLI" reference**: overrides the three `-c`-channel builders (`mcpArgs`/`guidanceArgs`/`hookArgs`) to inject MCP + guidance + a Stop hook. Copy this if your CLI takes `-c`-style config overrides. |
| `shell-provider.ts` | The degenerate Null-Object provider (plain interactive shell). |

`../../shared/launch-provider.ts` is the **renderer-safe** half: `VALID_PROFILES`,
the `isXProfile` family predicates, and `providerCapabilities(profile)`. It has NO
node/electron imports so the renderer can gate UI on capabilities. The provider
classes here re-wrap `providerCapabilities` (via the base default) — that shared
accessor is the single source of truth for the capability set.

## Capability model — read this before setting a flag

`ProviderCapabilities` is 8 booleans. The subtle part: **`PtyManager` gates the
Claude-only launcher writes (`--mcp-config` file, `--settings` JSON, heap
ceiling, persona `initialPrompt`) on `injectsClaudeMcpConfig`, NOT on
`hasTranscript`/`supportsHooks`/`acceptsSessionId`.** So:

- `hasTranscript` is now PURE "a resumable/summarizable transcript exists" —
  it drives inbox summary, resume-picker, agent registry and transcript reads
  ONLY. It no longer gates any spawn-time flag injection.
- Setting `injectsClaudeMcpConfig: true` tells `PtyManager` "this CLI accepts
  Claude's launcher-injected flag files." A non-claude CLI that sets it will get
  claude's `--mcp-config`/`--settings` spliced into an argv it doesn't understand
  → broken spawn. Leave it `false` unless your CLI literally takes those flags.
  (De-conflated from `hasTranscript` so a future transcript-bearing non-Claude
  provider can have `hasTranscript: true` + `injectsClaudeMcpConfig: false`.)
- `supportsHooks` / `canAutoCloseOnFinish` are **not read in `pty.ts`** — they
  drive renderer/scheduler/goal-loop UI. To actually deliver a turn-end signal
  from a non-claude CLI you must ALSO implement `hookArgs` to emit real argv (see
  codex: `supportsHooks: true` + `injectsClaudeMcpConfig: false` + a real `hookArgs`).
- `acceptsPromptArgv` / `isAgent` are safe to turn on for any agent CLI.

## Add a provider — the ordered checklist

Adding a family (say a `gemini` CLI with profiles `gemini` / `gemini-resume`)
touches several tiers. `PtyManager` needs **no** edit, but the profile
enumeration is mirrored in a few places. `profile-completeness.guard.test.ts`
fails until they all agree, so follow this in order and let the guards catch you.

**Tier 1 — the seam (the real work):**

1. `src/shared/types.ts` — add `'gemini' | 'gemini-resume'` to the
   `LaunchProfileId` union.
2. `src/shared/launch-provider.ts` — add both to `VALID_PROFILES`, write an
   `isGeminiProfile()` predicate, add it to `isAgentProfile()`, and add a
   `providerCapabilities` branch returning your capability set.
3. `src/main/harness/gemini-provider.ts` — `extends BaseLaunchProvider`,
   override the three abstract members (`id`, `resolveLaunch`, `title`,
   `buildRemoteCommand`) + only what actually differs. Copy `cursor-provider.ts`
   for a flag CLI or `codex-provider.ts` for a `-c`-config CLI.
4. `src/main/harness/registry.ts` — import + instantiate + two map entries.
   Also add the two cases to the legacy exhaustive `resolveLaunch` switch in
   `src/main/harness/spawn-plan.ts` (a `switch` over `LaunchProfileId` that
   won't compile until every profile is handled).

**Tier 2 — the standalone type mirrors (drift = a red completeness guard):**

5. `packages/extension-sdk/src/main.ts` — `SdkLaunchProfileId` union.
6. `packages/cli/src/lib/types.ts` — the CLI's `LaunchProfileId` union.

**Tier 3 — renderer pickers (exhaustive maps won't compile until updated):**

7. `src/renderer/util/profileIcon.tsx` — add an icon (exhaustive switch).
8. `src/renderer/components/scheduler/schedulerUtils.ts`, `GoalsPanel.tsx` — the
   `PROFILE_LABEL` `Record<LaunchProfileId, string>` (exhaustive → compile error).
9. `src/renderer/components/AgentLauncher.tsx` + other pickers
   (`ListPane.tsx`, `PersonaEditor.tsx`, `CommandPalette.tsx`,
   `palette/buildItems.tsx`) — add the profile where you want it offered. These
   are *not* exhaustive-typed, so a miss is silent (the profile just won't appear
   in that menu) — grep for an existing profile id to find them all.

**Tier 4 — the guards you'll trip (and want to):**

- `profile-completeness.guard.test.ts` — the enumeration agrees across shared /
  predicates / registry / SDK mirror / CLI mirror. This is your safety net for
  tiers 1–2.
- `rule6-launch-provider.guard.test.ts` — `pty.ts` must not compare a profile
  literal. If you find yourself writing `profile === 'gemini'` in core, add a
  capability field instead.
- `pty-golden-argv.test.ts` — snapshots the claude launch matrix; only tracks
  the four profiles it lists, so a new provider doesn't perturb it. Add your own
  provider unit test under `__tests__/`.

**Live parse-verify (opt-in, real binary):** the string-level provider tests
snapshot the argv we *emit*; they can't prove the installed CLI *accepts* it.
`codex-provider.live.test.ts` closes that gap — it feeds our provider's real
argv to the installed `codex` via `codex debug prompt-input` / `debug models`
and asserts the binary honors each `-c` bridge (guidance/MCP/auth). It's gated
on `ZCC_LIVE_CODEX=1` + a resolvable `codex` (skips otherwise, so `npm test`
stays green), and does NO model call / NO network / NO trust-bypass flag. Run it
after a codex version bump to catch config-key drift:

    npm run test:codex:live            # or: ZCC_LIVE_CODEX=1 npx vitest run …
    ZCC_CODEX_BIN=/path/to/codex npm run test:codex:live

This is the codex twin of `test:pi:live` (the pi backend's live leg).

## Rule 6

Concrete profile/provider-id literals live ONLY in a provider file + the
registry. `PtyManager` reads `provider.capabilities(profile).*` and calls the
interface methods — it never names a profile. Keep it that way.
