# Harness — the interactive-launch seam

This directory is the **harness launch layer**: each static registration owns the
native CLI dialect for its profiles. `PtyManager` (`../pty.ts`) retains the
provider-agnostic authority: session identity, path validation, launcher-owned
MCP files, callback endpoint minting, PTY lifecycle, and capacity. It delegates
native argv, lifecycle encoding, resume, transcript, and remote rendering through
the selected registration.

## The pieces

| File | Role |
|------|------|
| `registration.ts` | Main-only extensions to the SDK registration: verification, transcript/session identity, restore, lifecycle rendering, discovery, and remote command contracts. |
| `registry.ts` | `HARNESS_REGISTRATIONS`, `registrationFor(profile)`, and compatibility provider lookup. This is the only static roster. |
| `<harness>/registration.ts` | A harness-owned static registration with its provider, session bridge, lifecycle encoder, and verification metadata. |
| `launch-provider.ts` | The native `LaunchProvider` CLI-dialect interface and its input types (`ResolvedLaunch`, `AutoModeInput`, `RemoteCommandInput`). |
| `base-provider.ts` | `BaseLaunchProvider` — the abstract base with the no-op defaults every provider inherits (capabilities delegation, empty `-c`-channel/persona/project builders, "no auto mode", "no pinned session", the `simpleRemoteExec` template). Extend this. |
| `argv-utils.ts` | `cleanExtraArgs` + `mergeAllowedTools` — pure argv helpers shared by BOTH the local (`pty.ts`) and remote (`buildRemoteCommand`) paths so they can't drift. |
| `shell-quote.ts` | `shellQuote` / `shellQuoteArgv` / `remoteCdPrefix` for remote-command assembly. |
| `claude/provider.ts` | The full-featured reference — persona/project flag stacks, auto-mode, `--allowedTools` folding, and remote command assembly. |
| `cursor/provider.ts` | The **"simple CLI" reference**: base command + resume flag, inheriting the base no-op integrations. |
| `pi/provider.ts` | A **"simple CLI + global defaults"** provider: `--continue` resume plus global provider/model/thinking defaults. |
| `codex/provider.ts` | The **"config-injection CLI" reference**: `-c`-channel MCP, guidance, and hook configuration. |
| `shell/provider.ts` | The degenerate Null-Object provider (plain interactive shell). |

`packages/domain/src/launch-provider.ts` is the **renderer-safe** half: `VALID_PROFILES`,
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

1. `packages/domain/src/product.ts` — add `'gemini' | 'gemini-resume'` to the
    `LaunchProfileId` union.
2. `packages/domain/src/launch-provider.ts` — add both to `VALID_PROFILES`, write an
    `isGeminiProfile()` predicate, add it to `isAgentProfile()`, and add a
    `providerCapabilities` branch returning your capability set.
3. `src/main/harness/gemini/` — add a provider, a static `registration.ts`, and
    only the integration/session/lifecycle code that the native CLI needs. Copy
    `cursor/` for a flag CLI or `codex/` for a `-c`-config CLI.
4. `src/main/harness/registry.ts` — import the registration and add it once to
    `HARNESS_REGISTRATIONS`. The SDK validator and profile-completeness guard
    enforce unique, complete profile ownership.

**Tier 2 — the standalone type mirrors (drift = a red completeness guard):**

5. `packages/extension-sdk/src/main.ts` — `SdkLaunchProfileId` union.
6. `packages/cli/src/lib/types.ts` — the CLI's `LaunchProfileId` union.

**Tier 3 — renderer pickers (exhaustive maps won't compile until updated):**

7. `apps/app/src/lib/profileIcon.tsx` — add an icon (exhaustive switch).
8. `apps/app/src/components/scheduler/schedulerUtils.ts`, `GoalsPanel.tsx` — the
   `PROFILE_LABEL` `Record<LaunchProfileId, string>` (exhaustive → compile error).
9. `apps/app/src/components/AgentLauncher.tsx` + other pickers
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
- `pty-golden-argv.test.ts` — snapshots local and remote command emission for
  every registered profile. Add focused harness tests under `<harness>/__tests__/`
  for CLI behavior beyond that matrix.

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
