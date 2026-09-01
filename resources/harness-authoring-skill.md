---
name: harness-authoring
description: Add or maintain a first-party coding-agent harness in Zana. Use when integrating a new CLI framework, adding launch profiles, wiring native MCP/hooks/auth/resume/transcripts, or changing harness registrations.
---

# Authoring a Zana harness

Use this skill for a **first-party, statically reviewed** coding-agent CLI
integration. A harness is not a disk extension and is not discovered at runtime:
the app's main process imports every harness registration explicitly so it can
retain authority over projects, paths, credentials, callback URLs, PTYs, SSH,
and session identity.

Start with `docs/harness-authoring.md` for the public integration guide and
`docs/harness-sdk-architecture.md` for the internal architecture contract.

## Required workflow

1. Establish the native CLI contract before writing code.
   - Record the command and profile modes: default, resume, unrestricted, and
     any other needed posture.
   - Verify local and remote invocation syntax separately.
   - Identify supported mechanisms for prompts, model selection, execution
     policy, MCP, system guidance, lifecycle hooks, auth overrides, transcripts,
     exact resume, and agent/model discovery.
   - Do not assume another harness's flags, config format, environment variables,
     resume semantics, or hook schema apply.
2. Add the profile family to the app's shared type and UI surface.
   - Update `LaunchProfileId` in `src/shared/types.ts` and `VALID_PROFILES` plus
     capability predicates in `src/shared/launch-provider.ts`.
   - Update the extension SDK and CLI profile mirrors, renderer profile labels
     and icons, and intended launch pickers. Let completeness guards identify
     any missed exhaustive map.
3. Create `src/main/harness/<id>/`.
   - Put the provider-native CLI dialect in `provider.ts`, extending
     `BaseLaunchProvider` unless the CLI needs a different abstraction.
   - Add `registration.ts` with the harness id, profiles, local/remote scope,
     verification definition, and `renderRemoteCommand`.
   - Add only the optional adapters the native CLI genuinely supports:
     integration for MCP/guidance/hooks/auth, lifecycle rendering, native
     transcript/session resolution, exact-resume projection, dynamic catalog
     refresh, agent discovery, or legacy persisted-setting compatibility.
4. Add the static registration once to `HARNESS_REGISTRATIONS` in
   `src/main/harness/registry.ts`.
   - The SDK validator enforces non-empty metadata and unique profile ownership.
   - The registration contract test requires complete, one-to-one ownership of
     every profile in `VALID_PROFILES`.
   - Do not add profile-specific branches to `PtyManager`, `TranscriptSource`,
     verification, or generic execution routing. Put native behavior in the
     harness folder and dispatch through the registration.
5. Preserve trust and behavior boundaries.
   - Main creates and validates project/session identity, path confinement,
     callback endpoints, credentials, and process lifecycle. A provider only
     renders those host-owned inputs into its native argv/environment/config
     dialect.
   - Keep `exec`-style behavior as argv, never shell strings, unless a CLI's
     documented hook surface explicitly requires a shell command and the host
     fully constructs it.
   - Treat unsupported features as unsupported. Do not set a capability or
     translate another harness's mechanism just to make a picker appear.
6. Prove compatibility before completion.
   - Add focused provider, registration, integration, transcript/session, and
     remote rendering tests as applicable.
   - Update and inspect `src/main/__tests__/pty-golden-argv.test.ts` snapshots;
     they are the local and remote command/env compatibility boundary.
   - Run `npm test`, `npm run typecheck`, and `npm run build`. Run a gated live
     parser test against the real CLI when one can validate the emitted syntax
     without performing a model call.

## Design rules

- `@zcc/harness-sdk` is dependency-free contract vocabulary, not a runtime plugin
  loader. Keep Electron, PTY, and application imports in `src/main`.
- A registration declares what a harness owns; it does not grant host authority.
- Preserve established argv/env merge order. Add a new contribution to the
  existing named integration/lifecycle slot instead of reordering generic launch
  assembly.
- Keep lifecycle subscriptions and resolver caches app-scoped, dispose them when
  the owning session closes, and bound all scans/probes.
- For a framework that cannot be integrated safely through the static main
  boundary, stop and explain the missing native capability instead of adding an
  unreviewed escape hatch.

## Reference implementations

- `src/main/harness/cursor/`: simple flag-based CLI.
- `src/main/harness/codex/`: config-override MCP, guidance, hooks, and native
  session discovery.
- `src/main/harness/claude/`: lifecycle settings/env encoding and remote command
  assembly.
- `src/main/harness/opencode/`: dynamic agent discovery and session resolution.

The public documentation is published in the website under **Harnesses →
Author a harness**. Keep it, the SDK architecture doc, and this skill aligned
when the registration contract changes.
