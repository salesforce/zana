# E2E tests (Playwright + Electron)

End-to-end tests that **launch the real built app** (`out/main/index.js`) via
Playwright's `_electron` driver and drive the real renderer + main process + IPC.
This is the integration layer vitest can't reach: vitest unit-tests pure modules
with injected I/O; these prove the wiring works when the whole app is booted.

```sh
npm run test:e2e          # build, then run the suite
npm run test:e2e:only     # run against the existing out/ build (faster inner loop)
npm run test:e2e:headed   # build + run with a visible window (debugging)
npx playwright test smoke # a single spec
npx playwright show-trace test-results/<…>/trace.zip   # post-mortem a failure
```

## Why these exist (and what they cover)

The marketplace's pure engine (`src/main/extension-registry.ts`) is already
unit-tested. What was untested is the **full path**: a click in the renderer →
IPC → download over HTTPS → sha256 + Ed25519 verification → stage to disk →
reconcile → the row re-renders as installed. `marketplace.spec.ts` exercises
exactly that against a **signed local HTTPS registry** (`fixtures/registry.ts`)
that stands in for the not-yet-provisioned production registry, enforcing the
same contracts (opt-in, HTTPS-only, integrity, signature).

## Isolation model — the suite never touches your machine state

Every test gets a throwaway `HOME` (a tmp dir), and the app is launched with
`HOME` + `ZCC_EXTENSIONS_DIR` pointed inside it. Because every `~/.zcc/*` path
the app resolves roots at `homedir()`, the whole config/extensions/inbox surface
lands in the sandbox and is deleted on teardown. Nothing reads or writes your
real `~/.zcc`.

The local registry uses a **self-signed** TLS cert that the app is made to trust
via `NODE_EXTRA_CA_CERTS` — so TLS verification is genuinely exercised (the
engine rejects `http://` and untrusted certs), not disabled.

## Structure

```
e2e/
  fixtures/
    app.ts          # `test`/`expect` with an isolated, booted Electron app.
                    #   test.use({ useRegistry: true }) boots a signed HTTPS
                    #   registry + writes ~/.zcc/extension-registry.json first.
                    #   Also dismisses first-run consent overlays.
    registry.ts     # startLocalRegistry(): self-signed TLS + Ed25519 keypair +
                    #   a dummy extension published with the REAL
                    #   scripts/publish-extension.mjs, served over HTTPS.
    marketplace.ts  # MarketplacePage: UI navigation (Settings → Extensions →
                    #   Marketplace) + an ipc() helper for window.cc.extensions.*
  sdk/
    events.ts       # EventRecorder: polls window.__zccTest.drainEvents(cursor)
                    #   and asserts on the ORDERED live event/log timeline.
    harness.ts      # makeFakeAgentBinary(): chmod +x shell stubs that emit
                    #   byte-exact OSC titles (working/idle) or plain stdout,
                    #   so agent lifecycle is driven deterministically.
  smoke.spec.ts     # app boots, renderer mounts, IPC bridge live.
  marketplace.spec.ts
  harness-lifecycle.spec.ts  # agent working→idle + onExit via the recorder
  chat-stream.spec.ts        # chat run start→text→end via the recorder
  chat-ui-flow.spec.ts       # visible Chat create/fork, find, queue, scroll,
                             #   structural plan/context, and run inspector
  terminals.spec.ts          # shell onData → onExit via the recorder
  agent-launch-ui.spec.ts    # REAL UI: click New agent → type → pick → Send →
                             #   assert the agent modal opens + goes `working`
  ai-inbox-roundtrip.spec.ts # "AI testing" (ZCC_AI_E2E=1): a REAL claude agent
                             #   pushes a marker to the inbox; we poll for it
  tsconfig.json     # typechecked by `tsc -p e2e/tsconfig.json` (not the app gate).
```

## The live-observability SDK (`sdk/`)

