# Author a Harness

Zana Command Center supports multiple coding-agent CLIs through **first-party
harness integrations**. A harness teaches the app how one CLI launches, resumes
sessions, accepts optional integrations, and reports useful state without making
the generic terminal host understand that CLI's private flags.

This guide is for maintainers adding a new CLI framework to Zana itself. It is
not the disk-extension API: a harness runs on the trusted main-process side and
is statically reviewed and compiled with the application.

## What a harness is

A harness is a static registration plus the native implementation it owns:

```
shared profiles and capabilities
              |
              v
  src/main/harness/<id>/registration.ts
              |
              +-- provider native argv and remote command
              +-- optional MCP, guidance, hook, and auth encoding
              +-- optional transcript, native-id, and exact-resume adapter
              +-- optional model or agent discovery
              |
              v
     HARNESS_REGISTRATIONS (trusted static roster)
              |
              v
PtyManager and main host services
```

The host, not the harness, owns the security-sensitive work:

- project selection and path confinement
- session IDs and callback endpoint identity
- credentials and encrypted credential storage
- PTY, SSH, tmux, and child-process lifecycle
- renderer IPC authorization and persisted terminal records

The harness receives validated, host-created inputs and translates them into the
specific CLI's documented argv, environment, or inline configuration syntax.

## Before you start

Verify the target CLI's real behavior. Do not copy another harness's flags just
because the features sound alike.

Answer these questions first:

| Concern | What to verify |
|---|---|
| Launch modes | Default, resume, unrestricted, and any profile-specific behavior. |
| Local and remote CLI syntax | Commands, quoting, working-directory behavior, and whether remote support is safe. |
| Prompts and settings | Native opening-prompt, model, execution-policy, persona, and project-setting mechanisms. |
| Integrations | Documented MCP, guidance, lifecycle hook, and auth-override inputs, if any. |
| Session data | Exact-resume syntax, transcript storage, native session identity, and safe cleanup. |
| Discovery | Whether model or agent catalogs can be queried safely and bounded. |
| Status | OSC, output activity, screen prompts, or an event stream. |

If the CLI does not have a safe native surface for a capability, leave that
capability unavailable. Zana should never invent an unsupported translation or
write into a user's private configuration file to simulate one.

## Add the profile family

Every profile has to be represented consistently before it can be registered:

1. Add the new `LaunchProfileId` values in `src/shared/types.ts`.
2. Add them to `VALID_PROFILES` and the appropriate family/capability helpers in
   `src/shared/launch-provider.ts`.
3. Update the matching profile unions in the extension SDK and `zcc` CLI.
4. Add renderer labels, icons, and the intended launcher, scheduler, persona, and
   command-palette choices.

The repository's profile-completeness and Rule 6 guard tests are designed to
catch omissions. Treat a failure as a signal to update the corresponding shared
contract, not as something to bypass.

## Create the harness folder

Create `src/main/harness/<id>/`. Start with the closest existing implementation:

| Reference | Use it when the CLI... |
|---|---|
| `cursor/` | Has a simple flag-based command and no special host integration. |
| `pi/` | Has a simple CLI plus global model or provider defaults. |
| `codex/` | Uses inline configuration for MCP, guidance, hooks, or auth. |
| `claude/` | Needs rich lifecycle configuration and remote command assembly. |
| `opencode/` | Needs dynamic agent discovery or native session lookup. |

At minimum, add:

```text
src/main/harness/<id>/
  provider.ts          native launch and remote command dialect
  registration.ts      static ownership, scope, verification, and dispatch
  __tests__/           CLI behavior and integration tests
```

`provider.ts` normally extends `BaseLaunchProvider`. It owns the native command,
base arguments, profile titles, capability projection, and exact remote command
quoting. Put framework-specific profile literals and flag names here, not in
generic terminal code.

## Write the registration

Each harness exports one main-process registration. The registration describes
the harness, owns its profile list, and connects its provider to optional
adapters:

