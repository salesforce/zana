# Harness SDK Architecture

`@zcc/harness-sdk` is the internal, TypeScript-only contract for describing a
**legacy PTY** coding harness (`legacyAgentSession`). It is not used by Threads.
Thread Code Harnesses are provider plugins (`plugins/provider-*`) that call
`experimental_registerProvider` and ship an AgentRuntime `host` bridge. Adding
a Thread provider must not touch `HARNESS_REGISTRATIONS`, `LaunchProvider`,
`LaunchProfileId`, or golden argv.

The PTY SDK is not a dynamic plugin loader: core imports an
explicit static registration for each harness, so main remains the authority for
paths, credentials, callback endpoints, PTYs, SSH, and process lifecycle.

## Add a harness

1. Create `src/main/harness/<id>/registration.ts`.
2. Keep native CLI or SDK behavior in that folder: provider, native hook encoder,
   session adapter, and registration-owned resume/remote projections.
3. Declare profiles, supported scopes, verification metadata, and optional
   dynamic catalog refresh in the registration.
4. Add the registration to `HARNESS_REGISTRATIONS` in `registry.ts`.
5. Keep `HARNESS_REGISTRATIONS` a complete, one-to-one partition of
   `VALID_PROFILES`. The SDK validator checks structural uniqueness; the main
   registration contract test checks canonical-profile coverage and ownership.
6. Add harness-local launch/integration/session tests plus the shared
   registration contract coverage.

## SDK contracts

- `HarnessRegistration`: profile ownership, implementation, static metadata.
- `HarnessIntegrationAdapter`: turns host-minted MCP, lifecycle, guidance, and
  credential inputs into native args/environment. The current main-process
  implementation bridges existing provider-native MCP, guidance, Codex hook,
  and auth encoders.
- `HarnessLifecycleAdapter`: reserved for future SDK event-stream harnesses.
  Current CLI lifecycle encoding is split: Codex contributes hook arguments
  through `HarnessIntegrationAdapter`; Claude renders its `--settings` payload
  and callback environment through the main-only registration's
  `renderLifecycle()`.
- `HarnessSessionAdapter`: provides transcript lookup and native session identity.
  The registration owns exact native-resume projection, so session restore never
  asks a generic provider to understand another harness's session id.
- `HarnessStatusAdapter`: attaches to the trusted provider adapter, not the
  registration. It selects the primary visual source (OSC, output activity, or
  screen scan); host lifecycle callbacks remain additive overlays. `sdk-events`
  is reserved for a future event-stream harness.
- `HarnessVerificationDefinition`: keeps binary probe metadata with the harness.
- `HarnessCapabilities` and `LEAST_CAPABLE`: dependency-free capability vocabulary
  for standalone/native harness work. The app currently uses its renderer-safe
  `ProviderCapabilities` contract for launch-time behavior.
- `AgentAction` and `AgentActionResult`: future host-mediated native-agent tool
  protocol schemas plus an exhaustive-match helper only; no action executor
  consumes them yet.

The SDK `HarnessRegistration` contains only identity, label, profiles, default
profile, implementation, and supported scopes. Verification, transcript/session
persistence, lifecycle rendering, discovery, and remote-command contracts are
deliberately added only by `src/main/harness/registration.ts`.

## Trust boundary

The SDK package has no Electron, node-pty, `@shared`, or app imports. Its
registrations are statically imported, host-owned objects, not dynamically
discovered plugins. They may reference trusted implementation instances and
main-owned callbacks, but cannot be supplied by the renderer or loaded from
untrusted code. The host validates launch intent, confines paths, creates
session identity and callback endpoints, then invokes the selected harness
implementation. A harness must never receive raw renderer IPC, unrestricted
filesystem access, credential-store access, or authority to choose a
project/session identity.

Dynamic registration operations remain main-authorized: model catalog refresh
runs only after an enabled, successful binary probe, and agent-descriptor
discovery is limited to a registered local project with an enabled, installed
harness. Transcript adapters may resolve an opaque native ID, but only the
registration's narrow `nativeSessionPatch()` mapping may persist it; adapters
cannot write arbitrary `TerminalSession` fields.

## Migration status

The migration makes registrations authoritative for profile ownership,
descriptor projection, binary verification, catalog refresh, transcript adapter
discovery, exact native resume, and remote command entry. `PtyManager` checks
the registration's `supportedScopes` before dispatching remote rendering through
`renderRemoteCommand`; provider implementations retain the byte-sensitive native
CLI dialects behind that registration-owned entry point. An unregistered or
remote-unsupported profile is rejected before remote rendering. The compatibility
lookup for an unknown persisted local profile returns the least-capable floor so
no harness-specific feature is enabled accidentally; it is not a substitute for
a registration. `PtyManager` calls `integration.configure()` once for MCP,
guidance, provider hook, and auth channels, then preserves their distinct argv/
env merge slots. Registration-owned lifecycle rendering remains separate so
Claude can encode host-minted callbacks as its native `--settings` and
environment payload. Claude's inline `--settings` and auto-mode encoder lives in
`harness/claude/hooks.ts`; legacy exports remain only for test/import
compatibility. `HarnessLifecycleAdapter` is intentionally not wired until a
harness exposes a persistent SDK event stream.