Some flows can't be asserted by polling a snapshot — you need the **ordered
sequence** of what main pushed to the renderer (an agent going working→idle→exit,
a stream's start→text→end). The SDK gives specs that timeline.

**How it works.** Main routes every renderer push through one fan-out,
`safeSend(channel, ...args)`. A gated tap (`src/main/test-tap.ts`) records each
push — and `logMainError`/`console.*` lines — into a bounded ring buffer, exposed
to the renderer as `window.__zccTest.drainEvents(cursor)`. Because the buffer
lives in **main**, it captures events emitted *before* the renderer subscribed and
*survives a `window.reload()`* — neither of which a renderer-side `ipcRenderer.on`
tap could do.

**It is OFF unless armed.** The tap is a no-op (allocation-free) until `enable()`
runs, which happens only when the app boots with `ZCC_E2E=1`. Opt a spec in with
`test.use({ e2e: true })` — the fixture then sets `ZCC_E2E=1` and provides an
`events: EventRecorder`. Without the flag, `window.__zccTest` is `undefined`
(production has no test surface); two guard tests
(`src/main/__tests__/test-tap-gating.guard.test.ts`,
`test-tap-inert.test.ts`) fail if anyone un-gates it.

```ts
import { test, expect } from './fixtures/app';
import { makeFakeAgentBinary } from './sdk/harness';

test.use({ e2e: true });

test('agent goes working then idle', async ({ app, events }) => {
  const agent = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' });
  // ... point claudeBinary at agent.path, spawn a terminal ...
  await events.waitForEvent((e) =>
    e.channel === 'terminals:onAgentStatus' && JSON.stringify(e.args).includes('working'));
  await events.waitForEvent((e) =>
    e.channel === 'terminals:onAgentStatus' && JSON.stringify(e.args).includes('idle'));
  agent.cleanup();
});
```

`EventRecorder` API: `waitForEvent(predicate, timeout?)`, `waitForChannel(channel)`,
`assertOrder([...channels])` (relative order, interleaving allowed), `collect()`,
`channels()`, `reset()`. `makeFakeAgentBinary({ profile, sequence, exitCode, script })`
presets: `working-hold`, `work-then-idle`, `work-then-exit`, `plain-hold`, `plain-exit`.

**Faking the chat backend (STALE — needs a rewrite).** `makeFakeChatBinary` stubs a
`claudeBinary --print --output-format stream-json …` NDJSON stream for the `cli`
harness backend that `chat-stream.spec.ts`/`chat-composer-history.spec.ts`/
`chat-ui-flow.spec.ts` all pin sessions to via `chat.setHarness(id, { kind: 'cli' })`.
That backend was removed when Chat moved to the embedded `opencode serve` harness —
`resolveSelection`'s registry lookup now hard-errors ("No harness backend registered
for cli") instead of ever reaching the stub, so these specs no longer exercise a real
run. They need a fake `opencode serve` HTTP+SSE server (mirroring the unit-level fake
in `zcc-harness/backends/opencode/__tests__/opencode-backend.test.ts`) in place of
`makeFakeChatBinary`, pinned via `{ kind: 'opencode' }`.

## Driving the REAL UI (not just IPC)

Most early specs drove flows through `window.cc.*` inside `page.evaluate` — fast, but
they prove the *IPC wiring*, not that a **user** can reach the flow. `agent-launch-ui.spec.ts`
is the reference for the other layer: it clicks the actual buttons a person clicks.

**Stable selectors — a small, deliberate `data-testid` set.** The renderer carries a
handful of hidden `data-testid` hooks on the load-bearing agent-launch elements (they're
inert plain DOM attributes in production — no behavior, no `ZCC_E2E` gate needed):

| `data-testid`            | element                                             |
|--------------------------|-----------------------------------------------------|
| `nav-<id>`               | every sidebar rail entry (`nav-agents`, `nav-projects`, …) |
| `agents-new` / `agents-new-empty` | the "New quick agent" buttons (header + empty state) |
| `launch-modal`           | the AgentLauncher dialog                            |
| `launch-instruction`     | the PromptComposer instruction textarea             |
| `launch-profile-<id>`    | each profile button (`launch-profile-claude`, …)    |
| `launch-send`            | the launcher's Send/Launch button                   |
| `agent-terminal-modal`   | the agent-inspector modal opened post-launch        |
| `agent-modal-state`      | that modal's live status chip (`data-state=working\|idle\|…`) |

Prefer these (or a `role`/`aria-label`) over deep CSS/text. The launch flow the spec walks:
`nav-agents → agents-new → launch-modal → launch-instruction (type) → Target project (select)
→ launch-profile-claude → launch-send → agent-terminal-modal → agent-modal-state[data-state=working]`.

**Fake project, real launch.** The spec `mkdtempSync`s a throwaway project, registers it via
`projects.add`, and launches the agent into it (removed in `finally`) — so the launch lands in
a dedicated test project, never your real workspace. Because `projects.add` doesn't broadcast
`projects:onChanged`, click **Reload project list** on the Projects rail once so the renderer
store (and the launcher's Target-project `<select>`) sees it. The `claude` profile points at a
`makeFakeAgentBinary('work-then-idle')` stub, so the launched agent's live status chip
deterministically reaches `working` — the assertion is on the rendered DOM (`data-state`), with
the `terminals:onAgentStatus` event timeline as a secondary confirmation.

**Not yet tapped / follow-ups:** `sendToFocused` is a separate fan-out (intentionally
untapped). The **inbox-push** spec remains deferred: the inbox has no renderer-facing
push IPC (pushes originate in main/MCP), and the MCP endpoint is stateless per-request
with its ephemeral port injected only into PTY env (`ZCC_MCP_URL`, never the renderer),
so triggering a deterministic `inbox:onAppended` from a spec would need a live agent
holding a full JSON-RPC MCP session — flaky without more scaffolding.

## "AI testing" — driving a REAL agent, verifying via the inbox

`ai-inbox-roundtrip.spec.ts` is a different mode: instead of a fake binary, it launches
a **real `claude-yolo` agent** with an instruction to push a unique marker to the inbox
(`inbox_push` MCP tool), then polls `inbox:history` until the marker appears. That
proves the whole live path end-to-end: launch → argv prompt → real model turn → MCP
`.mcp.json` (`ZCC_MCP_URL`) → `inbox_push` → InboxStore → the entry the UI renders.

**It is env-gated OFF** (`ZCC_AI_E2E=1` to run) — a real, authenticated model call,
not deterministic, so it never runs in ordinary CI (same rationale as the marketplace
network specs).

```sh
ZCC_AI_E2E=1 npx playwright test e2e/ai-inbox-roundtrip.spec.ts
```

**The sandbox HOME breaks a real agent — so this spec seeds auth.** The isolation
model that protects every other spec (a throwaway HOME) is precisely what stops a real
`claude` from running: the CLI reads its **onboarding flag** (`~/.claude.json`
→ `hasCompletedOnboarding`) and **auth** (`~/.claude/settings.json` → `apiKeyHelper` +
`ANTHROPIC_*` gateway env) from HOME. Under a fresh HOME it stalls on the onboarding
prompt and never runs the turn (an earlier version of this spec saw an empty inbox for
exactly this reason). So the AI spec opts into `test.use({ seedClaudeAuth: true })`,
which `seedClaudeAuthState(home)` (in `fixtures/app.ts`) satisfies by copying the three
HOME-rooted artifacts into the sandbox before launch:

| artifact | why it's needed |
|----------|-----------------|
| `~/.claude.json` | `hasCompletedOnboarding` — without it the CLI shows onboarding, never runs |
| `~/.claude/` (settings.json) | `apiKeyHelper` + `ANTHROPIC_BASE_URL`/gateway env |
| `~/.devbar` (symlink) | the apiKeyHelper's daemon **socket** path is HOME-relative |

**A second gate — the per-folder trust dialog.** Even authenticated, `claude` shows
an "Is this a project you trust?" prompt for any unfamiliar directory and *blocks* on
it — a headless run never presses Enter, so the agent hangs forever and never runs the
prompt. The test project is a fresh tmp dir, so the spec pre-accepts the dialog with
`trustProjectInSandbox(home, dir)` (writing `projects[dir].hasTrustDialogAccepted =
true` into the sandbox `~/.claude.json`), for BOTH the raw and `realpathSync`'d dir —
claude keys the trust record on the realpath (`/private/var/...` on macOS).

If those artifacts are absent (a machine with no logged-in claude), the spec skips
cleanly rather than hard-failing. This is the "can we run LIVE tests in the app?" probe
— and the answer is **yes**: with the HOME auth state seeded and the folder pre-trusted,
a real agent runs its turn, calls `inbox_push`, and the marker lands in the
project-scoped inbox.

## Adding a new spec

1. `import { test, expect } from './fixtures/app';` — you get a booted `app`
   (`app.window` is the renderer Page, `app.home` the sandbox HOME).
2. Need the marketplace channel on? `test.use({ useRegistry: true })` and read
   `registry` from the fixture for the published id/version/permissions.
3. Drive the UI through a **page object** (add one under `fixtures/` per surface,
   like `MarketplacePage`) rather than scattering raw selectors in specs.
4. Prefer stable selectors: a `role`/`aria-label`, a semantic class
   (`.ext-market-item-title`), or visible text — not deep DOM structure.

### Patterns worth reusing for other surfaces

- **Two layers per surface:** UI methods (prove the wiring a user hits) + an
  `ipc()` escape hatch (assert engine behavior without flaky UI states).
- **Fixture-driven backends:** anything the app reaches over the network gets a
  local stand-in launched in a fixture (the registry here; an updater feed, an
  MCP endpoint, etc. follow the same shape).
- **First-run noise:** new surfaces may pop modals (consent, walkthrough) on a
  fresh HOME — dismiss them in the fixture so specs start from a clean slate.

## Notes / gotchas

- **Workers = 1.** Each test launches a full Electron app; they must not run
  concurrently in one process. Specs within a file still run in order.
- **Build first.** `test:e2e` builds; `test:e2e:only` assumes `out/` is current.
- **DevTools window.** In dev mode the app opens detached DevTools; the fixture
  filters to the `index.html` window. Don't assume `firstWindow()` is the app.
- **CI.** Runs on Linux under `xvfb-run` (headless X) as the `e2e` job in
  `.github/workflows/ci.yml` — `continue-on-error: true` and **not** part of the
  required `verify` check, so a flake never blocks a merge. On failure it uploads
  the Playwright report + traces as an artifact. Promote it to required only once
  it has proven stable over many runs.
```