```ts
import type { HarnessRegistration } from '../registration.js';
import { ExampleProvider } from './provider.js';

const implementation = new ExampleProvider();

export const exampleHarness: HarnessRegistration = {
  id: 'example',
  label: 'Example CLI',
  profiles: [
    { id: 'example', posture: 'default' },
    { id: 'example-resume', posture: 'resume' }
  ],
  defaultProfileId: 'example',
  implementation,
  supportedScopes: ['local'],
  verification: {
    enabledConfigKey: 'harnessExampleEnabled',
    installHint: 'https://example.invalid/install',
    versionArgs: ['--version']
  }
};
```

Use `supportedScopes: ['local', 'remote']` only after testing remote behavior.
The generic host rejects remote launches for registrations that do not declare
remote support.

Add the registration exactly once to `HARNESS_REGISTRATIONS` in
`src/main/harness/registry.ts`. The SDK validator rejects duplicate harness IDs
and duplicate profile ownership; the registration test verifies that all profiles
are owned exactly once.

## Add only supported adapters

The registration is intentionally composable. Add the pieces the CLI truly
supports; omit the rest.

| Registration member | Add it when... |
|---|---|
| `verification` | The binary can be checked with a bounded version command. |
| `renderRemoteCommand` and remote scope | The CLI has a tested remote command dialect. |
| `renderLifecycle` | The CLI has a documented way to encode host-minted lifecycle callbacks. |
| `createTranscriptAdapter` | The CLI exposes transcripts or native session data that can be read safely. |
| `nativeConversationResume`, `restoreProjection` | It supports reopening a specific prior conversation. |
| `nativeSessionPatch` | Main can detect a native session ID and persist it through the narrow allowlist. |
| `refreshCatalog` | It has a bounded, verified dynamic model catalog. |
| `discoverAgentDescriptors` | It has a main-authorized, project-scoped agent catalog. |

Integration adapters convert host-provided MCP, guidance, lifecycle, and auth
inputs into separate contribution slots. Preserve their existing argv and
environment merge order. Do not collapse them into one unordered collection or
move a contribution because a CLI happens to accept it in another position.

## Preserve the trust boundary

The harness SDK, `@zcc/harness-sdk`, is a dependency-free contract package. It
is **not** a runtime plugin loader. New harnesses are static code because a CLI
integration can affect process launch, callbacks, stored session IDs, and remote
execution.

Keep these rules intact:

- Never accept a harness registration from the renderer, a manifest, or disk.
- Do not give a provider raw project paths, credentials, renderer IPC, or control
  over session identity.
- Keep filesystem and process work in the host. A provider returns native launch
  material; it does not spawn arbitrary processes itself.
- Use argv arrays rather than shell strings. The only exception is a documented
  CLI hook command where the host fully constructs and quotes the command.
- Keep resolver caches bounded and release them on session close.
- If a native feature cannot be represented safely, expose it as unavailable.

## Test the integration

Every new harness needs focused tests and the shared compatibility coverage:

1. Add provider tests for base launch, profile variants, native args, and remote
   rendering.
2. Add registration tests for profile ownership, scope, verification, and native
   resume/session behavior.
3. Add adapter tests for any MCP, guidance, hook, auth, transcript, discovery, or
   legacy-setting behavior.
4. Update `src/main/__tests__/pty-golden-argv.test.ts`. Its local and remote
   snapshots are the compatibility boundary for command, argument, and
   environment assembly.
5. If the real CLI can parse configuration without starting a model session, add
   an opt-in live parser test. Keep it network-free and skipped unless the binary
   is explicitly available.

Run these before opening a change:

```bash
npm test
npm run typecheck
npm run build
```

For a full contract reference, see `docs/harness-sdk-architecture.md` in the
source tree. Keep that architecture document, this guide, and the bundled
`harness-authoring` skill synchronized whenever the registration contract changes.
